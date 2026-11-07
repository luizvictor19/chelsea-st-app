"use client";

import { useEffect, useId, useRef, useState } from "react";

import { readHeartbeat } from "@/lib/heartbeat";
import { MAX_PAIRS, MIN_PAIRS } from "@/lib/questions/suggest-questions";

import { askTwiceIfLost } from "../images/contrast-proposals";

import { useUnsavedWarning } from "./leave-guard";
import { pointFailed, questionsSuggested, tell } from "./notice-texts";
import { suggestQuestions } from "./suggest-actions";
import { COUNT_RANGE, NO_NEW_WORDS } from "./suggest-texts";
import {
  DEFAULT_COUNT,
  countOf,
  putBack,
  removed,
  used,
  withAnswer,
  type SuggestionCard,
} from "./suggestion-cards";

type Status =
  | { readonly kind: "idle" }
  | {
      readonly kind: "asking";
      readonly since: number;
      readonly retrying: boolean;
    };

/**
 * The cards of one point's "Sugerir perguntas" (#231), and the call that
 * brings them. Nothing here writes: a card becomes a question only through
 * the question form, which the point draws for a card in use.
 *
 * While a card is on the screen, leaving asks first (useUnsavedWarning): a
 * card lives only in this tab, and dropping one by mistake costs the request
 * again.
 */
export function useSuggestions(pointId: string, point: number) {
  const [cards, setCards] = useState<readonly SuggestionCard[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /*
   * The cards as last rendered, for the answer that lands after the wait:
   * the teacher may have used or discarded cards meanwhile, and the closure
   * that started the call only knows the cards of the click. Read outside a
   * state updater, because the notice needs the count now.
   */
  const cardsNow = useRef(cards);
  useEffect(() => {
    cardsNow.current = cards;
  }, [cards]);
  useUnsavedWarning(`sugestoes:${pointId}`, cards.length > 0);

  async function ask(count: number) {
    if (status.kind === "asking") return;
    const since = Date.now();
    setStatus({ kind: "asking", since, retrying: false });
    let first = true;
    const { answer } = await askTwiceIfLost(() => {
      if (!first) setStatus({ kind: "asking", since, retrying: true });
      first = false;
      // A stream of beats with the result at the end: a drop on the way, or
      // a stream gone quiet, throws, and askTwiceIfLost asks once more.
      // Safe, because suggesting writes nothing.
      return readHeartbeat(suggestQuestions(pointId, count));
    });
    setStatus({ kind: "idle" });
    if (!answer.ok) {
      tell(pointFailed(point, answer.error));
      return;
    }
    const next = withAnswer(cardsNow.current, answer.model, answer.questions);
    cardsNow.current = next.cards;
    setCards(next.cards);
    tell(
      questionsSuggested(point, {
        asked: answer.asked,
        returned: answer.questions.length,
        added: next.added,
      }),
    );
  }

  return {
    cards,
    status,
    ask,
    use: (key: string) => setCards((current) => used(current, key)),
    putBack: (key: string) => setCards((current) => putBack(current, key)),
    remove: (key: string) => setCards((current) => removed(current, key)),
  };
}

/**
 * The quantity and the button, with the wait under them. `canAsk` is false
 * for a point with no new word: the action would refuse it (NO_NEW_WORDS),
 * so the button says so before anything is paid for.
 */
export function SuggestControls({
  canAsk,
  status,
  onAsk,
}: {
  readonly canAsk: boolean;
  readonly status: Status;
  readonly onAsk: (count: number) => void;
}) {
  const [typed, setTyped] = useState(String(DEFAULT_COUNT));
  const [now, setNow] = useState(0);
  const id = useId();
  const asking = status.kind === "asking";
  useEffect(() => {
    if (!asking) return;
    // Until the first tick, `now` is older than `since`: 0 s, as it should be.
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [asking]);

  const count = countOf(typed);
  const elapsed =
    status.kind === "asking"
      ? Math.max(0, Math.round((now - status.since) / 1000))
      : 0;
  const why = !canAsk ? NO_NEW_WORDS : count === null ? COUNT_RANGE : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={`${id}-quantas`} className="text-sm">
        Quantas
      </label>
      <input
        id={`${id}-quantas`}
        type="number"
        inputMode="numeric"
        min={MIN_PAIRS}
        max={MAX_PAIRS}
        step={1}
        value={typed}
        disabled={asking || !canAsk}
        onChange={(event) => setTyped(event.target.value)}
        className="border-rule bg-background w-16 rounded-sm border px-2 py-1 text-sm"
      />
      <button
        type="button"
        disabled={asking || why !== null}
        onClick={() => {
          if (count !== null) onAsk(count);
        }}
        title={
          why ?? "Pede rascunhos ao modelo. Nada é gravado até você usar um."
        }
        className="border-rule hover:bg-surface rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40"
      >
        {asking ? "Sugerindo…" : "Sugerir perguntas"}
      </button>
      {asking && (
        <span
          role="progressbar"
          aria-label="Esperando as perguntas sugeridas"
          aria-valuetext={`${elapsed} segundos`}
          className="bg-surface block h-1 w-32 overflow-hidden rounded-full"
        >
          <span className="bg-foreground contrast-wait block h-full" />
        </span>
      )}
      <span className="text-faint text-xs">
        {status.kind === "asking"
          ? status.retrying
            ? `A resposta se perdeu no caminho. Perguntando de novo · ${elapsed} s`
            : `${elapsed} s · costuma levar de 5 a 15 s`
          : (why ?? "")}
      </span>
    </div>
  );
}
