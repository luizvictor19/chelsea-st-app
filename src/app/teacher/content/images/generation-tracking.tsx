"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { pollAttempt } from "./actions";
import { createGenerationTracker, type Generation } from "./generation-tracker";
import { tell } from "./notice-texts";
import { settle } from "./panel-state";

/**
 * The page's one tracker, alive as long as the page is. See
 * generation-tracker.ts for the rules it follows.
 */
const tracker = createGenerationTracker({
  poll: async (attemptId) => {
    const answer = await settle(() => pollAttempt(attemptId));
    // The reason a question was lost is English and belongs in the console.
    if (!answer.ok && "cause" in answer) console.error(answer.cause);
    return answer;
  },
  timer: {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  now: () => Date.now(),
  announce: tell,
});

/** Follow a generation the teacher has just asked for. */
export function trackGeneration(generation: Generation) {
  tracker.track(generation);
}

/**
 * Mounted once on the images page. Hands the tracker every generation the
 * page found running when it rendered, of any word, and the refresh to call
 * when one ends.
 *
 * The refresh is there for the page, not for the notice. pollAttempt
 * revalidates when a generation ends, and its response re-renders the page it
 * was called from, so on that path the refresh asks for the same page again.
 * It is kept because one path does not revalidate: an attempt found already
 * finished (in another tab, or by a question whose answer was lost) is
 * answered with its list and no re-render, and the page would stay a
 * generation behind until something else reloaded it.
 */
export function GenerationTracking({
  running,
}: {
  readonly running: readonly Generation[];
}) {
  const router = useRouter();
  useEffect(() => {
    tracker.onEnd(() => router.refresh());
  }, [router]);
  useEffect(() => {
    for (const generation of running) tracker.track(generation);
  }, [running]);
  return null;
}

const NONE: readonly Generation[] = [];

/** The generation running for this word, or null, as the tracker has it. */
export function useRunningGeneration(wordId: string): Generation | null {
  const list = useSyncExternalStore(
    tracker.subscribe,
    tracker.getSnapshot,
    () => NONE,
  );
  return list.find((generation) => generation.wordId === wordId) ?? null;
}
