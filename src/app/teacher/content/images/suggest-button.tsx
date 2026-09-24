"use client";

import { useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";

import { readHeartbeat } from "@/lib/heartbeat";
import { SUGGESTION_BATCH } from "@/lib/images/suggest";

import { countSuggestionRun, suggestRepresentations } from "./actions";
import {
  WITNESS_DEADLINE_MS,
  WITNESS_INTERVAL_MS,
  afterLostBatch,
  lostBatchLevel,
  lostBatchReport,
} from "./lost-batch";
import { settle } from "./panel-state";
import { restingNote, suggestNote, type SuggestOutcome } from "./suggest-note";
import {
  SETTLE_MS,
  beginPass,
  confirmedWords,
  fillClass,
  raceTarget,
  widthOf,
  type Pass,
} from "./suggestion-bar";

/**
 * Long enough for the fill to be seen landing on the confirmed number.
 *
 * Without the wait the settle is set and overwritten inside one tick, React
 * commits only the last of them, and the bar never draws the one number on it
 * that is not an estimate. It costs SETTLE_MS a batch — six batches on the
 * longest lesson, against a run that takes a minute and a half.
 */
const settled = () => new Promise((wake) => setTimeout(wake, SETTLE_MS));

/** The console, chosen by how the batch ended rather than by how it failed. */
const CONSOLE = {
  info: console.info,
  warn: console.warn,
  error: console.error,
} as const;

/**
 * Asks the model to sort the whole lesson, decided words included. What comes
 * back is a suggestion on each word, never a decision, so this button changes
 * what the list proposes and never what it records.
 *
 * Re-running it is expected, not an accident: the suggestions on a decided
 * lesson are how a change to the prompt gets marked against answers that
 * already exist. It does overwrite, though, so a lesson that already has
 * suggestions asks first. A lesson with none goes straight through, because a
 * confirmation that never has anything to warn about is one people learn to
 * click past.
 *
 * The dialog is the native element: showModal gives Esc and the focus move
 * for free, and this repository has no dialog of its own to reuse.
 */
export function SuggestButton({
  lessonContentId,
  words,
  suggested,
}: {
  readonly lessonContentId: string;
  readonly words: number;
  readonly suggested: number;
}) {
  const [busy, setBusy] = useState(false);
  /*
   * Null is the resting state, and it means the note and the bar come from
   * the server's own count rather than from anything this browser remembers.
   * A run replaces both for as long as it lasts and then hands them back.
   */
  const [outcome, setOutcome] = useState<SuggestOutcome | null>(null);
  /*
   * The pass, and null until one has been started. The bar is the pass and
   * not the lesson: on a lesson whose words all carry a suggestion the state
   * cannot move, so a bar showing the state would stand full and still for
   * the whole run — saying nothing at the one moment there is something to
   * say. Zeroing at the start of a run is not undoing work, it is measuring a
   * different thing.
   *
   * `racingTo` is the end of the batch in flight, and the only estimate on
   * this screen. Null between batches, which is what tells the fill to settle
   * on the confirmed number instead of creeping towards a guess.
   */
  const [pass, setPass] = useState<Pass | null>(null);
  /*
   * The fill, held so the first batch can be made to transition. See the
   * comment where run() starts: this is read for its side effect, not its
   * value.
   */
  const fill = useRef<HTMLSpanElement>(null);
  /*
   * The highest confirmed count seen in this run, so the bar cannot walk back
   * in front of the teacher. Within a pass, never between them — a new pass
   * starts at zero, which is why this is reset there rather than kept.
   *
   * A ref and not state because it is a running maximum: reading it during
   * render and raising it are the same operation, it converges whatever order
   * renders happen in, and putting it in state would mean a second render for
   * every batch to say something the first render already knew.
   */
  const floor = useRef(0);
  /*
   * Words the last run in this browser sent and got no suggestion back for.
   * Nothing else records them: a word the model leaves out of its reply is
   * written nowhere and counted nowhere, and keeps whatever suggestion it had
   * before, which is indistinguishable from one written a second ago.
   */
  const [unanswered, setUnanswered] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  /*
   * The lesson, ten words at a time, one request after the last.
   *
   * It used to be one call for the whole lesson. Sixty words took 43 seconds,
   * came back 200, and reached a browser that had already given up — and on
   * Vercel it would not have come back at all, because a function has a
   * duration limit that a call that long does not fit inside. Neither of
   * those is ergonomics.
   *
   * Sequential and not parallel: six calls at once would be six writes racing
   * over the same lesson, and the progress count would jump about rather than
   * climb. Each batch is idempotent in the columns it writes, which is what
   * makes the retry below safe.
   */
  async function run() {
    setBusy(true);
    setUnanswered(0);
    floor.current = 0;

    /*
     * The bar is mounted at zero and made to exist, on screen, before any
     * target is set on it. This is not tidiness and it cannot be folded into
     * the first setPass of the loop below.
     *
     * A CSS transition runs between two computed values. An element that is
     * inserted and given its width in the same commit has no earlier value to
     * come from, so the browser paints it at the target: the first batch
     * would jump straight to the race mark and only the second would animate.
     * flushSync puts the fill in the DOM at width zero now, and measuring it
     * forces the style to be computed there, which is the "before" the
     * transition needs.
     *
     * beginPass and not a literal, because the zero has to arrive with no
     * transition on it. On a second run the fill is sitting at 100%, and
     * zeroing it while it still wears the settling class animates a 220ms
     * descent: the measurement below then reads a point half way down, and
     * the race starts from the middle of a retreat.
     *
     * getBoundingClientRect() and not a read of offsetWidth, though either
     * forces the same layout. A discarded property read survives minification
     * only because pure_getters is off by default — a setting, and settings
     * change — while a call to a method the minifier knows nothing about
     * cannot be dropped at all. The thing that must not be optimised away
     * should not depend on a default staying put.
     *
     * The call looks pointless and is the whole point. Anyone deleting it
     * because nothing uses the result will find the first batch jumping
     * again, and nothing failing to say so.
     */
    flushSync(() => setPass(beginPass(words)));
    fill.current?.getBoundingClientRect();

    /*
     * One id for the whole pass, generated here and stamped by the action on
     * every word it writes. It is the only way to ask, afterwards, whether a
     * batch whose answer never arrived had done its work: a word skipped in a
     * lesson that already carried suggestions is otherwise indistinguishable
     * from a word written, because the old suggestion sits in the column
     * either way.
     */
    const runId = crypto.randomUUID();

    let covered = 0;
    /*
     * Sent and not suggested, which is refusals and omissions together. It is
     * the only tally this loop still keeps: how many words carry a suggestion
     * is the server's to say, and counting it here as well would be a second
     * number free to disagree with the one the bar and the sentence read.
     */
    let missed = 0;
    /*
     * The lesson's own count, until the server sends its own. It is the same
     * number from the same rows, and having it here is what lets the first
     * note name a range before anything has answered. The server's is
     * authoritative and replaces it from the first batch on.
     */
    let total = words;

    for (;;) {
      const at = covered;
      const to = Math.min(at + SUGGESTION_BATCH, total);
      const batchWords = to - at;

      /*
       * The note and the fill's target are both set here, before the call
       * goes out, and that order is the point of them rather than a detail:
       * a batch takes anything from 2.5 to 59.6 seconds, and a note written
       * after it answers says nothing for all of that.
       */
      setOutcome({ kind: "running", from: at + 1, to, total });
      setPass({ covered: at, total, racingTo: to, instant: false });

      const startedAt = performance.now();
      let result = await settle(() =>
        readHeartbeat(suggestRepresentations(lessonContentId, at, runId)),
      );

      /*
       * A lost answer is not an answer about the batch. The action writes its
       * rows before it returns, and on 2026-09-20 one was seen writing its
       * eight words two seconds after the connection had already died — so
       * repeating blindly, which is what this did until now, paid the model
       * twice to write the same words twice.
       *
       * So it asks the witness instead, on a fresh request, and only repeats
       * when the witness says nothing was written.
       */
      if (!result.ok && "cause" in result) {
        const lostAfter = Math.round(performance.now() - startedAt);

        /*
         * Asked until the batch's own deadline, not once. The action outlives
         * the request that carried it: the answer was lost at 31,610ms and
         * the words were written at 33,325ms, so a single question asked the
         * instant the call rejected would have found nothing and paid the
         * model again for work already done.
         */
        /*
         * "unknown" is where this starts, because until the first answer
         * comes back nobody has been asked. Starting at "not-yet" said the
         * witness had looked and found nothing, which is a different claim
         * and a false one — and on a batch whose rejection arrives after the
         * deadline the loop below never runs at all, so that claim would go
         * into the log unchallenged.
         */
        let verdict: "landed" | "not-yet" | "unknown" = "unknown";
        let stampedInBatch: number | null = null;

        /*
         * Only "landed" ends the asking. A witness that could not be reached
         * is not a witness saying no: the call it is asking about has just
         * had its connection die, which is the moment a second request is
         * most likely to fail as well, and giving up on the first refusal
         * would spend the model on a batch that is very probably already
         * written. Both "not-yet" and "unknown" keep asking until the
         * deadline, and only then is the batch repeated.
         */
        while (performance.now() - startedAt < WITNESS_DEADLINE_MS) {
          const count = await settle(() =>
            countSuggestionRun(lessonContentId, runId, at),
          );
          stampedInBatch = count.ok ? count.stampedInBatch : null;
          verdict = afterLostBatch({ stampedInBatch, batchWords });
          if (verdict === "landed") break;
          await new Promise((wake) => setTimeout(wake, WITNESS_INTERVAL_MS));
        }

        CONSOLE[
          lostBatchLevel(verdict === "landed" ? "recovered" : "retrying")
        ](
          lostBatchReport({
            lessonContentId,
            offset: at,
            words: batchWords,
            attempt: 1,
            clientMs: lostAfter,
            cause: result.cause,
            landed:
              verdict === "landed"
                ? "yes"
                : verdict === "unknown"
                  ? "unknown"
                  : "no",
          }),
          result.cause,
        );

        if (verdict === "landed") {
          /*
           * The batch is done and only its answer was lost. Landed means
           * every word of it is stamped, so there is nothing missed to add
           * here: a short count cannot be landed. What the lost answer took
           * with it is the model's phrasing of a result already written.
           */
          covered = to;
          setPass({ covered, total, racingTo: null, instant: false });
          await settled();
          if (covered >= total) break;
          continue;
        }

        /*
         * Either the witness watched the deadline out without the batch ever
         * becoming whole, or it could not be reached at all. Both are a
         * repeat, and the whole path is bounded: one deadline, then one
         * repeat, then the run stops with the stall note. Nothing here loops.
         *
         * The bounded shape is what makes the exact rule safe. A batch with a
         * word the model never answered for can never be whole, so it always
         * spends the deadline and always costs one repeat — measured across
         * 132 calls on 2026-09-20, no batch refused a word, so that is a price
         * paid rarely for never advancing over a batch that was cut off half
         * written. The alternative, advancing on a partial count, cannot tell
         * a refused word from a function killed between two writes, and gets
         * the second one wrong by skipping words in silence.
         */
        const retriedAt = performance.now();
        result = await settle(() =>
          readHeartbeat(suggestRepresentations(lessonContentId, at, runId)),
        );
        if (!result.ok && "cause" in result) {
          // The repeat was lost as well, so the stall below is where this run
          // ends. This is the line somebody has to see.
          CONSOLE[lostBatchLevel("stopped")](
            lostBatchReport({
              lessonContentId,
              offset: at,
              words: batchWords,
              attempt: 2,
              clientMs: Math.round(performance.now() - retriedAt),
              cause: result.cause,
              landed: "unknown",
            }),
            result.cause,
          );
        }
      }

      if (!result.ok) {
        setBusy(false);
        // Left where it stopped, beside a sentence that says where that was.
        setPass({ covered, total, racingTo: null, instant: false });
        setUnanswered(missed);
        setOutcome({ kind: "stalled", covered, total, error: result.error });
        return;
      }

      /*
       * Sent minus written, not the parser's refusals. A refusal is an answer
       * the parser dropped and did count; a word the model left out of its
       * reply is in neither list, and that one is the dangerous half, because
       * it is the one nothing anywhere would mention.
       */
      missed += result.words - result.suggested;
      total = result.total;
      covered += result.words;
      // Nothing in flight is what settles the fill: it stops creeping into
      // the batch and slides the short way onto the confirmed number.
      setPass({ covered, total, racingTo: null, instant: false });
      await settled();

      // done is the end of the lesson; the zero is insurance, so that a batch
      // which somehow covers nothing cannot turn this into a loop that keeps
      // asking for ever.
      if (result.done || result.words === 0) break;
    }

    setBusy(false);
    /*
     * Full, and it stays. The bar is the pass that just ran, and a pass that
     * finished is a bar at its end; taking it away would put the row back to
     * how it looked before the click, which is the one thing that did not
     * happen.
     */
    setPass({ covered: total, total, racingTo: null, instant: false });
    setUnanswered(missed);
    setOutcome(null);
  }

  /*
   * Nothing to draw until a pass has been started, which is what makes the
   * bar the pass: before the first click there is no pass, and the lesson's
   * state is in the sentence, where it says "18 sugeridas" whether anything
   * has run or not.
   *
   * Monotone inside a pass and zeroed between them. confirmedWords holds the
   * first; floor.current going back to zero at the start of run() is the
   * second, and the two are different rules rather than one rule with an
   * exception.
   */
  const confirmed =
    pass === null ? null : confirmedWords(pass.covered, floor.current);
  if (confirmed !== null) floor.current = confirmed;
  /*
   * `pass.racingTo` is the word the batch in flight reaches; raceTarget wants
   * how many words that is from here, which is the same number said the other
   * way round.
   */
  const inFlightWords =
    pass === null || pass.racingTo === null || confirmed === null
      ? null
      : pass.racingTo - confirmed;
  const racingTo =
    pass === null || confirmed === null
      ? null
      : raceTarget(confirmed, pass.total, inFlightWords);

  /*
   * The state is in the sentence whatever happened, and a stalled run is
   * added to it rather than put in its place. The lesson header used to carry
   * this count; now that it does not, an outcome that never clears — and
   * "stalled" never clears — would leave that lesson's row saying only where
   * a run stopped, with no number anywhere, until a reload.
   */
  const text =
    outcome === null
      ? restingNote(suggested, unanswered)
      : outcome.kind === "stalled"
        ? `${restingNote(suggested, unanswered)}. ${suggestNote(outcome)}`
        : suggestNote(outcome);

  function start() {
    if (suggested === 0) {
      void run();
      return;
    }
    dialog.current?.showModal();
  }

  return (
    // A div and not a span: <dialog> is flow content and has no business
    // inside phrasing content, however small the wrapper looks.
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy || words === 0}
        onClick={start}
        title={
          words === 0
            ? "Esta lição não tem palavras"
            : "Sugere de novo a lição inteira, inclusive as já decididas"
        }
        className="border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs font-semibold normal-case transition-colors disabled:opacity-40"
      >
        {busy ? "sugerindo" : "Sugerir tipos"}
      </button>
      {/*
        The sentence is always there; the bar only once a pass has started.
        The sentence carries the lesson's state, which is true before anyone
        has clicked anything, and the bar carries the pass, which is not.

        The bar is never alone either. On its own it shows how far something
        got and not what it was, and when a run stops that is the whole
        question: the words are named by the sentence.
      */}
      <span className="flex items-center gap-2">
        {pass !== null && confirmed !== null && (
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={pass.total}
            /*
             * The confirmed number of this pass, never the raced one. The
             * fill may be part way into a batch nobody has answered for yet;
             * that is a drawing, and a drawing is not something to read out
             * to someone who cannot see it.
             */
            aria-valuenow={confirmed}
            aria-label="Palavras sugeridas nesta passagem"
            className="bg-surface block h-1 w-40 overflow-hidden rounded-full"
          >
            <span
              ref={fill}
              className={`bg-foreground suggest-fill block h-full ${fillClass(pass)}`}
              style={
                {
                  "--confirmed": widthOf(confirmed, pass.total),
                  "--racing": widthOf(racingTo ?? confirmed, pass.total),
                  /*
                   * The settling duration lives here and not in the
                   * stylesheet, because the loop has to wait exactly this
                   * long for the settle to be seen. Two copies of a duration
                   * that must agree is the kind of pair that drifts silently;
                   * this way the CSS reads the number the loop sleeps for.
                   */
                  "--settle": `${SETTLE_MS}ms`,
                } as CSSProperties
              }
            />
          </span>
        )}
        <span className="text-faint text-xs normal-case">{text}</span>
      </span>

      <dialog
        ref={dialog}
        aria-labelledby={`substituir-${lessonContentId}`}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 normal-case backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2
            id={`substituir-${lessonContentId}`}
            className="text-base font-extrabold tracking-tight"
          >
            Substituir as sugestões desta lição?
          </h2>
          <p className="text-muted text-sm">
            {suggested === 1
              ? "1 palavra desta lição já tem sugestão."
              : `${suggested} palavras desta lição já têm sugestão.`}{" "}
            Sugerir de novo substitui o tipo e a classe. As decisões que você já
            tomou não são tocadas.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {/*
              Cancel closes and calls nothing: no action, no request, nothing
              spent. The form method keeps Esc and this button on the same
              path out.
            */}
            <form method="dialog">
              <button
                type="submit"
                className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors"
              >
                Cancelar
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                void run();
              }}
              className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
            >
              Substituir
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
