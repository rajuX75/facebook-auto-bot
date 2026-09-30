/**
 * Interval-based posting ("one post every N hours").
 *
 * Fixed hour slots cannot express "every 5 hours" — 24 is not a multiple of 5,
 * so the gaps would be uneven — so in interval mode autopilot simply asks how
 * long ago the last automatic post went out. The scheduler can therefore tick
 * as often as it likes; only the tick that finds the interval elapsed posts.
 *
 * Kept free of imports so the rule can be exercised on its own.
 */

/** Ticks arrive a little late or early; without slack a 5h cadence drifts. */
export const TOLERANCE_MS = 10 * 60 * 1000;

export function isIntervalDue(
  lastPostAt: string | null | undefined,
  intervalHours: number,
  now: Date
): boolean {
  if (!lastPostAt) return true;
  const last = new Date(lastPostAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalHours * 3_600_000 - TOLERANCE_MS;
}
