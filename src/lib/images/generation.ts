/**
 * How long a generation is waited for, and who does the waiting.
 *
 * Until 2026-09-19 the waiting was a loop inside the server action: one HTTP
 * request held open for the whole generation, 8 to 21 seconds of it, carrying
 * both the answer and the screen's re-render. Everything on that path had a
 * veto over both, and twice that day something took it: the row was written,
 * paid for and correct, and the teacher's screen never heard.
 *
 * Now the attempt row is the wait. The action starts the generation and
 * returns; the panel asks the row how it is going. No request lives long
 * enough to be cut, and the wait survives a reload and a change of word,
 * because it was never in the browser to begin with.
 */

// Relative, with the extension: node --test loads this file too.
import { MAX_FILE_BYTES } from "./body-limit.ts";

/**
 * How long an attempt is given before it is called lost.
 *
 * Measured on 2026-11-04 from the rows, every freepik attempt that left
 * 'pending' without an error:
 *
 *   select model, count(*),
 *          percentile_cont(0.5) within group (
 *            order by completed_at - created_at) as p50,
 *          max(completed_at - created_at) as worst
 *   from image_attempts
 *   where provider = 'freepik' and completed_at is not null
 *     and error is null
 *   group by model;
 *
 *   model               attempts   p50     worst
 *   flux-kontext-pro    28         13.2s   22.0s
 *   seedream-v4         63         14.3s   81.1s
 *   seedream-v4-5-edit   1         37.0s   37.0s
 *   mystic              48         25.0s   341.7s
 *
 * `completed_at` is when our server wrote the answer, after the download and
 * the upload, not when the provider finished. The first poll that found a row
 * 'pending' past the old 90s window closed it as failed, so a row that
 * completed after 90s was written by the first poll past the mark, and the
 * provider had finished by then. The three above 90s are all Mystic and all
 * from before the panel kept polling across a change of word. 95.0s can be a
 * real duration: a poll at about 91s that found COMPLETED, plus the store.
 * 147.0s and 341.7s cannot: nobody polled between 90s and then, so they are
 * ceilings, not durations.
 *
 * The one real duration above 90s that is known is the one the old window
 * killed: Mystic on 2026-09-19, closed as failed at 91.0s with 80 credits
 * spent. Once a row is failed it is never asked about again, so that image
 * was lost.
 *
 * Erring long costs a stuck generation six minutes of a disabled button on
 * one word, and no accepted generation has ever stayed stuck. Erring short
 * cost 80 credits once. So the window covers the worst number in the table,
 * ceiling or not, with one window for every model: one row of Seedream 4.5
 * Edit is no basis for a window of its own.
 *
 * The window bounds how long we wait for the provider, and nothing else. A
 * poll that finds COMPLETED is stored even past the window, but only if it is
 * the first poll after it: one that finds 'pending' past the window closes
 * the row as failed, and a failed row is not polled again.
 */
export const GENERATION_WINDOW_MS = 360_000;

/**
 * How long the panel waits before asking the row again.
 *
 * Against the medians measured on 2026-11-04, 13 to 25 seconds, this is 7 to
 * 13 questions; a generation that never answers is asked about 180 times
 * before the window ends it. Each one is a short call, so the cost is auth
 * and a provider GET, not a held connection; see the note on the proxy in the
 * panel.
 */
export const POLL_INTERVAL_MS = 2_000;

/** The parts of an attempt this module judges. Anything wider is the screen's. */
export type Running = {
  readonly id: string;
  readonly status: string;
  readonly provider: string;
  readonly createdAt: string;
};

/**
 * An attempt still waiting on the provider.
 *
 * Provider and status both, because an upload is 'pending' too, for the
 * moment between its row and its file. Polling that one would ask Freepik
 * about a task that was never created.
 */
export function isRunning(attempt: Running): boolean {
  return attempt.provider === "freepik" && attempt.status === "pending";
}

/**
 * The one attempt worth asking about, or null.
 *
 * The newest, when there is somehow more than one: the list arrives newest
 * first, and an older stuck row must not hold up the one the teacher is
 * actually watching. The other will be picked up on the next pass.
 */
export function runningAttempt<T extends Running>(
  attempts: readonly T[],
): T | null {
  return attempts.find(isRunning) ?? null;
}

/**
 * Whether an attempt has been waiting longer than it is given.
 *
 * A date that cannot be read counts as not expired. Being unable to tell how
 * old a row is is not a reason to declare its generation lost: the provider
 * still has the answer, and the next poll will get it.
 */
