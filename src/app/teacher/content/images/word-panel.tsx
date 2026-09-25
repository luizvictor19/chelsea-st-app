"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ImageAttempt,
  Representation,
  WordImage,
} from "@/lib/content/queries";
import {
  MAX_REFERENCE_BYTES,
  POLL_INTERVAL_MS,
  REFERENCE_TOO_BIG,
  elapsedSeconds,
  generationSeconds,
  hasExpired,
  isRunning,
  runningAttempt,
} from "@/lib/images/generation";
import {
  IMAGE_MODELS,
  defaultModelFor,
  defaultReferenceModel,
  isImageModelId,
  modelCredits,
  modelLabel,
} from "@/lib/images/provider";
import { isDrawableKind } from "@/lib/images/style";
import {
  UPLOAD_ACCEPT,
  UPLOAD_LIMIT_LABEL,
  refuseUpload,
} from "@/lib/images/upload";

import {
  approveAttempt,
  clearReference,
  pollAttempt,
  rejectAttempt,
  setReference,
  setImageStyle,
  setRepresentation,
  setWordClass,
  saveSubject,
  startGeneration,
  suggestSubject,
  uploadFinishedImage,
  type ActionResult,
} from "./actions";
import { NotAPicture, shrinkReference } from "./shrink-reference";
import {
  attemptCredits,
  attemptOrigin,
  attemptsToShow,
  asksBeforeReclassifying,
  discardWarning,
  reclassifyWarning,
  settle,
  type LastAnswer,
} from "./panel-state";
import { REPRESENTATIONS, disagreement, labelFor } from "./representation";
import { createSubjectSaver, subjectNotSaved } from "./subject-saver";
import { normalizeSubject, openingSubject } from "./subject-store";
import { WORD_CLASS_LABELS } from "./word-class";
import { notices } from "../../notices";

/** Which control is waiting on the server, so only that one shows it. */
type Busy = { readonly key: string } | null;

/** The models that can be handed a picture to work from. */
const ACCEPT_REFERENCE = IMAGE_MODELS.filter(
  (option) => option.reference !== "none",
);

