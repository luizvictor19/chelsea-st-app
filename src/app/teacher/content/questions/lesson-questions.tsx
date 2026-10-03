"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  placeKey,
  wordsByPoint,
  type SetRow,
  type WordGroup,
} from "@/lib/questions/point-words";
import {
  createChecker,
  type Checker,
  type Mark,
  type Place,
} from "@/lib/questions/presented";
import type {
  BookPoint,
  LessonPoint,
  Question,
  ScreenWord,
} from "@/lib/questions/queries";
import {
  approvedPicture,
  shownWordOptions,
  type PicturedWord,
  type ShownWordOption,
} from "@/lib/questions/shown-word";
import {
  countUsage,
  createUsageReader,
  type UsageQuestion,
} from "@/lib/questions/word-usage";

import { moveMember } from "../images/contrast-sets";
import { settle } from "../images/panel-state";

import {
  addQuestion,
  deleteQuestion,
  reorderQuestions,
  saveQuestion,
  type QuestionResult,
} from "./actions";
import {
  ANSWER_LANGUAGES,
  EMPTY,
  closed,
  isAnswerLanguage,
  isDirty,
  opened,
  refusal,
  type QuestionFields,
} from "./draft";
import { segments, standing, summary } from "./marks";
import {
  pointFailed,
  pointLabel,
  questionAdded,
  questionDeleted,
  questionFailed,
  questionSaved,
  tell,
  type NoticeText,
} from "./notice-texts";
import {
  draftLights,
  earlierLessons,
  lessonMean,
  type OpenDraft,
} from "./usage";
import {
  UsageChip,
  WordUsagePanel,
  type ChipWord,
  type UsageView,
} from "./word-usage-panel";

/** Whether two reports of a form say the same sentences. */
function sameDraft(a: OpenDraft | undefined, b: OpenDraft): boolean {
  if (a === undefined) return false;
  const same = (x: OpenDraft["draft"], y: OpenDraft["draft"]) =>
    x.prompt === y.prompt &&
    x.expectedAnswer === y.expectedAnswer &&
    x.answerLanguage === y.answerLanguage;
  if (a.saved === null || b.saved === null) {
    return a.saved === b.saved && same(a.draft, b.draft);
  }
  return same(a.saved, b.saved) && same(a.draft, b.draft);
}

/** Tells the screen what an open form holds, or null once it closes. */
type ReportDraft = (form: string, open: OpenDraft | null) => void;

/**
 * The questions of one lesson, point by point: what each point presents, the
 * questions written for it, and the forms that add and edit them.
 *
 * The validator runs here, in the browser, on what is saved and on what is
 * being typed. It marks and never stops a save: see presented.ts.
 *
 * So does the usage count (word-usage.ts), from the questions of the whole
 * book as the server read them: every action revalidates the screen, the
 * props arrive new, and the counts follow with no reload.
 */
