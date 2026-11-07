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
  ScreenScene,
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
import { pointAnchor, type QuestionPlace } from "../images/filters";
import { settle } from "../images/panel-state";

import {
  addQuestion,
  deleteQuestion,
  publishReviewed,
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
  publishRefusal,
  refusal,
  type PictureOf,
  type QuestionFields,
} from "./draft";
import { ImageChoiceField, sceneSuggestion } from "./image-choice";
import { LeaveGuardProvider, useUnsavedWarning } from "./leave-guard";
import { segments, standing, summary } from "./marks";
import { leftOutList, sortDrafts } from "./publish-reviewed";
import { SuggestControls, useSuggestions } from "./suggest-controls";
import {
  draftToFields,
  provenance,
  type SuggestionCard,
} from "./suggestion-cards";
import {
  draftsPublished,
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
  scenes,
}: {
  readonly book: number;
  readonly lesson: number;
  readonly points: readonly LessonPoint[];
  readonly questions: readonly Question[];
  readonly words: readonly ScreenWord[];
  readonly sets: readonly SetRow[];
  readonly bookQuestions: readonly UsageQuestion[];
  readonly bookPoints: readonly BookPoint[];
  readonly scenes: readonly ScreenScene[];
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
  const sceneOf = useMemo(
    () => new Map(scenes.map((scene) => [scene.id, scene])),
    [scenes],
  );
  // The picture a card would open on, as the lesson decides it: a word's
  // approved picture by its kind (approvedPicture), a scene's approved one.
  const pictureOf = useCallback<PictureOf>(
    (kind, id) => {
      if (kind === "scene") return sceneOf.get(id)?.imageUrl ?? null;
      const word = wordOf.get(id);
      return word === undefined ? null : approvedPicture(word);
    },
    [wordOf, sceneOf],
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
    <LeaveGuardProvider>
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
              lesson={lesson}
              pointId={point.id}
              groups={groups.get(placeKey(at)) ?? []}
              shownWords={shownWordOptions(words, sets, at)}
              wordOf={wordOf}
              scenes={scenes}
              sceneOf={sceneOf}
              pictureOf={pictureOf}
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
    </LeaveGuardProvider>
  );
}

