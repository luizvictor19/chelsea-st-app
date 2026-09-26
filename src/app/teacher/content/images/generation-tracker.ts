// Relative, with the extension: generation-tracker.test.ts runs under node,
// which resolves neither the @/ alias nor a missing extension.
import {
  POLL_INTERVAL_MS,
  hasExpired,
} from "../../../../lib/images/generation.ts";

import type { Timer } from "../../notices.ts";
import {
  generationNotice,
  wordFailed,
  type NoticeText,
} from "./notice-texts.ts";

/**
 * Every generation the images page knows is running, followed to its end
 * from outside React, whichever word is open.
 *
 * It used to live in the word's panel, and the panel is remounted per word:
 * moving to another word stopped the questions, so the picture was not
 * downloaded and the end was never said until the teacher came back. Here it
 * lives as long as the page does. Closing or reloading the page stops it; the
 * page reads the running attempts again on load and they are picked up.
 *
 * One chain of questions per attempt, one question in flight at a time,
 * POLL_INTERVAL_MS apart. The last question is the one that downloads the
 * picture and writes it to the bucket, so two at once would do that twice.
 * A lost answer is not an answer about the generation, so it is asked again
 * until hasExpired, the same window the server judges it by.
 */

/** A generation to follow. */
export type Generation = {
  readonly attemptId: string;
  readonly wordId: string;
  readonly term: string;
  /** The attempt's created_at, which the window is counted from. */
  readonly startedAt: string;
};

/** pollAttempt's answer, already through settle: it never rejects. */
export type PollAnswer =
  | {
      readonly ok: true;
      readonly attempts?: readonly {
        readonly id: string;
        readonly status: string;
        readonly error: string | null;
      }[];
    }
  | {
      readonly ok: false;
      readonly error: string;
      /** Present when the answer was lost on the way, not given. */
      readonly cause?: unknown;
    };

export type TrackerDeps = {
  readonly poll: (attemptId: string) => Promise<PollAnswer>;
  readonly timer: Timer;
  readonly now: () => number;
  /** Into the snackbar, once per attempt. */
  readonly announce: (notice: NoticeText) => void;
};

export type GenerationTracker = {
  /** Follow this attempt, unless it is already followed or has ended. */
  track(generation: Generation): void;
  /** What to call once an attempt ends; the page sets router.refresh here. */
  onEnd(refresh: () => void): void;
  /** The generations still running, in the order they were tracked. */
  getSnapshot(): readonly Generation[];
  subscribe(listener: () => void): () => void;
};

export function createGenerationTracker(deps: TrackerDeps): GenerationTracker {
  const running = new Map<string, Generation>();
  // Ended ones are remembered for the life of the page, so a reload of the
  // list that still shows one as running, from before it ended, cannot open
  // a second chain or say the end twice.
  const ended = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: readonly Generation[] = [];
  let refresh: () => void = () => {};

  function changed() {
    snapshot = [...running.values()];
    for (const listener of listeners) listener();
  }

  function again(generation: Generation) {
    deps.timer.set(() => void ask(generation), POLL_INTERVAL_MS);
  }

  function end(generation: Generation, notice: NoticeText | null) {
    running.delete(generation.attemptId);
    ended.add(generation.attemptId);
    changed();
    // Said whatever the screen is doing: nothing here depends on a panel.
    if (notice !== null) deps.announce(notice);
    refresh();
  }

  async function ask(generation: Generation) {
    const answer = await deps.poll(generation.attemptId);

    if (!answer.ok) {
      if (
        answer.cause !== undefined &&
        !hasExpired(generation.startedAt, deps.now())
      ) {
        again(generation);
        return;
      }
      // Given by the server (the provider failed, or the window passed and
      // the row says so), or lost past the window.
      end(generation, wordFailed(generation.term, answer.error));
      return;
    }

    // No list is the common answer: still running, nothing re-rendered.
    if (answer.attempts === undefined) {
      again(generation);
      return;
    }
    const row = answer.attempts.find((a) => a.id === generation.attemptId);
    if (row !== undefined && row.status === "pending") {
      again(generation);
      return;
    }
    // Generated, approved or failed says its end. Gone from the list, or
    // rejected elsewhere, ends the chain without a notice: there is nothing
    // left to wait for and nothing true to say about a generation.
    end(
      generation,
      generationNotice(generation.term, generation.attemptId, answer.attempts),
    );
  }

  return {
    track(generation) {
      if (running.has(generation.attemptId)) return;
      if (ended.has(generation.attemptId)) return;
      running.set(generation.attemptId, generation);
      changed();
      again(generation);
    },
    onEnd(next) {
      refresh = next;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