const STATUS_LABELS: Record<string, string> = {
  pending: "gerando",
  generated: "pronta",
  failed: "falhou",
  approved: "aprovada",
  rejected: "descartada",
};

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
  /*
   * The instruction is the word's, in vocabulary_items.image_subject, and the
   * field opens on it. Saving it and asking for a suggestion are the saver's;
   * see subject-saver.ts. A save that fails is said in the teacher area's
   * snackbar, not here: the panel may be gone by the time it answers.
   * `field` mirrors `subject` for the answer of a suggestion, which comes back
   * in a closure from before any typing done while it was on its way.
   */
  const [subject, setSubject] = useState(() => openingSubject(word));
  const field = useRef(subject);
  const [saver] = useState(() =>
    createSubjectSaver({
      initial: word.imageSubject,
      save: (text) => saveSubject(word.id, text),
      onFailure: (answer) => {
        notices.push("error", subjectNotSaved(word.term));
        console.error(answer.cause ?? answer.error);
      },
    }),
  );
  const [subjectNote, setSubjectNote] = useState<string | null>(null);
  /*
   * The model starts on whatever this kind of word starts on, and stays put
   * once the teacher has picked one. Changing the kind moves it again only
   * while it has not been picked: a deliberate choice is not something to
   * undo on someone's behalf, and the panel remounts per word, so a choice
   * lives exactly as long as the word is open.
   */
  const [model, setModel] = useState<string>(() => {
    const forKind = defaultModelFor(word.representation) ?? IMAGE_MODELS[0].id;
    /*
     * A word that already has a reference opens on a model that can use it.
     * Without this the panel would come up in the one state the rules
     * forbid — a reference attached and a model that ignores it — on every
     * word whose kind starts on Seedream.
     */
    if (word.referenceUrl === null) return forKind;
    return defaultReferenceModel() ?? forKind;
  });
  /*
   * A reference decides the model, so a word that opens with one opens with
   * the model already decided: changing the kind must not move it back.
   */
  const [modelPicked, setModelPicked] = useState(word.referenceUrl !== null);
  /*
   * The structure reference, seeded from the server and then owned here.
   * Nothing else on the page changes it, and the panel remounts per word, so
   * the prop is always fresh exactly when it is read.
   */
  const [reference, setReferenceUrl] = useState<string | null>(
    word.referenceUrl,
  );
  /** Said once, right after attaching a reference moved the model. */
  const [modelNote, setModelNote] = useState<string | null>(null);
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
   * Null is "nobody knows", not "free". Flux Kontext Pro is the model this
   * guard was kept for: it went in on 2026-09-19 with its price undocumented
   * and unmeasured, and a model cannot be measured until it has generated
   * once. The screen says so instead of showing a number nobody checked.
   */
  const credits = isImageModelId(model) ? modelCredits(model) : null;
  /*
   * The generation the row says is still open, or null. Taken from the list
   * and not from a flag set on click, which is the whole difference: a flag
   * dies with the page and a row does not, so a reload or a trip to another
   * word finds the generation exactly where it was left.
   */
  const running = runningAttempt(shown);
  /*
   * A failure is terminal already, so the bin is not offered on one: pressing
   * it would reclassify rather than tidy, and the difference between "the
   * provider refused" and "the teacher did not like it" is what tells us
   * whether a failure is charged. Folded out of the list instead, and counted
   * in the heading either way.
   */
  const failedCount = shown.filter(
    (attempt) => attempt.status === "failed",
  ).length;
  const listed = showFailed
    ? shown
    : shown.filter((attempt) => attempt.status !== "failed");
  const runningId = running?.id ?? null;
  const runningStartedAt = running?.createdAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const referenceInput = useRef<HTMLInputElement>(null);
  const finishedInput = useRef<HTMLInputElement>(null);
  /*
   * What a picture made on the Freepik site was drawn from, if the teacher
   * says. It goes on the upload's attempt only, not on the word: the word's
   * instruction is the one the Gerar button uses.
   */
  const [usedSubject, setUsedSubject] = useState("");
  const zoom = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  /*
   * Which attempt the bin is asking about. The bin destroys a picture that
   * has been paid for and the file does not come back, so unlike the
   * suggestion dialog — which lets a lesson with nothing to overwrite go
   * straight through — this one always has something to say, and always says
   * it. What it says is the number; see discardWarning.
   */
  const discard = useRef<HTMLDialogElement>(null);
  const [discarding, setDiscarding] = useState<ImageAttempt | null>(null);
  /*
   * Which kind the type buttons are asking about, when pressing it would take
   * an approved picture off the word.
   *
   * Only then. Moving between kinds that draw takes nothing off anything, and
   * a confirmation that never has something to warn about is one people learn
   * to click through without reading. Which kinds those are is asked of
   * isDrawableKind rather than written out here: the pending-image index, the
   * function in the database and that predicate are held to one answer by
   * scripts/drawable-kinds.test.ts, and a fourth copy on this screen would be
   * outside it.
   */
  const reclassify = useRef<HTMLDialogElement>(null);
  const [reclassifying, setReclassifying] = useState<Representation | null>(
    null,
  );

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

  /** The same native dialog, for the one control that destroys something. */
  function askToDiscard(attempt: ImageAttempt) {
    setDiscarding(attempt);
    discard.current?.showModal();
  }

  /** Save the kind, and move the model along with it when nobody chose one. */
  function saveKind(kind: Representation) {
    void run(`tipo-${kind}`, async () => {
      const result = await setRepresentation(word.id, kind);
      if (result.ok && !modelPicked) {
        setModel(defaultModelFor(kind) ?? model);
      }
      return result;
    });
  }

  /**
   * Pressing a type: straight through, unless it would take an approved
   * picture off the word.
   *
   * The picture is not destroyed by this — from 0021 it goes back to being a
   * candidate with its file — so the question is not the bin's. It is still
   * worth asking, because eight one-click buttons with no dialog between them
   * and a word's picture is exactly the control AGENTS.md puts in the high
   * column: a save that drops work without saying so.
   */
  function pressKind(kind: Representation) {
    if (!asksBeforeReclassifying(kind, word.imageUrl)) {
      saveKind(kind);
      return;
    }
    setReclassifying(kind);
    reclassify.current?.showModal();
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

  function editSubject(text: string) {
    field.current = text;
    setSubject(text);
    setSubjectNote(null);
  }

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
    // Absent means untouched, a string is the one the word now has, and null
    // is "there is none any more". Read before the branch for the same reason
    // the list is.
    if ("reference" in result && result.reference !== undefined) {
      setReferenceUrl(result.reference);
    }
    if (!result.ok) {
      setError(result.error);
      // The teacher reads a sentence in Portuguese that says what to do. The
      // reason is English and belongs in the console, which is where the next
      // diagnosis of this starts.
      if ("cause" in result) console.error(result.cause);
    }
  }

  /*
   * With a reference attached the selector offers only the models that can
   * use one. One rule and no impossible state: to go back to the others, take
   * the reference off. Taking it off does not put the model back where it
   * was — the model is where the last explicit choice left it, and moving it
   * on its own would be the program guessing again. The price stays on the
   * option and in the line under it either way.
   */
  const modelOptions =
    reference !== null && ACCEPT_REFERENCE.length > 0
      ? ACCEPT_REFERENCE
      : IMAGE_MODELS;

  /*
   * Which model accepts a reference is knowledge the program has and the
   * teacher should not need. So attaching one says what it wants — use this
   * as the guide — and the program moves the model and says so. Declared
   * choice, not silent guesswork.
   */
  function moveModelToTakeReference() {
    const target = defaultReferenceModel();
    if (target === null || target === model) {
      setModelNote(null);
      return;
    }
    setModel(target);
    setModelPicked(true);
    setModelNote(
      ACCEPT_REFERENCE.length === 1
        ? `Mudei para ${modelLabel(target)}, o único modelo que aceita referência.`
        : `Mudei para ${modelLabel(target)}, que aceita referência e tem custo medido. Os outros que aceitam estão no seletor.`,
    );
  }

  function attachReference(file: File) {
    void run("referencia", async () => {
      let ready: File;
      try {
        // Shrunk here so the teacher never has to think about file size, and
        // so the body that leaves the browser is a few hundred KB.
        ready = await shrinkReference(file);
      } catch (cause) {
        if (cause instanceof NotAPicture) {
          return {
            ok: false,
            error: "Não consegui ler esse arquivo como imagem.",
          };
        }
        throw cause;
      }
      if (ready.size > MAX_REFERENCE_BYTES) {
        return { ok: false, error: REFERENCE_TOO_BIG };
      }
      const result = await setReference(word.id, ready);
      if (result.ok) moveModelToTakeReference();
      return result;
    });
  }

  function sendFinished(file: File) {
    void run("enviar-pronta", async () => {
      /*
       * Asked here before a byte leaves the browser, and again in the action.
       * The size above all: over serverActions.bodySizeLimit Next refuses
       * with a 413, which reaches this panel as a lost connection, so a file
       * that is merely too big has to be stopped where the sentence can say
       * so. Nothing is shrunk: this is the picture itself, not a guide.
       */
      const refusal = refuseUpload({
        size: file.size,
        type: file.type,
        kind: word.representation,
      });
      if (refusal !== null) return { ok: false, error: refusal };
      // A save of the Instrução field still on its way lands first, so the
      // instruction given with the upload is the one the word ends on.
      if (normalizeSubject(usedSubject) !== null) {
        await saver.save(field.current);
      }
      const result = await uploadFinishedImage(word.id, file, usedSubject);
      if (result.ok) {
        /*
         * An instruction given with the upload is the word's now, so the
         * field shows it and the saver knows the column holds it: otherwise
         * the next Gerar would put the old text back on the word.
         */
        const given = normalizeSubject(usedSubject);
        if (given !== null) {
          saver.known(given);
          field.current = given;
          setSubject(given);
          setSubjectNote(null);
        }
        setUsedSubject("");
      }
      return result;
    });
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
              onClick={() => pressKind(kind)}
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
          {/*
            Above the Instrução field, and the order is not a matter of
            layout. The style decides which rules the suggest button asks
            under: what makes a picture recognisable is the outline in a flat
            vector and the material, the scale and the context in a
            photograph. Chosen after the instruction has been written, it
            leaves a phrase composed under the rules of the other style, and
            nothing on the screen would say so. Things go in the order they
            are used.

            The style belongs to the word, not to the press. Ticked here it is
            saved on the word, so it survives a reload, a change of model and
            a dozen attempts: "room is realistic" becomes a decision rather
            than something to remember to repeat every time.

            Nothing already generated moves. The pictures in the bucket were
            made under the style written into the prompt of their attempt, and
            that row goes on being true about them; this decides the next
            generation.
          */}
          <div className="flex flex-col gap-2">
            <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
              Estilo
            </span>
            <label className="flex w-fit items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={word.imageStyle === "realistic"}
                disabled={working}
                onChange={(event) => {
                  const style = event.target.checked ? "realistic" : "flat";
                  void run("estilo", () => setImageStyle(word.id, style));
                }}
                className="accent-foreground size-4"
              />
              {busy?.key === "estilo" ? "salvando" : "Realista"}
            </label>
            <p className="text-faint text-xs">
              Vetor chapado por padrão. Realista é para o que não tem silhueta
              para recortar, como um cômodo ou um teto.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="assunto"
              className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
            >
              Instrução
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
                onChange={(event) => editSubject(event.target.value)}
                onBlur={() => void saver.save(subject)}
                placeholder="o que a imagem mostra, em inglês"
                className="border-rule bg-background w-full rounded-sm border py-2 pr-10 pl-3 text-sm"
              />
              <button
                type="button"
                disabled={working}
                aria-label="Sugerir instrução"
                title="Sugerir uma instrução para esta palavra"
                onClick={() =>
                  void run("assunto", async () => {
                    const answer = await saver.suggest(
                      field.current,
                      () => field.current,
                      (expected) => suggestSubject(word.id, expected),
                    );
                    if (!answer.ok) return answer;
                    field.current = answer.field;
                    setSubject(answer.field);
                    setSubjectNote(answer.note);
                    return { ok: true };
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
            {subjectNote !== null && (
              <p className="text-muted text-xs">{subjectNote}</p>
            )}
            <p className="text-faint text-xs">
              Aqui vai só o que a imagem mostra. O estilo não se escreve aqui:
              ele entra sozinho, no formato que a caixa acima escolher.
            </p>

            {/*
              Always offered, on every kind that draws. Which model can use a
              reference is the program's business: the teacher says "use this
              as the guide" and the program moves the model and says so.
              Hiding the field until the right model happened to be chosen
              would ask them to know the answer before they could ask the
              question.
            */}
            <div className="flex flex-col gap-2 pt-2">
              <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
                Referência
              </span>
              {reference === null ? (
                <div>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => referenceInput.current?.click()}
                    className="border-rule hover:bg-background rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
                  >
                    {busy?.key === "referencia" ? "subindo" : "Anexar imagem"}
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => openZoom(reference)}
                    title="Ver grande"
                    className="border-rule shrink-0 rounded-sm border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
                    <img
                      src={reference}
                      alt={`Referência de ${word.term}`}
                      className="size-20 rounded-sm object-cover"
                    />
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => referenceInput.current?.click()}
                      className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                    >
                      {busy?.key === "referencia" ? "subindo" : "Trocar"}
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() =>
                        void run("tirar-referencia", async () => {
                          const result = await clearReference(word.id);
                          // The model stays where the last explicit choice
                          // left it; only the note about it goes.
                          if (result.ok) setModelNote(null);
                          return result;
                        })
                      }
                      className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-50"
                    >
                      {busy?.key === "tirar-referencia" ? "tirando" : "Tirar"}
                    </button>
                  </div>
                </div>
              )}
              <input
                ref={referenceInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) attachReference(file);
                }}
              />
              <p className="text-faint text-xs">
                A imagem entra como guia de forma, não de estilo. O estilo
                continua vindo do prompt, no formato escolhido para esta
                palavra.
              </p>
            </div>

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
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.credits === null
                        ? " · custo não medido"
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
            </div>

            {/*
              One line for what the reference just did, or for the rule it
              puts the selector under while it is attached. The same slot for
              both: they never apply at once, and two lines here would be two
              lines of screen saying the same thing twice.
            */}
            {(modelNote !== null || reference !== null) && (
              <p className="text-faint text-xs">
                {modelNote ??
                  "Com uma referência anexada, só os modelos que aceitam uma. Tire a referência para escolher os outros."}
              </p>
            )}
            {/*
              What this costs. Said outside the select, because an option is
              only readable while the list is open, and the number matters
              most at the moment of pressing Gerar: Seedream at 50, Mystic at
              80, and Kontext at a price nobody has read off the dashboard
              yet. The sentence for that last case is not decoration any
              more — one of the three reaches it.
            */}
            <p className="text-faint text-xs">
              {credits === null
                ? "O custo deste modelo ainda não foi medido no painel do Freepik."
                : `${credits} créditos por imagem, medido no painel do Freepik.`}
            </p>

            {/*
              Apart from the reference on purpose. That one guides a
              generation; this is a picture finished outside the platform,
              and it goes into the list below as an attempt, to be approved
              like any other.
            */}
            <div className="flex flex-col gap-2 pt-2">
              <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
                Imagem pronta
              </span>
              <label htmlFor="instrucao-usada" className="text-faint text-xs">
                Instrução usada (opcional)
              </label>
              <input
                id="instrucao-usada"
                value={usedSubject}
                onChange={(event) => setUsedSubject(event.target.value)}
                placeholder="o que você pediu no Freepik, se quiser guardar"
                className="border-rule bg-background w-full rounded-sm border px-3 py-2 text-sm"
              />
              <div>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => finishedInput.current?.click()}
                  className="border-rule hover:bg-background rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  {busy?.key === "enviar-pronta"
                    ? "enviando"
                    : "Enviar imagem pronta"}
                </button>
              </div>
              <input
                ref={finishedInput}
                type="file"
                accept={UPLOAD_ACCEPT}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) sendFinished(file);
                }}
              />
              <p className="text-faint text-xs">
                PNG, JPEG ou WebP de até {UPLOAD_LIMIT_LABEL}, enviado como
                está. Entra nas tentativas e espera a sua aprovação.
              </p>
            </div>
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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Every attempt, including the folded ones: the count is the
              accounting, and a heading that hid some of them would be the
              first place the sum went wrong. */}
          <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Tentativas ({shown.length})
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
                    Generated and nothing else, which is every state where
                    discarding means something.

                    Not while the provider is still drawing: the credits are
                    spent the moment the task opens, so the picture is paid
                    for and on its way. Not on an approved one: it is replaced
                    by approving another, where discarding it here would leave
                    the word naming an attempt that is no longer a candidate
                    and a file that no longer exists. Not on a failure: that
                    is terminal already, and turning it into a rejection is
                    what lost the two the API refused among the ones the
                    teacher disliked.

                    rejectAttempt refuses anything but 'generated' as well.
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
                  {/*
                    What this picture was drawn from, which the field above no
                    longer says once the word's instruction has moved on. A
                    whole line of its own, so it sits under the image.
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
        The one control on this panel that destroys something, so the one
        confirmation. The suggestion dialog next door is skipped when a lesson
        has no suggestions to overwrite, because a confirmation with nothing
        to warn about is one people learn to click past; this one is the
        opposite case and never skipped, because the file is always gone
        afterwards.

        It says the number rather than "tem certeza". What stops a person is
        knowing what they are throwing away, and the row now carries it.
      */}
      {/*
        Asked only when a type that carries no picture would take an approved
        one off the word. It is not the bin: nothing is destroyed here, and
        the second sentence says so, because a teacher who reads only the
        first will go and generate a replacement for a picture still sitting
        in the list.
      */}
      <dialog
        ref={reclassify}
        aria-labelledby="reclassificar-titulo"
        onClose={() => setReclassifying(null)}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        {reclassifying !== null && (
          <div className="flex flex-col gap-4">
            <h2
              id="reclassificar-titulo"
              className="text-base font-extrabold tracking-tight"
            >
              Tirar a imagem desta palavra?
            </h2>
            <p className="text-muted text-sm">
              {reclassifyWarning(labelFor(reclassifying))}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
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
                  const kind = reclassifying;
                  reclassify.current?.close();
                  saveKind(kind);
                }}
                className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
              >
                Trocar o tipo
              </button>
            </div>
          </div>
        )}
      </dialog>

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
                  void run(`descartar-${id}`, () => rejectAttempt(id));
                }}
                className="border-accent text-accent hover:bg-background rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors"
              >
                Descartar e apagar
              </button>
            </div>
          </div>
        )}
      </dialog>

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