export function LessonQuestions({
  book,
  lesson,
  points,
  questions,
  words,
  sets,
  bookQuestions,
  bookPoints,
}: {
  readonly book: number;
  readonly lesson: number;
  readonly points: readonly LessonPoint[];
  readonly questions: readonly Question[];
  readonly words: readonly ScreenWord[];
  readonly sets: readonly SetRow[];
  readonly bookQuestions: readonly UsageQuestion[];
  readonly bookPoints: readonly BookPoint[];
}) {
  const checker = useMemo(() => {
    const setOf = new Map(
      sets.map((row) => [row.vocabulary_item_id, row.set_id]),
    );
    return createChecker(
      words.map((word) => ({
        term: word.term,
        place: word.place,
        setId: setOf.get(word.id) ?? null,
      })),
    );
  }, [words, sets]);
  const groups = useMemo(() => wordsByPoint(words, sets), [words, sets]);
  const wordOf = useMemo(
    () => new Map(words.map((word) => [word.id, word])),
    [words],
  );

  const reader = useMemo(() => createUsageReader(words), [words]);
  const usage = useMemo(
    () => countUsage(reader, bookQuestions),
    [reader, bookQuestions],
  );
  // Every form open on the screen, by the key the form gives itself.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, OpenDraft>>(
    new Map(),
  );
  const reportDraft = useCallback<ReportDraft>((form, open) => {
    setDrafts((known) => {
      // The same map for the same news, so React stops here: a form reports
      // on every render of its point, and a new map each time would render
      // the point again, for ever.
      const had = known.get(form);
      if (open === null ? had === undefined : sameDraft(had, open)) {
        return known;
      }
      const next = new Map(known);
      if (open === null) next.delete(form);
      else next.set(form, open);
      return next;
    });
  }, []);
  const view: UsageView = useMemo(
    () => ({ usage, lights: draftLights(reader, [...drafts.values()]) }),
    [usage, reader, drafts],
  );

  /** The words a point presents, a set's members side by side. */
  const wordsAt = (point: number): readonly ChipWord[] =>
    (groups.get(placeKey({ book, point })) ?? []).flatMap((group) =>
      group.ids.map((id, index) => ({ id, term: group.terms[index] })),
    );
  const meanOf = (numbers: readonly number[]) =>
    lessonMean(
      numbers.flatMap((number) => wordsAt(number).map((word) => word.id)),
      usage,
    );
  const mean = meanOf(points.map((point) => point.number));

  return (
    <div className="flex flex-col gap-10">
      <WordUsagePanel
        lesson={lesson}
        mean={mean}
        points={points.map((point) => ({
          point: point.number,
          words: wordsAt(point.number),
        }))}
        earlier={earlierLessons(bookPoints, lesson).map((before) => ({
          lesson: before.lesson,
          mean: meanOf(before.points),
          points: before.points.map((point) => ({
            point,
            words: wordsAt(point),
          })),
        }))}
        view={view}
      />
      {points.map((point) => {
        const at = { book, point: point.number };
        return (
          <PointSection
            key={point.id}
            at={at}
            pointId={point.id}
            groups={groups.get(placeKey(at)) ?? []}
            shownWords={shownWordOptions(words, sets, at)}
            wordOf={wordOf}
            questions={questions.filter(
              (question) => question.pointId === point.id,
            )}
            checker={checker}
            mean={mean}
            view={view}
            reportDraft={reportDraft}
          />
        );
      })}
    </div>
  );
}

function fieldsOf(question: Question): QuestionFields {
  return {
    prompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    answerLanguage: question.answerLanguage,
    isPublished: question.isPublished,
    shownWordId: question.shownWordId,
  };
}

/** The marks of a question as it is stored. A Portuguese answer has none. */
function marksOf(
  checker: Checker,
  fields: QuestionFields,
  at: Place,
): { readonly prompt: readonly Mark[]; readonly answer: readonly Mark[] } {
  return {
    prompt: checker.check(fields.prompt, at),
    answer:
      fields.answerLanguage === "en"
        ? checker.check(fields.expectedAnswer, at)
        : [],
  };
}

