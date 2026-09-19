"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ImageAttempt,
  Representation,
  WordImage,
} from "@/lib/content/queries";
import {
  POLL_INTERVAL_MS,
  elapsedSeconds,
  generationSeconds,
  hasExpired,
  isRunning,
  runningAttempt,
} from "@/lib/images/generation";
import {
  IMAGE_MODELS,
  defaultModelFor,
  isImageModelId,
  modelCredits,
} from "@/lib/images/provider";
import { isDrawableKind } from "@/lib/images/style";

import {
  approveAttempt,
  pollAttempt,
  rejectAttempt,
  setRepresentation,
  setWordClass,
  startGeneration,
  suggestSubject,
  uploadImage,
  type ActionResult,
} from "./actions";
import { attemptsToShow, settle, type LastAnswer } from "./panel-state";
import { REPRESENTATIONS, disagreement, labelFor } from "./representation";
import { WORD_CLASS_LABELS } from "./word-class";

/** Which control is waiting on the server, so only that one shows it. */
type Busy = { readonly key: string } | null;

const STATUS_LABELS: Record<string, string> = {
  pending: "gerando",
  generated: "pronta",
  failed: "falhou",
  approved: "aprovada",
  rejected: "descartada",
};

/**
 * What to put in the Assunto field when a word is opened: what the approved
 * attempt was drawn from, and failing that the most recent attempt that had a
 * subject at all.
 *
 * Uploads carry none, so they are skipped rather than allowed to blank the
 * field: the teacher uploading a file by hand is not a statement that the
 * last subject was wrong.
 */
function lastSubject(attempts: readonly ImageAttempt[]): string {
  const approved = attempts.find((attempt) => attempt.status === "approved");
  if (approved?.subject) return approved.subject;
  return attempts.find((attempt) => attempt.subject)?.subject ?? "";
}

