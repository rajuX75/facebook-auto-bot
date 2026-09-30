import { randomUUID } from "crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ImageSource, ImageSourcePref } from "@/lib/types";

const STORAGE_BUCKET = "post-images";

// Square reads well in the Facebook feed on both mobile and desktop, and
// avoids the centre-crop that wide images get in the timeline.
const WIDTH = 1200;
const HEIGHT = 1200;

export function resolveImageSource(pref: ImageSourcePref): ImageSource {
  if (pref === "mixed") return Math.random() < 0.5 ? "ai" : "stock";
  return pref;
}

/**
 * Topics phrased as listicles ("easy weeknight dinner ideas") make the model
 * return a grid of thumbnails, which reads as a stock collage in the feed.
 * Steering it toward one photographed subject fixes that.
 */
const PHOTO_STYLE =
  "single subject, professional photograph, natural light, shallow depth of field, high detail, no text, no watermark, no collage, no grid";

/**
 * A niche can supply its own complete AI prompt and an ordered list of stock
 * search queries; otherwise the topic text is used for both, as before.
 */
export interface ImageOptions {
  /** Full prompt for the AI generator; replaces the default photo styling. */
  aiPrompt?: string;
  /** Stock search queries, tried in order until one returns photos. */
  stockQueries?: string[];
}

async function fetchAiImageBytes(prompt: string, styled = false): Promise<Blob> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    styled ? prompt : `${prompt}, ${PHOTO_STYLE}`
  )}?width=${WIDTH}&height=${HEIGHT}&nologo=true&seed=${Math.floor(Math.random() * 1_000_000)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Pollinations image API ${res.status}`);
  return res.blob();
}

async function searchPexels(query: string): Promise<string | null> {
  const searchUrl = `https://api.pexels.com/v1/search?${new URLSearchParams({
    query,
    orientation: "square",
    per_page: "15",
  })}`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: env.pexelsApiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!searchRes.ok) throw new Error(`Pexels search failed (${searchRes.status})`);
  const data = await searchRes.json();
  const photos: Array<{ src: { large2x: string; large: string } }> = data.photos ?? [];
  if (photos.length === 0) return null;

  const chosen = photos[Math.floor(Math.random() * photos.length)];
  return chosen.src.large2x ?? chosen.src.large;
}

async function fetchStockImageBytes(queries: string[]): Promise<Blob> {
  if (!env.pexelsApiKey) throw new Error("PEXELS_API_KEY is not configured");

  let photoUrl: string | null = null;
  for (const query of queries) {
    photoUrl = await searchPexels(query);
    if (photoUrl) break;
  }
  if (!photoUrl) throw new Error("No stock photos found for this topic");

  const imageRes = await fetch(photoUrl, { signal: AbortSignal.timeout(20_000) });
  if (!imageRes.ok) throw new Error("Failed to download chosen stock photo");
  return imageRes.blob();
}

/**
 * Generates or sources a post image, then re-hosts it in our own Supabase
 * Storage bucket rather than linking the free provider's URL directly. Both
 * free providers are best-effort community services with no uptime guarantee —
 * re-hosting means a post's image keeps working forever, and Facebook's own
 * fetcher (which downloads the image itself at publish time) always sees a
 * stable, fast, first-party URL.
 */
export async function generateImage(
  prompt: string,
  pref: ImageSourcePref,
  options: ImageOptions = {}
): Promise<{ url: string; source: ImageSource }> {
  const source = resolveImageSource(pref);
  const stockQueries = options.stockQueries?.length ? options.stockQueries : [prompt];
  const fetchAi = () =>
    options.aiPrompt ? fetchAiImageBytes(options.aiPrompt, true) : fetchAiImageBytes(prompt);

  let blob: Blob;
  try {
    blob = source === "ai" ? await fetchAi() : await fetchStockImageBytes(stockQueries);
  } catch (err) {
    // Fall back to the other free source rather than failing the whole generation.
    const fallbackSource: ImageSource = source === "ai" ? "stock" : "ai";
    try {
      blob = fallbackSource === "ai" ? await fetchAi() : await fetchStockImageBytes(stockQueries);
      return await upload(blob, fallbackSource);
    } catch {
      throw err instanceof Error ? err : new Error("Image generation failed");
    }
  }

  return upload(blob, source);
}

async function upload(blob: Blob, source: ImageSource): Promise<{ url: string; source: ImageSource }> {
  const db = supabaseAdmin();
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, source };
}