export function hasExpired(createdAt: string, now: number): boolean {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return false;
  return now - started > GENERATION_WINDOW_MS;
}

/**
 * How long an attempt has been running, in whole seconds, for the counter.
 *
 * Taken from the row and not from a timer started on click, so it is still
 * right after a reload and still right on a word the teacher came back to.
 * Never negative: a clock skew between the database and the browser should
 * read as "just started", not as a countdown.
 */
export function elapsedSeconds(createdAt: string, now: number): number {
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/**
 * The running attempt's ", Ns", or nothing before the panel's clock has
 * ticked once. The first render happens on the server and again in the
 * browser, on two clocks: a number there makes React discard the server's
 * HTML (error #418, #358). Null is "no clock yet", the same on both sides.
 */
export function runningLabel(createdAt: string, now: number | null): string {
  return now === null ? "" : `, ${elapsedSeconds(createdAt, now)}s`;
}

/** The parts of a finished attempt the duration is read from. */
export type Finished = {
  readonly provider: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
};

/**
 * How long an attempt took, in whole seconds, or null when there is nothing
 * honest to say.
 *
 * What it measures is the whole wait: created_at is stamped when the row is
 * inserted, completed_at when it leaves 'pending', which is after the picture
 * has been downloaded and put in the bucket. So this is what the teacher
 * actually waited for, not the provider's own drawing time. The two are close
 * but not the same, and a comparison between models should know the
 * difference.
 *
 * Rounded rather than floored, unlike the live counter: a counter counts
 * seconds that have gone by, and this is a measurement, where dropping up to
 * a second every time would be a bias rather than a rounding.
 *
 * Null in four cases, all of them "we cannot tell" rather than "zero":
 *
 *   An upload. Its stamp measures a file going into the bucket, which is a
 *   different thing wearing the same column; printing it beside a generation
 *   would put two unlike numbers under one label.
 *
 *   No stamp at all. Every attempt made before 2026-09-19 predates the
 *   column, and those rows say nothing rather than guessing from decided_at,
 *   which is when the teacher judged the picture, minutes later.
 *
 *   A date that cannot be read.
 *
 *   An end before the beginning. created_at comes from Postgres and
 *   completed_at from the application server, so they are two clocks; a gap
 *   that comes out negative means the skew between them is larger than the
 *   thing being measured, and no number is better than a wrong one.
 */
export function generationSeconds(attempt: Finished): number | null {
  if (attempt.provider !== "freepik") return null;
  if (attempt.completedAt === null) return null;
  const started = Date.parse(attempt.createdAt);
  const ended = Date.parse(attempt.completedAt);
  if (Number.isNaN(started) || Number.isNaN(ended)) return null;
  if (ended < started) return null;
  return Math.round((ended - started) / 1000);
}

/**
 * The most a structure reference may weigh by the time it reaches the server.
 *
 * The browser shrinks every reference before it is sent — longest side 1536,
 * JPEG at 0.85 — and after that shrink almost nothing reaches a few hundred
 * KB, so this is a net and not a rule anybody is meant to feel. What it
 * catches is the file that is still enormous afterwards, so that it is
 * refused by us, with a sentence, rather than by the framework.
 *
 * It is the cap body-limit.ts holds every file to, under the frame
 * next.config.ts raises, so the limit that says no is ours and says why.
 *
 * Structure is silhouette. A reference is telling the model what shape to
 * draw, not what detail to copy, so there was never anything here that needed
 * the resolution a phone camera produces.
 */
export const MAX_REFERENCE_BYTES = MAX_FILE_BYTES;

/** Said when a file is still too big after the browser has shrunk it. */
export const REFERENCE_TOO_BIG =
  "Imagem muito grande mesmo depois de reduzir. Tente uma imagem menor.";

/** The longest side a reference is reduced to before it is sent. */
export const REFERENCE_MAX_SIDE = 1536;

/** The JPEG quality the reduction uses. */
export const REFERENCE_QUALITY = 0.85;

/**
 * The size a reference is drawn at, given what it arrived as.
 *
 * Never larger than it came: enlarging a small picture would cost bytes and
 * add nothing, because the pixels to fill it with do not exist. Below the
 * limit it is left exactly alone, so a reference that was already small is
 * re-encoded at the same size rather than resampled for no reason.
 *
 * The aspect ratio is kept, and the shorter side never rounds to zero: a
 * picture 4000 by 3 is absurd, and it still has to come out as an image
 * rather than as a canvas one pixel tall that throws.
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