function fieldsOf(question: Question): QuestionFields {
  return {
    prompt: question.prompt,
    expectedAnswer: question.expectedAnswer,
    answerLanguage: question.answerLanguage,
    isPublished: question.isPublished,
    image: question.image,
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
  lesson,
  pointId,
  groups,
  shownWords,
  wordOf,
  scenes,
  sceneOf,
  pictureOf,
  questions,
  checker,
  mean,
  view,
  reportDraft,
}: {
  readonly at: Place;
  readonly lesson: number;
  readonly pointId: string;
  readonly groups: readonly WordGroup[];
  /** The words a question of this point may show: see shownWordOptions. */
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly scenes: readonly ScreenScene[];
  readonly sceneOf: ReadonlyMap<string, ScreenScene>;
  readonly pictureOf: PictureOf;
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
  const suggestions = useSuggestions(pointId, at.point);

  const published = questions.filter((q) => q.isPublished).length;
  // The point's drafts, in its order, sorted by the pictures the screen
  // shows; the action sorts them again by the database's (#232).
  const drafts = questions.map((question, index) => ({
    id: question.id,
    number: index + 1,
    fields: fieldsOf(question),
  }));
  const reviewed = sortDrafts(drafts, pictureOf);
  const publishConfirm = useRef<HTMLDialogElement>(null);

  /** "Publicar revisadas": every draft of the point goes, the action decides which publish. */
  async function publishDrafts() {
    if (busy) return;
    setBusy(true);
    const result = await settle(() =>
      publishReviewed(
        pointId,
        drafts.filter((draft) => !draft.fields.isPublished),
      ),
    );
    setBusy(false);
    tell(
      result.ok
        ? draftsPublished(at.point, result)
        : pointFailed(at.point, result.error),
    );
  }

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
      id={pointAnchor(at.point)}
      aria-labelledby={titleId}
      className="border-rule flex scroll-mt-20 flex-col gap-4 border-t pt-6"
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
                    lesson={lesson}
                    checker={checker}
                    shownWords={shownWords}
                    wordOf={wordOf}
                    scenes={scenes}
                    pictureOf={pictureOf}
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
            const { image } = question;
            const shown =
              image.kind === "word" && image.id !== null
                ? (wordOf.get(image.id) ?? null)
                : null;
            const scene =
              image.kind === "scene" && image.id !== null
                ? (sceneOf.get(image.id) ?? null)
                : null;
            const picture =
              image.kind === "word" || image.kind === "scene"
                ? image.id === null
                  ? null
                  : pictureOf(image.kind, image.id)
                : null;
            const pictureLabel =
              image.kind === "word"
                ? `Palavra mostrada: ${shown?.term ?? "não encontrada"}`
                : image.kind === "scene"
                  ? `Cena: ${scene?.description ?? "não encontrada"}`
                  : null;
            return (
              <li
                key={question.id}
                className="border-rule flex flex-wrap items-start gap-x-3 gap-y-2 rounded-sm border px-3 py-2"
              >
                <span className="text-faint w-5 pt-0.5 font-mono text-xs">
                  {number}
                </span>
                {pictureLabel !== null && picture !== null && (
                  <Image
                    src={picture}
                    alt={pictureLabel}
                    title={pictureLabel}
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
                    A word or a scene chosen for its picture that has none
                    now. Said here because nothing else would: in the lesson
                    the card quietly falls back to the neutral one.
                  */}
                  {pictureLabel !== null && picture === null && (
                    <p className="text-warning text-xs">
                      {pictureLabel} · sem imagem aprovada. Na aula o cartão
                      aparece sem imagem.
                    </p>
                  )}
                  {/*
                    Published before its picture left: a save of it is refused
                    until it shows one (publishRefusal), so the ways out are
                    said before the form is opened.
                  */}
                  {publishRefusal(saved, pictureOf) !== null && (
                    <p className="text-warning text-xs">
                      Publicada sem imagem. Para salvar uma edição, escolha a
                      imagem, marque Encenar ou desmarque Publicada.
                    </p>
                  )}
                  <p className="text-faint flex flex-wrap gap-x-3 text-xs">
                    <span>
                      {question.isPublished ? "Publicada" : "Não publicada"}
                    </span>
                    {image.kind === "acted" && <span>Encenar na aula</span>}
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

      {reviewed.ready.length + reviewed.left.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={busy || reviewed.ready.length === 0}
            onClick={() => publishConfirm.current?.showModal()}
            className="border-rule hover:bg-surface rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40"
          >
            Publicar revisadas
          </button>
          <span className="text-faint text-xs">
            {reviewed.ready.length === 0
              ? "Nenhum rascunho pode ser publicado: falta imagem aprovada ou Encenar"
              : reviewed.ready.length === 1
                ? "1 rascunho pode ser publicado"
                : `${reviewed.ready.length} rascunhos podem ser publicados`}
            {reviewed.left.length > 0 &&
              ` · ficam como rascunho: ${leftOutList(reviewed.left)}`}
          </span>
        </div>
      )}

      {/*
        Publishing puts the drafts in front of the students, so it asks
        first, naming the questions by number. It is undone by editing one
        and unchecking Publicada; Cancelar takes the focus, so a stray Enter
        publishes nothing.
      */}
      <dialog
        ref={publishConfirm}
        aria-labelledby={`${titleId}-publicar`}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2
            id={`${titleId}-publicar`}
            className="text-base font-extrabold tracking-tight"
          >
            Publicar{" "}
            {reviewed.ready.length === 1
              ? "1 pergunta"
              : `${reviewed.ready.length} perguntas`}{" "}
            do ponto {at.point}?
          </h2>
          <p className="text-muted text-sm">
            {reviewed.ready.length === 1 ? "A pergunta" : "As perguntas"}{" "}
            {reviewed.ready.map((draft) => draft.number).join(", ")}{" "}
            {reviewed.ready.length === 1 ? "passa" : "passam"} a aparecer para
            as alunas.
            {reviewed.left.length > 0 &&
              ` Ficam como rascunho: ${leftOutList(reviewed.left)}.`}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <form method="dialog">
              <button
                type="submit"
                autoFocus
                className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors"
              >
                Cancelar
              </button>
            </form>
            <button
              type="button"
              onClick={() => {
                publishConfirm.current?.close();
                void publishDrafts();
              }}
              className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold"
            >
              Publicar
            </button>
          </div>
        </div>
      </dialog>

      {adding ? (
        <div className="border-rule bg-surface rounded-sm border p-4">
          <QuestionForm
            at={at}
            lesson={lesson}
            checker={checker}
            shownWords={shownWords}
            wordOf={wordOf}
            scenes={scenes}
            pictureOf={pictureOf}
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

      <SuggestControls
        canAsk={groups.length > 0}
        status={suggestions.status}
        onAsk={(count) => void suggestions.ask(count)}
      />

      {suggestions.cards.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-faint text-xs">
            Sugestões do modelo, só nesta tela: nada foi gravado. Usar abre a
            sugestão no formulário para você revisar e salvar.
          </p>
          <ul aria-label="Perguntas sugeridas" className="flex flex-col gap-2">
            {suggestions.cards.map((card) => (
              <li
                key={card.key}
                className="border-rule bg-surface rounded-sm border border-dashed p-3"
              >
                {card.inUse ? (
                  <SuggestionForm
                    card={card}
                    at={at}
                    lesson={lesson}
                    checker={checker}
                    shownWords={shownWords}
                    wordOf={wordOf}
                    scenes={scenes}
                    pictureOf={pictureOf}
                    reportDraft={reportDraft}
                    busy={busy}
                    onCancel={() => suggestions.putBack(card.key)}
                    onSubmit={async (draft) => {
                      const ok = await run(
                        () => addQuestion(pointId, draft, provenance(card)),
                        questionAdded(at.point, questions.length + 1),
                        (message) => pointFailed(at.point, message),
                      );
                      if (ok) suggestions.remove(card.key);
                      return ok;
                    }}
                  />
                ) : (
                  <SuggestionCardView
                    card={card}
                    at={at}
                    checker={checker}
                    wordOf={wordOf}
                    sceneOf={sceneOf}
                    pictureOf={pictureOf}
                    busy={busy}
                    onUse={() => suggestions.use(card.key)}
                    onDiscard={() => suggestions.remove(card.key)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
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

/** What a card says of the picture the model proposed. */
function proposedPicture(
  card: SuggestionCard,
  wordOf: ReadonlyMap<string, PicturedWord>,
  sceneOf: ReadonlyMap<string, ScreenScene>,
  pictureOf: PictureOf,
): { readonly label: string; readonly picture: string | null } {
  const { image } = card.question;
  switch (image.kind) {
    case "word":
      return {
        label: `Palavra mostrada: ${wordOf.get(image.id)?.term ?? "não encontrada"}`,
        picture: pictureOf("word", image.id),
      };
    case "scene":
      return {
        label: `Cena: ${sceneOf.get(image.id)?.description ?? "não encontrada"}`,
        picture: pictureOf("scene", image.id),
      };
    case "new_scene":
      return {
        label: `Cena nova, a criar: ${image.description}`,
        picture: null,
      };
    case "acted":
      return { label: "Encenar na aula", picture: null };
    case "none":
      return { label: `Sem imagem: ${image.reason}`, picture: null };
  }
}

/**
 * One draft of Sugerir perguntas, as the model wrote it, with the words the
 * point has not presented marked as in a saved question. Usar opens it in a
 * form; Descartar takes it off the screen, and nothing was ever written.
 */
function SuggestionCardView({
  card,
  at,
  checker,
  wordOf,
  sceneOf,
  pictureOf,
  busy,
  onUse,
  onDiscard,
}: {
  readonly card: SuggestionCard;
  readonly at: Place;
  readonly checker: Checker;
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly sceneOf: ReadonlyMap<string, ScreenScene>;
  readonly pictureOf: PictureOf;
  readonly busy: boolean;
  readonly onUse: () => void;
  readonly onDiscard: () => void;
}) {
  const { question } = card;
  const marks = marksOf(checker, draftToFields(question).fields, at);
  const unpresented = summary([...marks.prompt, ...marks.answer], at);
  const { label, picture } = proposedPicture(card, wordOf, sceneOf, pictureOf);
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      {picture !== null && (
        <Image
          src={picture}
          alt={label}
          title={label}
          width={40}
          height={40}
          className="border-rule size-10 shrink-0 rounded-sm border object-cover"
        />
      )}
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <p className="font-semibold" lang="en">
          <MarkedText text={question.prompt} marks={marks.prompt} at={at} />
        </p>
        <p
          className="text-muted"
          lang={question.answerLanguage === "pt" ? "pt-BR" : "en"}
        >
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
        <p
          className={
            question.image.kind === "none"
              ? "text-warning text-xs"
              : "text-faint text-xs"
          }
        >
          {label}
        </p>
        <p className="text-faint flex flex-wrap gap-x-3 text-xs">
          <span>Sugestão, não gravada</span>
          {question.answerLanguage === "pt" && (
            <span>Resposta em português</span>
          )}
          {question.practises.trim() !== "" && (
            <span lang="en">Pratica: {question.practises}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onUse}
          className="border-rule hover:bg-background rounded-sm border px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          Usar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="text-muted hover:text-foreground px-2 py-1 text-xs underline-offset-2 hover:underline disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

/**
 * A card in use: the new question form, filled with the draft. Saving adds
 * the question with where it came from (0045) and takes the card away;
 * closing the form puts the card back as the model wrote it.
 */
function SuggestionForm({
  card,
  onSubmit,
  ...form
}: {
  readonly card: SuggestionCard;
  readonly at: Place;
  readonly lesson: number;
  readonly checker: Checker;
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly scenes: readonly ScreenScene[];
  readonly pictureOf: PictureOf;
  readonly reportDraft: ReportDraft;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (draft: QuestionFields) => Promise<boolean>;
}) {
  const { fields, sceneText } = draftToFields(card.question);
  return (
    <QuestionForm
      {...form}
      saved={null}
      initial={fields}
      sceneText={sceneText}
      once
      draftKey={card.key}
      legend={`Nova pergunta do ponto ${form.at.point}, a partir da sugestão`}
      submitLabel="Acrescentar"
      onSubmit={(draft) => onSubmit(draft)}
    />
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
 * The form for a new question (`saved` null) or an edit.
 *
 * What is typed stays in the form until it is saved, and through a save that
 * fails: a refusal is said in the snackbar and the draft is left where it
 * is. Closing the form is the only thing here that drops a draft, and its
 * button says so while there is one to drop.
 */
function QuestionForm({
  at,
  lesson,
  checker,
  shownWords,
  wordOf,
  scenes,
  pictureOf,
  saved,
  initial,
  sceneText,
  once = false,
  draftKey,
  reportDraft,
  legend,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  readonly at: Place;
  readonly lesson: number;
  readonly checker: Checker;
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  readonly scenes: readonly ScreenScene[];
  readonly pictureOf: PictureOf;
  readonly saved: QuestionFields | null;
  /** What a new question opens filled with: a card of Sugerir perguntas. */
  readonly initial?: QuestionFields;
  /** What Criar cena starts with instead of sceneSuggestion: a new scene's description. */
  readonly sceneText?: string | null;
  /**
   * A new question that closes once added, instead of staying open for the
   * next: a card's form, whose provenance must not ride on the next question.
   */
  readonly once?: boolean;
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
  const [draft, setDraft] = useState<QuestionFields>(
    saved === null && initial !== undefined ? initial : loaded,
  );
  const promptInput = useRef<HTMLInputElement>(null);
  const id = useId();

  // A new question is unsaved once either sentence has something in it; the
  // language and the publish box alone are settings for the next one.
  const dirty =
    saved === null
      ? draft.prompt.trim() !== "" || draft.expectedAnswer.trim() !== ""
      : isDirty(draft, loaded);
  // Marks the form for the screen's scene links too (leave-guard.tsx): a
  // move to Imagens asks first while any form here holds something.
  useUnsavedWarning(draftKey, dirty);
  const back: QuestionPlace = { book: at.book, lesson, point: at.point };

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

  // Two reasons, said differently. A missing sentence is said once the form
  // holds something, as before. Publishing with no picture is said from the
  // moment the form opens, so a question published without one shows at
  // once why its save is off (publishRefusal).
  const textWhy = refusal(draft);
  const publishWhy = publishRefusal(draft, pictureOf);
  const why = textWhy ?? publishWhy;
  const marks = marksOf(checker, draft, at);
  const promptMarks = summary(marks.prompt, at);
  const answerMarks = summary(marks.answer, at);

  function send() {
    void onSubmit(draft, loaded).then((ok) => {
      // A card's form is gone once added: the point takes the card away.
      if (!ok || saved !== null || once) return;
      // Added: the form stays open for the next one, in the same language,
      // with the same publish choice and the same image, since a picture is
      // often asked about more than once. The fields are read-only while the
      // save runs, so nothing typed since is lost.
      setDraft({ ...draft, prompt: "", expectedAnswer: "" });
      promptInput.current?.focus();
    });
  }

  return (
    <>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || why !== null) return;
          send();
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

        <ImageChoiceField
          id={id}
          at={at}
          back={back}
          image={draft.image}
          onChange={(image) => setDraft({ ...draft, image })}
          busy={busy}
          shownWords={shownWords}
          wordOf={wordOf}
          scenes={scenes}
          suggestion={sceneText ?? sceneSuggestion(draft)}
        />

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
            aria-describedby={
              [
                dirty && textWhy !== null ? `${id}-falta` : null,
                publishWhy !== null ? `${id}-publicar` : null,
              ]
                .filter((part) => part !== null)
                .join(" ") || undefined
            }
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
          {dirty && textWhy !== null && (
            <span id={`${id}-falta`} className="text-muted text-xs">
              {textWhy}.
            </span>
          )}
          {publishWhy !== null && (
            <span id={`${id}-publicar`} className="text-warning text-xs">
              {publishWhy}.
            </span>
          )}
        </div>
      </form>
    </>
  );
}
