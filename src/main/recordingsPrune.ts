/** Finished recordings wait in userData/recordings until exported; sweep old ones at startup. */
export const RECORDINGS_MAX_AGE_MS = 7 * 86_400_000

/** Pure: which recordings are older than maxAge. */
export function staleRecordings(
  entries: { path: string; mtimeMs: number }[],
  nowMs: number,
  maxAgeMs: number = RECORDINGS_MAX_AGE_MS
): string[] {
  return entries.filter((e) => nowMs - e.mtimeMs > maxAgeMs).map((e) => e.path)
}