export function WordPanel({
  word,
  attempts,
}: {
  readonly word: WordImage;
  readonly attempts: readonly ImageAttempt[];
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * The list the last action answered with, shown only until the server sends
   * one of its own. See attemptsToShow: this is not optimism, it is the
   * answer, and nothing is put here before the action has given it.
   */
  const [answered, setAnswered] = useState<LastAnswer<ImageAttempt> | null>(
    null,
  );
  const shown = attemptsToShow(attempts, answered);
  const [subject, setSubject] = useState(() => lastSubject(attempts));
  /*
   * The model starts on whatever this kind of word starts on, and stays put
   * once the teacher has picked one. Changing the kind moves it again only
   * while it has not been picked: a deliberate choice is not something to
   * undo on someone's behalf, and the panel remounts per word, so a choice
   * lives exactly as long as the word is open.
   */
  const [model, setModel] = useState<string>(
    () => defaultModelFor(word.representation) ?? IMAGE_MODELS[0].id,
  );
  const [modelPicked, setModelPicked] = useState(false);
  /*
   * Null is "nobody knows", not "free". Both models on the list are measured
   * now, so nothing reaches it today: it is the guard for the model added
   * next, which cannot be measured until it has generated once.
   */
  const credits = isImageModelId(model) ? modelCredits(model) : null;
  /*
   * The generation the row says is still open, or null. Taken from the list
   * and not from a flag set on click, which is the whole difference: a flag
   * dies with the page and a row does not, so a reload or a trip to another
   * word finds the generation exactly where it was left.
   */
  const running = runningAttempt(shown);
  const runningId = running?.id ?? null;
  const runningStartedAt = running?.createdAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const zoom = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);

  /*
   * The native dialog again, the same one the confirmation uses: showModal
   * brings Esc and the focus move, and there is still no dialog of our own
   * to reuse. The image is set first so the element has something to paint
   * before it opens.
   */
  function openZoom(url: string) {
    setZoomed(url);
    zoom.current?.showModal();
  }

  /*
   * A generation took 8 to 21 seconds on 2026-09-19, which is long enough
   * that the wait is counted out loud. The clock ticks only while something
   * is running, and the count is worked out from the row's created_at, so it
   * reads right on a generation started before this page was loaded.
   */
  useEffect(() => {
    if (runningId === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningId]);

  /*
   * The question the panel asks while a generation is open, every couple of
   * seconds: how is it going. Each ask is a short call, which is the entire
   * point — nothing on the path ever sees a request worth cutting.
   *
   * Sequential and not an interval: the last ask of a generation is the one
   * that downloads the picture and puts it in the bucket, and two of those
   * running at once would do the work twice.
   *
   * A call that does not come back is not an answer about the generation, so
   * it is asked again rather than treated as a verdict; the row is still open
   * at the provider either way. That stops when the row could no longer be
   * alive, which is the same window the server judges it by, so no second
   * number decides it.
   */
  useEffect(() => {
    const attemptId = runningId;
    const startedAt = runningStartedAt;
    if (attemptId === null || startedAt === null) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    // The ids travel as arguments rather than as captured nulls-that-are-not,
    // so nothing here needs an assertion to know they are there.
    function again(id: string, from: string) {
      timer = setTimeout(() => void ask(id, from), POLL_INTERVAL_MS);
    }

    async function ask(id: string, from: string) {
      const result = await settle(() => pollAttempt(id));
      if (stopped) return;
      if ("attempts" in result && result.attempts !== undefined) {
        setAnswered({ list: result.attempts, served: attempts });
      }
      if (!result.ok) {
        if ("cause" in result) {
          console.error(result.cause);
          if (!hasExpired(from, Date.now())) {
            again(id, from);
            return;
          }
        }
        setError(result.error);
        return;
      }
      again(id, from);
    }

    again(attemptId, startedAt);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runningId, runningStartedAt, attempts]);

  /*
   * Nothing on this screen moves before the server answers. A picture that
   * appears and then vanishes because the upload failed is worse than one that
   * takes a second to appear.
   *
   * What happens after it answers used to be router.refresh(). It is not any
   * more, for two reasons that are really one. The action has already called
   * revalidatePath, so its own response carries the re-render and a refresh
   * asked for the same page a second time. And refresh() returns void: the
   * request it sends belongs to nobody, so when it failed there was nobody to
   * tell, and the screen stayed a refresh behind with an unowned rejection on
   * the window. That is 19/09/2026.
   *
   * In its place the action answers with the list, and settle makes sure this
   * ends either way. A call that never comes back is an answer too.
   */
  async function run(key: string, action: () => Promise<ActionResult>) {
    if (busy !== null) return;
    setBusy({ key });
    setError(null);
    const result = await settle(action);
    setBusy(null);
    // Read before the branch: a refused generation leaves a 'failed' row, and
    // the teacher should see the row as well as the reason. Absent means the
    // action did not touch the list, not that the list is empty.
    if ("attempts" in result && result.attempts !== undefined) {
      setAnswered({ list: result.attempts, served: attempts });
    }
    if (!result.ok) {
      setError(result.error);
      // The teacher reads a sentence in Portuguese that says what to do. The
      // reason is English and belongs in the console, which is where the next
      // diagnosis of this starts.
      if ("cause" in result) console.error(result.cause);
    }
  }

  const working = busy !== null;
  /*
   * A suggestion is only offered while the word has no decision. Once the
   * teacher has decided, the suggestion has done its job and stays in the
   * column for the measurement rather than on the screen.
   */
  const suggested =
    word.representation === null ? word.suggestedRepresentation : null;
  const drawable =
    word.representation !== null && isDrawableKind(word.representation);
  /*
   * What the model thought, on a word that has already been decided against
   * it. Shown quietly and without an accept button: the teacher changes their
   * mind by pressing the type, not by accepting an old proposal.
   */
  const disagrees = disagreement(
    word.representation,
    word.suggestedRepresentation,
  );

  /*
   * Three states, and they have to look like three different things. Filled
   * is a decision the teacher made. Dashed in amber is the model proposing,
   * outline and not fill because a proposal that looked like a record would
   * be read as one. Plain is neither.
   *
   * The colours carry the rule the whole screen follows: amber is the model
   * speaking, the accent is the teacher deciding. A proposal in the accent
   * colour claimed an authority it does not have, and read as an alarm on top
   * of that.
   *
   * A decision that agrees with the suggestion lands as filled, because
   * `suggested` is already null once a decision exists. Agreement is not its
   * own state: once the teacher has decided, who thought of it first belongs
   * to the measurement.
   */
  function kindClass(kind: Representation): string {
    const base =
      "rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
    if (word.representation === kind) {
      return `${base} border-foreground bg-foreground text-background font-semibold`;
    }
    if (suggested === kind) {
      return `${base} border-dashed border-warning text-foreground`;
    }
    return `${base} border-rule text-muted hover:bg-background`;
  }

  return (
    <section
      aria-label={`Imagem de ${word.term}`}
      className="border-rule bg-surface flex flex-col gap-6 rounded-sm border p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold tracking-tight">{word.term}</h2>
        {word.pointNumber !== null && (
          <span className="text-faint font-mono text-xs">
            ponto {word.pointNumber}
          </span>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="classe"
          className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
        >
          Classe
        </label>
        {/*
          One column and no suggested pair, so this select is both what the
          model said and what the teacher says. Editing it is a correction,
          not a decision recorded beside a proposal.
        */}
        <select
          id="classe"
          value={word.wordClass ?? ""}
          disabled={working}
          onChange={(event) => {
            const value = event.target.value;
            void run(`classe`, () =>
              setWordClass(
                word.id,
                value === ""
                  ? null
                  : (value as (typeof WORD_CLASS_LABELS)[number]["value"]),
              ),
            );
          }}
          className="border-rule bg-background w-full rounded-sm border px-3 py-2 text-sm disabled:opacity-50"
        >
          <option value="">sem classe</option>
          {WORD_CLASS_LABELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Tipo
        </span>
        <div className="flex flex-wrap gap-2">
          {REPRESENTATIONS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              disabled={working}
              onClick={() =>
                void run(`tipo-${kind}`, async () => {
                  const result = await setRepresentation(word.id, kind);
                  if (result.ok && !modelPicked) {
                    setModel(defaultModelFor(kind) ?? model);
                  }
                  return result;
                })
              }
              className={kindClass(kind)}
            >
              {busy?.key === `tipo-${kind}` ? "salvando" : label}
            </button>
          ))}
        </div>
        {disagrees !== null && (
          <p className="text-warning pt-1 text-xs">
            O modelo sugeriu {labelFor(disagrees).toLowerCase()}.
          </p>
        )}
        {suggested !== null && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="text-warning text-xs">
              O modelo sugere {labelFor(suggested).toLowerCase()}.
            </span>
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void run("aceitar", () => setRepresentation(word.id, suggested))
              }
              className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy?.key === "aceitar" ? "aceitando" : "Aceitar sugestão"}
            </button>
          </div>
        )}
      </div>

      {/*
        Only the kinds an image is generated for. A symbol is the character,
        drawn by the screen, and an undecided word has no rule to generate
        under: offering a button that is certain to come back with an error
        is worse than not offering it.
      */}
      {drawable ? (
        <>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="assunto"
              className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
            >
              Assunto
            </label>
            {/*
              The suggest control sits inside the field rather than beside it:
              it belongs to this one input and it is not worth a line of its
              own. It only ever fills the field, so it is reachable and
              harmless, and the teacher edits what lands there.
            */}
            <div className="relative">
              <input
                id="assunto"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="o que a imagem mostra, em inglês"
                className="border-rule bg-background w-full rounded-sm border py-2 pr-10 pl-3 text-sm"
              />
              <button
                type="button"
                disabled={working}
                aria-label="Sugerir assunto"
                title="Sugerir um assunto para esta palavra"
                onClick={() =>
                  void run("assunto", async () => {
                    const result = await suggestSubject(word.id);
                    if (result.ok) setSubject(result.subject);
                    return result.ok
                      ? { ok: true }
                      : { ok: false, error: result.error };
                  })
                }
                className="text-faint hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1.5 transition-colors disabled:opacity-40"
              >
                {busy?.key === "assunto" ? (
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
                    aria-hidden="true"
                  >
                    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M12.6 3.4l-2.1 2.1M5.5 10.5l-2.1 2.1" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-faint text-xs">
              O estilo é fixo e entra sozinho. Aqui vai só o que a imagem
              mostra.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {IMAGE_MODELS.length > 1 && (
                <select
                  aria-label="Modelo"
                  value={model}
                  onChange={(event) => {
                    setModelPicked(true);
                    setModel(event.target.value);
                  }}
                  className="border-rule bg-background rounded-sm border px-3 py-2 text-sm"
                >
                  {IMAGE_MODELS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.credits === null
                        ? " · custo desconhecido"
                        : ` · ${option.credits} créditos`}
                    </option>
                  ))}
                </select>
              )}
              {/*
                Disabled while one is open, and the count is in the list
                below rather than on this button. The wait belongs to the
                attempt now, not to the press: the row is what is waiting, so
                the row is where the seconds are shown.
              */}
              <button
                type="button"
                disabled={working || running !== null || subject.trim() === ""}
                onClick={() =>
                  void run("gerar", () =>
                    startGeneration(word.id, subject, model),
                  )
                }
                className="border-foreground bg-foreground text-background rounded-sm border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy?.key === "gerar" ? "enviando" : "Gerar"}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => fileInput.current?.click()}
                className="border-rule hover:bg-background rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {busy?.key === "subir" ? "subindo" : "Subir arquivo"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void run("subir", () => uploadImage(word.id, file));
                }}
              />
            </div>
            {/*
              What this costs. Said outside the select, because an option is
              only readable while the list is open, and the number matters
              most at the moment of pressing Gerar, where the two models are
              50 credits against 80 and the choice is a price.

              The other sentence is what an unmeasured model would say, and
              neither of today's two can reach it.
            */}
            <p className="text-faint text-xs">
              {credits === null
                ? "O custo deste modelo não está documentado."
                : `${credits} créditos por imagem, medido no painel do Freepik.`}
            </p>
          </div>
        </>
      ) : (
        <p className="text-faint text-sm">
          {word.representation === null
            ? "Escolha o tipo da palavra para poder gerar a imagem."
            : "Este tipo não leva imagem gerada."}
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          className="border-accent text-accent rounded-sm border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {/*
        No separate Aprovada block. The approved image is in the list below,
        marked as approved, and showing it twice made the panel look like it
        held two pictures. Clicking any attempt opens it large.
      */}
      <div className="flex flex-col gap-3">
        <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Tentativas ({shown.length})
        </span>
        {/*
          No empty state: the heading already says zero, and a sentence
          repeating it is a line of screen saying nothing twice.
        */}
        {shown.length > 0 && (
          <ul className="flex flex-col gap-3">
            {shown.map((attempt) => {
              // Bound out of the property so the narrowing survives into the
              // click handler, which it does not do through a closure.
              const imageUrl = attempt.imageUrl;
              // Null is "there is nothing honest to say", which is an upload,
              // an attempt still running, and every row from before the
              // stamp existed. See generationSeconds for why each of those
              // shows nothing rather than a zero.
              const took = generationSeconds(attempt);
              return (
                <li
                  key={attempt.id}
                  className="border-rule flex flex-wrap items-start gap-3 rounded-sm border p-3"
                >
                  {imageUrl !== null && (
                    <button
                      type="button"
                      onClick={() => openZoom(imageUrl)}
                      title="Ver grande"
                      className="border-rule shrink-0 rounded-sm border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
                      <img
                        src={imageUrl}
                        alt={`Tentativa para ${word.term}`}
                        className="size-20 rounded-sm object-cover"
                      />
                    </button>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-mono text-xs">
                      {STATUS_LABELS[attempt.status] ?? attempt.status}
                      {isRunning(attempt) &&
                        `, ${elapsedSeconds(attempt.createdAt, now)}s`}
                      {attempt.model !== null && ` · ${attempt.model}`}
                      {took !== null && ` · ${took}s`}
                      {attempt.creditsSpent !== null &&
                        ` · ${attempt.creditsSpent} créditos`}
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
                          onClick={() =>
                            void run(`aprovar-${attempt.id}`, () =>
                              approveAttempt(attempt.id),
                            )
                          }
                          className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                        >
                          {busy?.key === `aprovar-${attempt.id}`
                            ? "aprovando"
                            : "Aprovar"}
                        </button>
                      )}
                    </div>
                  </div>
                  {/*
                    Not offered while the provider is still drawing. The
                    credits are spent the moment the task opens, so discarding
                    a running attempt would throw away a picture that has been
                    paid for and is on its way, from behind an icon with no
                    label. It comes back the moment the row settles.
                  */}
                  {attempt.status !== "rejected" && !isRunning(attempt) && (
                    <button
                      type="button"
                      disabled={working}
                      aria-label="Descartar esta tentativa"
                      title="Descartar"
                      onClick={() =>
                        void run(`descartar-${attempt.id}`, () =>
                          rejectAttempt(attempt.id),
                        )
                      }
                      className="text-faint hover:text-accent shrink-0 self-start rounded-sm p-1.5 transition-colors disabled:opacity-40"
                    >
                      {busy?.key === `descartar-${attempt.id}` ? (
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/*
        Esc closes it, and so does clicking outside the picture. A click on
        the backdrop of a native dialog lands on the dialog element itself,
        not on anything inside it, so the content sits in its own element and
        the handler closes only when the click never reached it. Clicking the
        picture does nothing, because looking closely at something is not a
        reason to have it taken away.
      */}
      <dialog
        ref={zoom}
        onClose={() => setZoomed(null)}
        onClick={(event) => {
          if (event.target === zoom.current) zoom.current?.close();
        }}
        className="bg-surface text-foreground border-rule m-auto max-w-[min(90vw,40rem)] rounded-sm border p-2 backdrop:bg-black/70"
      >
        {zoomed !== null && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
            <img
              src={zoomed}
              alt={`Imagem de ${word.term}`}
              className="max-h-[80vh] w-auto rounded-sm"
            />
          </div>
        )}
      </dialog>
    </section>
  );
}
