"use client";

import { useRef, useState } from "react";

import type { ImageAttempt } from "@/lib/content/queries";
import {
  elapsedSeconds,
  generationSeconds,
  isRunning,
} from "@/lib/images/generation";

import { attemptCredits, attemptOrigin, discardWarning } from "./panel-state";

const STATUS_LABELS: Record<string, string> = {
  pending: "gerando",
  generated: "pronta",
  failed: "falhou",
  approved: "aprovada",
  rejected: "descartada",
};

/**
 * The attempts of a word or of a scene, with Aprovar and the bin.
 *
 * Moved out of word-panel.tsx unchanged when the scene got a panel of its own
 * (#64), so both panels show and confirm attempts the same way. What each
 * button does is the panel's: it is handed the calls, and the busy key says
 * which control is waiting on the server.
 */
export function AttemptList({
  attempts,
  label,
  now,
  working,
  busyKey,
  onApprove,
  onDiscard,
  onZoom,
}: {
  readonly attempts: readonly ImageAttempt[];
  /** The word's term or the scene's description, for the alt text. */
  readonly label: string;
  readonly now: number;
  readonly working: boolean;
  readonly busyKey: string | null;
  readonly onApprove: (attemptId: string) => void;
  /** Called only after the dialog has been confirmed. */
  readonly onDiscard: (attemptId: string) => void;
  readonly onZoom: (url: string) => void;
}) {
  /*
   * Failures are folded away rather than thrown away. A failed attempt is
   * accounting: it may have cost a credit, and the answer to whether it did
   * comes from comparing what the table says with what the dashboard says. It
   * used to be got out of the way by pressing the bin, which turned it into a
   * 'rejected' row indistinguishable from a picture the teacher just did not
   * like, and the question became unanswerable.
   */
  const [showFailed, setShowFailed] = useState(false);
  /*
   * Which attempt the bin is asking about. The bin destroys a picture that
   * has been paid for and the file does not come back, so unlike the
   * suggestion dialog — which lets a lesson with nothing to overwrite go
   * straight through — this one always has something to say, and always says
   * it. What it says is the number; see discardWarning.
   */
  const discard = useRef<HTMLDialogElement>(null);
  const [discarding, setDiscarding] = useState<ImageAttempt | null>(null);

  /** The same native dialog, for the one control that destroys something. */
  function askToDiscard(attempt: ImageAttempt) {
    setDiscarding(attempt);
    discard.current?.showModal();
  }

  /*
   * A failure is terminal already, so the bin is not offered on one: pressing
   * it would reclassify rather than tidy, and the difference between "the
   * provider refused" and "the teacher did not like it" is what tells us
   * whether a failure is charged. Folded out of the list instead, and counted
   * in the heading either way.
   */
  const failedCount = attempts.filter(
    (attempt) => attempt.status === "failed",
  ).length;
  const listed = showFailed
    ? attempts
    : attempts.filter((attempt) => attempt.status !== "failed");

  return (
    <>
      {/*
        No separate Aprovada block. The approved image is in the list below,
        marked as approved, and showing it twice made the panel look like it
        held two pictures. Clicking any attempt opens it large.
      */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Every attempt, including the folded ones: the count is the
              accounting, and a heading that hid some of them would be the
              first place the sum went wrong. */}
          <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Tentativas ({attempts.length})
          </span>
          {failedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowFailed((open) => !open)}
              className="text-faint hover:text-foreground text-xs underline underline-offset-2 transition-colors"
            >
              {showFailed
                ? "esconder as que falharam"
                : failedCount === 1
                  ? "mostrar 1 que falhou"
                  : `mostrar ${failedCount} que falharam`}
            </button>
          )}
        </div>
        {/*
          No empty state: the heading already says zero, and a sentence
          repeating it is a line of screen saying nothing twice.
        */}
        {listed.length > 0 && (
          <ul className="flex flex-col gap-3">
            {listed.map((attempt) => {
              // Bound out of the property so the narrowing survives into the
              // click handler, which it does not do through a closure.
              const imageUrl = attempt.imageUrl;
              // Null is "there is nothing honest to say", which is an upload,
              // an attempt still running, and every row from before the
              // stamp existed. See generationSeconds for why each of those
              // shows nothing rather than a zero.
              const took = generationSeconds(attempt);
              const origin = attemptOrigin(attempt);
              const cost = attemptCredits(attempt);
              return (
                <li
                  key={attempt.id}
                  className="border-rule flex flex-wrap items-start gap-3 rounded-sm border p-3"
                >
                  {imageUrl !== null && (
                    <button
                      type="button"
                      onClick={() => onZoom(imageUrl)}
                      title="Ver grande"
                      className="border-rule shrink-0 rounded-sm border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a public bucket URL, shown as stored */}
                      <img
                        src={imageUrl}
                        alt={`Tentativa para ${label}`}
                        className="size-20 rounded-sm object-cover"
                      />
                    </button>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* wrap-anywhere: an uploaded file's name has no spaces
                        to break at, and would run out of the panel. */}
                    <span className="font-mono text-xs wrap-anywhere">
                      {STATUS_LABELS[attempt.status] ?? attempt.status}
                      {isRunning(attempt) &&
                        `, ${elapsedSeconds(attempt.createdAt, now)}s`}
                      {origin !== null && ` · ${origin}`}
                      {took !== null && ` · ${took}s`}
                      {cost !== null && ` · ${cost}`}
                    </span>
                    {attempt.error !== null && (
                      <span className="text-muted text-xs">
                        {attempt.error}
                      </span>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {attempt.status === "generated" && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => onApprove(attempt.id)}
                          className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                        >
                          {busyKey === `aprovar-${attempt.id}`
                            ? "aprovando"
                            : "Aprovar"}
                        </button>
                      )}
                    </div>
                  </div>
                  {/*
                    Generated and nothing else, which is every state where
                    discarding means something.

                    Not while the provider is still drawing: the credits are
                    spent the moment the task opens, so the picture is paid
                    for and on its way. Not on an approved one: it is replaced
                    by approving another, where discarding it here would leave
                    the owner naming an attempt that is no longer a candidate
                    and a file that no longer exists. Not on a failure: that
                    is terminal already, and turning it into a rejection is
                    what lost the two the API refused among the ones the
                    teacher disliked.

                    discardAttempt refuses anything but 'generated' as well.
                    This is the half that stops the control being offered;
                    that is the half that cannot be worked around.
                  */}
                  {attempt.status === "generated" && (
                    <button
                      type="button"
                      disabled={working}
                      aria-label="Descartar esta tentativa e apagar o arquivo"
                      title="Descartar e apagar o arquivo"
                      onClick={() => askToDiscard(attempt)}
                      className="text-faint hover:text-accent shrink-0 self-start rounded-sm p-1.5 transition-colors disabled:opacity-40"
                    >
                      {busyKey === `descartar-${attempt.id}` ? (
                        <span className="block size-3.5 text-center text-[0.6875rem] leading-3.5">
                          ·
                        </span>
                      ) : (
                        <svg
                          viewBox="0 0 16 16"
                          className="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 7v4M9.5 7v4" />
                        </svg>
                      )}
                    </button>
                  )}
                  {/*
                    What this picture was drawn from, which the field above no
                    longer says once the instruction has moved on. A whole
                    line of its own, so it sits under the image.
                  */}
                  {attempt.subject !== null && (
                    <p className="text-muted basis-full text-xs wrap-anywhere">
                      {attempt.subject}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/*
        The one control on this list that destroys something, so the one
        confirmation. The suggestion dialog next door is skipped when a lesson
        has no suggestions to overwrite, because a confirmation with nothing
        to warn about is one people learn to click past; this one is the
        opposite case and never skipped, because the file is always gone
        afterwards.

        It says the number rather than "tem certeza". What stops a person is
        knowing what they are throwing away, and the row now carries it.
      */}
      <dialog
        ref={discard}
        aria-labelledby="descartar-titulo"
        onClose={() => setDiscarding(null)}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        {discarding !== null && (
          <div className="flex flex-col gap-4">
            <h2
              id="descartar-titulo"
              className="text-base font-extrabold tracking-tight"
            >
              Descartar esta imagem?
            </h2>
            <p className="text-muted text-sm">{discardWarning(discarding)}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {/*
                Cancel closes and calls nothing. The form method keeps Esc and
                this button on the same path out.
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
                  // Bound before the close, because closing clears it.
                  const id = discarding.id;
                  discard.current?.close();
                  onDiscard(id);
                }}
                className="border-accent text-accent hover:bg-background rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors"
              >
                Descartar e apagar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
