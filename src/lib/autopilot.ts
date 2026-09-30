import { getSettings, updateSettings } from "@/lib/db/settings";
import { createPostRecord } from "@/lib/db/posts";
import { publishPostNow } from "@/lib/facebook/publish";
import { generateContent } from "@/lib/ai/text";
import { generateImage } from "@/lib/ai/image";
import { getTrendingTopics } from "@/lib/trends";
import { markTopicUsed, nextTopic, TopicsTableMissingError } from "@/lib/db/topics";
import { decideTopicOrigin } from "@/lib/topic-origin";
import { env } from "@/lib/env";
import { isIntervalDue } from "@/lib/interval";
import {
  CAR_COPY_HINT,
  carImagePrompt,
  carStockQueries,
  carTemplateContent,
  pickCar,
} from "@/lib/niche/classic-cars";
import { supabaseAdmin } from "@/lib/supabase/server";
import { localParts, startOfTodayIso } from "@/lib/time";
import { isFacebookConnected } from "@/lib/types";
import type { Post, Topic, TopicSource } from "@/lib/types";

export type AutopilotResult =
  | { ran: true; post: Post }
  | {
      ran: false;
      reason:
        | "disabled"
        | "not_connected"
        | "no_default_page"
        | "outside_posting_hours"
        | "interval_not_elapsed"
        | "already_posted_this_slot"
        | "daily_quota_reached";
    };

/**
 * What the next autopilot post is about. The owner's own list wins unless the
 * setting says otherwise; trending ideas cover the gap while that list is
 * empty, and also on databases that predate topics entirely — autopilot must
 * keep working on an install that has not re-run schema.sql yet.
 */
async function chooseTopic(
  source: TopicSource | undefined
): Promise<{ text: string; topic: Topic | null }> {
  let own: Topic | null = null;
  if (source !== "trending") {
    try {
      own = await nextTopic();
    } catch (err) {
      if (!(err instanceof TopicsTableMissingError)) throw err;
    }
  }

  if (own && decideTopicOrigin(source, true, Math.random()) === "mine") {
    return { text: own.text, topic: own };
  }

  const { topics } = await getTrendingTopics();
  return { text: topics[Math.floor(Math.random() * topics.length)], topic: null };
}

/**
 * The "fully automatic" half of the product: on each cron tick, decide
 * whether it is time to invent a fresh post on its own (no human in the
 * loop) and, if so, do it — pick a topic, write the copy, source the
 * image, and publish. Called once per cron invocation; safe to call more
 * often than the posting cadence since every guard is idempotent.
 */
export async function maybeRunAutopilot(): Promise<AutopilotResult> {
  const settings = await getSettings();

  if (!settings.auto_post_enabled) return { ran: false, reason: "disabled" };
  if (!isFacebookConnected(settings)) return { ran: false, reason: "not_connected" };
  if (!settings.default_page_id || !settings.default_page_token) {
    return { ran: false, reason: "no_default_page" };
  }

  const intervalHours = env.postIntervalHours;
  const db = supabaseAdmin();

  if (intervalHours > 0) {
    // Interval mode ("every N hours"): only the time since the last automatic
    // post matters. Posting hours and the daily cap are deliberately ignored,
    // otherwise they would silently veto an even cadence.
    if (!isIntervalDue(settings.last_auto_post_at, intervalHours, new Date())) {
      return { ran: false, reason: "interval_not_elapsed" };
    }
  } else {
    const { dateKey, hour } = localParts(new Date(), settings.timezone);
    if (!settings.posting_hours.includes(hour)) {
      return { ran: false, reason: "outside_posting_hours" };
    }

    if (settings.last_auto_post_at) {
      const last = localParts(new Date(settings.last_auto_post_at), settings.timezone);
      if (last.dateKey === dateKey && last.hour === hour) {
        return { ran: false, reason: "already_posted_this_slot" };
      }
    }

    const { count } = await db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "posted")
      .gte("posted_at", startOfTodayIso(settings.timezone));

    if ((count ?? 0) >= settings.posts_per_day) {
      return { ran: false, reason: "daily_quota_reached" };
    }
  }

  const classicCars = env.niche === "classic-cars";

  let chosen: { text: string; topic: Topic | null };
  if (classicCars) {
    // Avoid repeating a car until the whole list has been used.
    const { data: recent } = await db
      .from("posts")
      .select("topic")
      .order("created_at", { ascending: false })
      .limit(60);
    chosen = {
      text: pickCar((recent ?? []).map((r) => r.topic as string), Math.random()),
      topic: null,
    };
  } else {
    chosen = await chooseTopic(settings.topic_source);
  }
  const topic = chosen.text;

  const content = classicCars
    ? await generateContent(topic, { hint: CAR_COPY_HINT, fallback: carTemplateContent })
    : await generateContent(topic);
  const image = classicCars
    ? await generateImage(topic, settings.image_source, {
        aiPrompt: carImagePrompt(topic),
        stockQueries: carStockQueries(topic),
      })
    : await generateImage(`${content.title} — ${topic}`, settings.image_source);

  const draft = await createPostRecord({
    topic,
    title: content.title,
    description: content.description,
    hashtags: content.hashtags,
    image_url: image.url,
    image_source: image.source,
    link_url: null,
    page_id: settings.default_page_id,
    page_name: settings.default_page_name,
    scheduled_at: null,
    status: "draft",
  });

  // Recorded once the draft exists, so a failure while generating does not
  // push the topic to the back of the rotation without a post to show for it.
  if (chosen.topic) await markTopicUsed(chosen.topic);

  const published = await publishPostNow(draft.id);
  await updateSettings({ last_auto_post_at: new Date().toISOString() });

  return { ran: true, post: published };
}