function PointSection({
  at,
  pointId,
  groups,
  shownWords,
  wordOf,
  questions,
  checker,
  mean,
  view,
  reportDraft,
}: {
  readonly at: Place;
  readonly pointId: string;
  readonly groups: readonly WordGroup[];
  /** The words a question of this point may show: see shownWordOptions. */
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly questions: readonly Question[];
  readonly checker: Checker;
  /** The mean of the lesson, which the chips of the point are read against. */
  readonly mean: number;
  readonly view: UsageView;
  readonly reportDraft: ReportDraft;
}) {
  const [busy, setBusy] = useState(false);
  // Every edit form open in this point. More than one may be: see `opened`.
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [doomed, setDoomed] = useState<{
    readonly id: string;
    readonly number: number;
    readonly prompt: string;
  } | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const published = questions.filter((q) => q.isPublished).length;

  /** One action at a time in a point. True when it went through. */
  async function run(
    action: () => Promise<QuestionResult>,
    done: NoticeText | null,
    failed: (message: string) => NoticeText,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    const result = await settle(action);
    setBusy(false);
    if (result.ok) {
      if (done !== null) tell(done);
      return true;
    }
    tell(failed(result.error));
    return false;
  }

  /**
   * The list moving is the news of a move that worked, so only its failure
   * is said. The whole order is sent, as the screen holds it.
   */
  function move(index: number, delta: -1 | 1) {
    const ids = questions.map((question) => question.id);
    void run(
      () => reorderQuestions(pointId, moveMember(ids, index, delta)),
      null,
      (message) => pointFailed(at.point, message),
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      className="border-rule flex flex-col gap-4 border-t pt-6"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
            {pointLabel(at.point)}
          </h2>
          <span className="text-faint text-xs">
            {questions.length === 1
              ? "1 pergunta"
              : `${questions.length} perguntas`}
            {questions.length > 0 &&
              ` · ${published === 1 ? "1 publicada" : `${published} publicadas`}`}
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="text-faint text-sm">
            Nenhuma palavra apresentada neste ponto.
          </p>
        ) : (
          <ul aria-label="Palavras do ponto" className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <li
                key={group.key}
                title={group.isSet ? "Conjunto de contraste" : undefined}
                className={
                  group.isSet
                    ? "border-foreground/40 flex flex-wrap gap-1.5 rounded-sm border p-1"
                    : "flex"
                }
              >
                {group.ids.map((id, index) => (
                  <UsageChip
                    key={id}
                    word={{ id, term: group.terms[index] }}
                    mean={mean}
                    view={view}
                  />
                ))}
              </li>
            ))}
          </ul>
        )}
      </header>

      {questions.length === 0 ? (
        <p className="text-faint text-sm">
          Nenhuma pergunta neste ponto ainda.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {questions.map((question, index) => {
            const number = index + 1;
            const saved = fieldsOf(question);
            const close = () => setEditing((open) => closed(open, question.id));
            if (editing.has(question.id)) {
              return (
                <li
                  key={question.id}
                  className="border-rule bg-surface rounded-sm border p-4"
                >
                  <QuestionForm
                    at={at}
                    checker={checker}
                    shownWords={shownWords}
                    wordOf={wordOf}
                    saved={saved}
                    draftKey={question.id}
                    reportDraft={reportDraft}
                    legend={`Editar a pergunta ${number}`}
                    submitLabel="Salvar"
                    busy={busy}
                    onCancel={close}
                    onSubmit={async (draft, loaded) => {
                      const ok = await run(
                        () => saveQuestion(question.id, loaded, draft),
                        questionSaved(at.point, number),
                        (message) => questionFailed(at.point, number, message),
                      );
                      if (ok) close();
                      return ok;
                    }}
                  />
                </li>
              );
            }
            const marks = marksOf(checker, saved, at);
            const unpresented = summary([...marks.prompt, ...marks.answer], at);
            const shown =
              question.shownWordId === null
                ? null
                : (wordOf.get(question.shownWordId) ?? null);
            const picture = shown === null ? null : approvedPicture(shown);
            return (
              <li
                key={question.id}
                className="border-rule flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border px-3 py-2"
              >
                <span className="text-faint w-5 pt-0.5 font-mono text-xs">
                  {number}
                </span>
                {shown !== null && picture !== null && (
                  <Image
                    src={picture}
                    alt={`Palavra mostrada: ${shown.term}`}
                    title={`Palavra mostrada: ${shown.term}`}
                    width={40}
                    height={40}
                    className="border-rule size-10 shrink-0 rounded-sm border object-cover"
                  />
                )}
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <p className="font-semibold">
                    <MarkedText
                      text={question.prompt}
                      marks={marks.prompt}
                      at={at}
                    />
                  </p>
                  <p className="text-muted">
                    <MarkedText
                      text={question.expectedAnswer}
                      marks={marks.answer}
                      at={at}
                    />
                  </p>
                  {unpresented !== "" && (
                    <p className="text-warning text-xs">
                      Ainda não apresentadas no ponto {at.point}: {unpresented}
                    </p>
                  )}
                  {/*
                    A word chosen for its picture that has none now. Said
                    here because nothing else would: in the lesson the card
                    quietly falls back to the neutral one.
                  */}
                  {question.shownWordId !== null && picture === null && (
                    <p className="text-warning text-xs">
                      Palavra mostrada: {shown?.term ?? "não encontrada"} · sem
                      imagem aprovada. Na aula o cartão aparece sem imagem.
                    </p>
                  )}
                  <p className="text-faint flex flex-wrap gap-x-3 text-xs">
                    <span>
                      {question.isPublished ? "Publicada" : "Não publicada"}
                    </span>
                    {question.answerLanguage === "pt" && (
                      <span>Resposta em português</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Subir a pergunta ${number}`}
                    title="Subir"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Descer a pergunta ${number}`}
                    title="Descer"
                    disabled={busy || index === questions.length - 1}
                    onClick={() => move(index, 1)}
                    className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setEditing((open) => opened(open, question.id))
                    }
                    className="border-rule hover:bg-surface rounded-sm border px-2 py-1 text-xs transition-colors disabled:opacity-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDoomed({
                        id: question.id,
                        number,
                        prompt: question.prompt,
                      });
                      confirm.current?.showModal();
                    }}
                    className="text-muted hover:text-foreground px-2 py-1 text-xs underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Apagar
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding ? (
        <div className="border-rule bg-surface rounded-sm border p-4">
          <QuestionForm
            at={at}
            checker={checker}
            shownWords={shownWords}
            wordOf={wordOf}
            saved={null}
            draftKey={`novo:${pointId}`}
            reportDraft={reportDraft}
            legend={`Nova pergunta do ponto ${at.point}`}
            submitLabel="Acrescentar"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={(draft) =>
              run(
                () => addQuestion(pointId, draft),
                questionAdded(at.point, questions.length + 1),
                (message) => pointFailed(at.point, message),
              )
            }
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border-rule hover:bg-surface self-start rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors"
        >
          Acrescentar pergunta
        </button>
      )}

      {/*
        The native dialog, as on the images screen: Esc and the focus move
        come with showModal. Deleting cannot be undone, so it is never one
        click, and the dialog names the question it is about to delete.
      */}
      <dialog
        ref={confirm}
        aria-labelledby={`${titleId}-apagar`}
        onClose={() => setDoomed(null)}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        {doomed !== null && (
          <div className="flex flex-col gap-4">
            <h2
              id={`${titleId}-apagar`}
              className="text-base font-extrabold tracking-tight"
            >
              Apagar a pergunta {doomed.number} do ponto {at.point}?
            </h2>
            <p className="text-muted text-sm">
              “{doomed.prompt}” e a resposta esperada dela são apagadas. Não dá
              para desfazer.
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
                  const { id, number } = doomed;
                  confirm.current?.close();
                  void run(
                    () => deleteQuestion(id),
                    questionDeleted(at.point, number),
                    (message) => questionFailed(at.point, number, message),
                  );
                }}
                className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
              >
                Apagar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

/** A sentence with the words the point has not presented underlined. */
function MarkedText({
  text,
  marks,
  at,
}: {
  readonly text: string;
  readonly marks: readonly Mark[];
  readonly at: Place;
}) {
  return (
    <>
      {segments(text, marks).map((part, index) =>
        part.mark === null ? (
          <span key={index}>{part.text}</span>
        ) : (
          <mark
            key={index}
            title={standing(part.mark, at)}
            className="decoration-warning text-foreground bg-transparent underline decoration-2 underline-offset-4"
          >
            {part.text}
          </mark>
        ),
      )}
    </>
  );
}

/**
 * One choice of the word a question shows: a radio, so the arrows walk the
 * group and exactly one is always chosen. The input is kept for the keyboard
 * and the reader and hidden from the eye, and the label draws the choice.
 */
function ShownWordChoice({
  name,
  checked,
  onChoose,
  children,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly onChoose: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <label
      className={
        checked
          ? "border-foreground bg-background has-focus-visible:outline-foreground flex cursor-pointer flex-col items-center gap-1 rounded-sm border-2 p-1 has-focus-visible:outline-2"
          : "border-rule hover:bg-background has-focus-visible:outline-foreground flex cursor-pointer flex-col items-center gap-1 rounded-sm border-2 p-1 has-focus-visible:outline-2"
      }
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChoose}
        className="sr-only"
      />
      {children}
    </label>
  );
}

/**
 * Asks before the tab is closed or reloaded while a form holds something
 * unsaved. A move inside the app cannot be stopped this way, which is why
 * the form also says so in words.
 */
function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/**
 * The form for a new question (`saved` null) or an edit.
 *
 * What is typed stays in the form until it is saved, and through a save that
 * fails: a refusal is said in the snackbar and the draft is left where it
 * is. Closing the form is the only thing here that drops a draft, and its
 * button says so while there is one to drop.
 */
function QuestionForm({
  at,
  checker,
  shownWords,
  wordOf,
  saved,
  draftKey,
  reportDraft,
  legend,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  readonly at: Place;
  readonly checker: Checker;
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly saved: QuestionFields | null;
  /** What the screen files this form's draft under: see reportDraft. */
  readonly draftKey: string;
  readonly reportDraft: ReportDraft;
  readonly legend: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  /** `loaded` is what the form opened on: `saved` then, or EMPTY for a new one. */
  readonly onSubmit: (
    draft: QuestionFields,
    loaded: QuestionFields,
  ) => Promise<boolean>;
  readonly onCancel: () => void;
}) {
  /*
   * What the form opened on, held for as long as it is open. Not `saved` as
   * it is now: another action on this point re-renders the list, and if the
   * question was changed elsewhere meanwhile, `saved` would quietly become
   * the new text. The save is only accepted while the row still holds what
   * this form was opened on, so that is what has to be sent.
   */
  const [loaded] = useState<QuestionFields>(saved ?? EMPTY);
  const [draft, setDraft] = useState<QuestionFields>(loaded);
  const promptInput = useRef<HTMLInputElement>(null);
  const id = useId();

  // A new question is unsaved once either sentence has something in it; the
  // language and the publish box alone are settings for the next one.
  const dirty =
    saved === null
      ? draft.prompt.trim() !== "" || draft.expectedAnswer.trim() !== ""
      : isDirty(draft, loaded);
  useUnsavedWarning(dirty);

  /*
   * The screen is told what the form holds, so the chips of the words the
   * draft uses are lit in the point and in the panel. Against `saved` as it
   * is now and not `loaded`: what a save would add is measured from what the
   * count already has. Two effects, so typing does not take the draft away
   * and put it back: the second runs only when the form closes.
   */
  useEffect(() => {
    reportDraft(draftKey, { draft, saved });
  }, [reportDraft, draftKey, draft, saved]);
  useEffect(() => () => reportDraft(draftKey, null), [reportDraft, draftKey]);

  const why = refusal(draft);
  const marks = marksOf(checker, draft, at);
  const promptMarks = summary(marks.prompt, at);
  const answerMarks = summary(marks.answer, at);
  /*
   * The word the draft shows when the list does not offer it: its picture
   * was taken off since, or it is presented after this point. It keeps a
   * choice of its own, so the form says what is stored and a save of some
   * other field does not carry it along unseen.
   */
  const offList =
    draft.shownWordId !== null &&
    !shownWords.some((option) => option.id === draft.shownWordId)
      ? draft.shownWordId
      : null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || why !== null) return;
        void onSubmit(draft, loaded).then((ok) => {
          if (!ok || saved !== null) return;
          // Added: the form stays open for the next one, in the same
          // language, with the same publish choice and showing the same
          // word, since a picture is often asked about more than once. The fields are
          // read-only while the save runs, so nothing typed since is lost.
          setDraft({ ...draft, prompt: "", expectedAnswer: "" });
          promptInput.current?.focus();
        });
      }}
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        {legend}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-pergunta`} className="text-sm font-semibold">
          Pergunta
        </label>
        <input
          ref={promptInput}
          id={`${id}-pergunta`}
          type="text"
          lang="en"
          autoComplete="off"
          readOnly={busy}
          value={draft.prompt}
          onChange={(event) =>
            setDraft({ ...draft, prompt: event.target.value })
          }
          className="border-rule bg-background rounded-sm border px-3 py-1.5 text-sm"
        />
        {promptMarks !== "" && (
          <p className="text-warning text-xs">
            Ainda não apresentadas no ponto {at.point}: {promptMarks}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-resposta`} className="text-sm font-semibold">
          Resposta esperada
        </label>
        <input
          id={`${id}-resposta`}
          type="text"
          lang={draft.answerLanguage === "pt" ? "pt-BR" : "en"}
          autoComplete="off"
          readOnly={busy}
          value={draft.expectedAnswer}
          onChange={(event) =>
            setDraft({ ...draft, expectedAnswer: event.target.value })
          }
          className="border-rule bg-background rounded-sm border px-3 py-1.5 text-sm"
        />
        {answerMarks !== "" && (
          <p className="text-warning text-xs">
            Ainda não apresentadas no ponto {at.point}: {answerMarks}
          </p>
        )}
        {draft.answerLanguage === "pt" && (
          <p className="text-faint text-xs">
            Resposta em português: as palavras dela não são conferidas.
          </p>
        )}
      </div>

      <fieldset disabled={busy} className="flex flex-col gap-1">
        <legend className="text-sm font-semibold">Palavra mostrada</legend>
        <p className="text-faint text-xs">
          A imagem dela abre o cartão da pergunta na aula. Só aparecem as
          palavras apresentadas até o ponto {at.point} que têm imagem aprovada.
        </p>
        <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pt-1">
          <ShownWordChoice
            name={`${id}-palavra`}
            checked={draft.shownWordId === null}
            onChoose={() => setDraft({ ...draft, shownWordId: null })}
          >
            <span className="flex size-12 items-center justify-center text-xs">
              Nenhuma
            </span>
          </ShownWordChoice>
          {offList !== null && (
            <ShownWordChoice
              name={`${id}-palavra`}
              checked
              onChoose={() => setDraft({ ...draft, shownWordId: offList })}
            >
              <span className="text-warning flex h-12 max-w-40 items-center text-xs">
                {wordOf.get(offList)?.term ?? "Palavra não encontrada"} · fora
                da lista
              </span>
            </ShownWordChoice>
          )}
          {shownWords.map((option) => (
            <ShownWordChoice
              key={option.id}
              name={`${id}-palavra`}
              checked={draft.shownWordId === option.id}
              onChoose={() => setDraft({ ...draft, shownWordId: option.id })}
            >
              <Image
                src={option.imageUrl}
                alt=""
                width={48}
                height={48}
                className="size-12 rounded-sm object-cover"
              />
              <span className="max-w-20 truncate text-xs" title={option.term}>
                {option.term}
              </span>
            </ShownWordChoice>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          Língua da resposta
          <select
            disabled={busy}
            value={draft.answerLanguage}
            onChange={(event) => {
              const value = event.target.value;
              if (isAnswerLanguage(value)) {
                setDraft({ ...draft, answerLanguage: value });
              }
            }}
            className="border-rule bg-background rounded-sm border px-2 py-1 text-sm"
          >
            {ANSWER_LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={busy}
            checked={draft.isPublished}
            onChange={(event) =>
              setDraft({ ...draft, isPublished: event.target.checked })
            }
          />
          Publicada
        </label>
      </div>

      {dirty && (
        <p className="text-warning text-sm font-semibold">
          Não salvo. Trocar de lição ou sair desta tela descarta o que está
          escrito.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || why !== null || (saved !== null && !dirty)}
          className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
        >
          {dirty ? "Descartar o que está escrito" : "Fechar"}
        </button>
        {dirty && why !== null && (
          <span className="text-muted text-xs">{why}.</span>
        )}
      </div>
    </form>
  );
}
