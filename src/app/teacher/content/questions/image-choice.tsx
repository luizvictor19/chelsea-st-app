"use client";

import Image from "next/image";
import { useState } from "react";

import type { Place } from "@/lib/questions/presented";
import {
  NO_IMAGE,
  type ImageChoice,
  type ImageKind,
} from "@/lib/questions/question-image";
import type { ScreenScene } from "@/lib/questions/queries";
import type { PicturedWord, ShownWordOption } from "@/lib/questions/shown-word";

import { sceneHref } from "../images/filters";
import { settle } from "../images/panel-state";
import { createScene } from "../images/scene-actions";

import { pointFailed, sceneCreated, sceneFound, tell } from "./notice-texts";

const KINDS: readonly { readonly kind: ImageKind; readonly label: string }[] = [
  { kind: "none", label: "Sem decidir" },
  { kind: "word", label: "Palavra" },
  { kind: "scene", label: "Cena" },
  { kind: "acted", label: "Encenar" },
];

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
 * The field "Imagem da pergunta": nothing decided, a word, a scene, or acted
 * out (0030). One kind at a time, so the form never holds two.
 *
 * Switching the kind keeps the last word and the last scene chosen, so going
 * to Cena and back to Palavra finds the word where it was.
 *
 * A scene can be created here. Creating links nothing: the question shows it
 * once the form is saved. Until the screen's props bring the new scene, it
 * is shown from what was kept when it was made.
 *
 * A chosen scene without an approved picture gets a next step, with a link
 * to its panel on the images screen. The link opens another tab, so the
 * draft here never leaves the screen.
 */
export function ImageChoiceField({
  id,
  at,
  image,
  onChange,
  busy,
  shownWords,
  wordOf,
  scenes,
  suggestion,
}: {
  /** The form's own id, which every name here starts with. */
  readonly id: string;
  readonly at: Place;
  readonly image: ImageChoice;
  readonly onChange: (image: ImageChoice) => void;
  readonly busy: boolean;
  /** The words a question of this point may show: see shownWordOptions. */
  readonly shownWords: readonly ShownWordOption[];
  readonly wordOf: ReadonlyMap<string, PicturedWord>;
  /** The common scenes in use, by description. */
  readonly scenes: readonly ScreenScene[];
  /** What Criar cena starts with: see sceneSuggestion. */
  readonly suggestion: string;
}) {
  const [lastWord, setLastWord] = useState<string | null>(
    image.kind === "word" ? image.id : null,
  );
  const [lastScene, setLastScene] = useState<string | null>(
    image.kind === "scene" ? image.id : null,
  );
  // Scenes made here that the props may not carry yet.
  const [made, setMade] = useState<readonly ScreenScene[]>([]);
  // What the teacher typed in Criar cena; null follows the suggestion.
  const [typed, setTyped] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const offered = [
    ...scenes,
    ...made.filter((scene) => !scenes.some((known) => known.id === scene.id)),
  ].sort((a, b) => a.description.localeCompare(b.description, "en"));

  function chooseKind(kind: ImageKind) {
    if (kind === "none") onChange(NO_IMAGE);
    else if (kind === "acted") onChange({ kind: "acted" });
    else if (kind === "word") onChange({ kind: "word", id: lastWord });
    else onChange({ kind: "scene", id: lastScene });
  }

  function chooseWord(wordId: string) {
    setLastWord(wordId);
    onChange({ kind: "word", id: wordId });
  }

  function chooseScene(sceneId: string) {
    setLastScene(sceneId);
    onChange({ kind: "scene", id: sceneId });
  }

  const description = typed ?? suggestion;

  async function create() {
    const text = description.trim();
    if (creating || text === "") return;
    setCreating(true);
    const result = await settle(() => createScene(text));
    setCreating(false);
    if (result.ok) {
      setMade((known) => [
        ...known,
        { id: result.id, description: text, imageUrl: null },
      ]);
      chooseScene(result.id);
      // Empty, not back to the suggestion: the suggestion is the scene just
      // made, and leaving it there invites a second tap on Criar cena.
      setTyped("");
      tell(sceneCreated(at.point));
      return;
    }
    if ("existingId" in result && result.existingId !== undefined) {
      const existingId = result.existingId;
      // Already in the props, unless they are a refresh behind.
      if (!scenes.some((scene) => scene.id === existingId)) {
        setMade((known) => [
          ...known,
          { id: existingId, description: text, imageUrl: null },
        ]);
      }
      chooseScene(existingId);
      setTyped("");
      tell(sceneFound(at.point));
      return;
    }
    tell(pointFailed(at.point, result.error));
  }

  /*
   * The word or the scene the draft holds when the list does not offer it:
   * a word whose picture was taken off since, or presented after this point;
   * a scene the read left out. It keeps a choice of its own, so the form
   * says what is stored and a save of some other field does not carry it
   * along unseen.
   */
  const wordOffList =
    image.kind === "word" &&
    image.id !== null &&
    !shownWords.some((option) => option.id === image.id)
      ? image.id
      : null;
  const chosenScene =
    image.kind === "scene"
      ? offered.find((scene) => scene.id === image.id)
      : undefined;
  const sceneOffList =
    image.kind === "scene" &&
    image.id !== null &&
    !offered.some((scene) => scene.id === image.id)
      ? image.id
      : null;

  return (
    <fieldset disabled={busy} className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Imagem da pergunta</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {KINDS.map((option) => (
          <label
            key={option.kind}
            className="flex items-center gap-1.5 text-sm"
          >
            <input
              type="radio"
              name={`${id}-tipo`}
              checked={image.kind === option.kind}
              onChange={() => chooseKind(option.kind)}
            />
            {option.label}
          </label>
        ))}
      </div>

      {image.kind === "none" && (
        <p className="text-faint text-xs">
          Nada decidido ainda. Na aula o cartão fica neutro.
        </p>
      )}

      {image.kind === "acted" && (
        <p className="text-faint text-xs">
          Você encena na aula; o cartão fica neutro.
        </p>
      )}

      {image.kind === "word" && (
        <div className="flex flex-col gap-1">
          <p className="text-faint text-xs">
            A imagem dela abre o cartão da pergunta na aula. Só aparecem as
            palavras apresentadas até o ponto {at.point} que têm imagem
            aprovada.
          </p>
          {shownWords.length === 0 && wordOffList === null ? (
            <p className="text-faint text-sm">
              Nenhuma palavra com imagem aprovada até o ponto {at.point}.
            </p>
          ) : (
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pt-1">
              {wordOffList !== null && (
                <ShownWordChoice
                  name={`${id}-palavra`}
                  checked
                  onChoose={() => chooseWord(wordOffList)}
                >
                  <span className="text-warning flex h-12 max-w-40 items-center text-xs">
                    {wordOf.get(wordOffList)?.term ?? "Palavra não encontrada"}{" "}
                    · fora da lista
                  </span>
                </ShownWordChoice>
              )}
              {shownWords.map((option) => (
                <ShownWordChoice
                  key={option.id}
                  name={`${id}-palavra`}
                  checked={image.id === option.id}
                  onChoose={() => chooseWord(option.id)}
                >
                  <Image
                    src={option.imageUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 rounded-sm object-cover"
                  />
                  <span
                    className="max-w-20 truncate text-xs"
                    title={option.term}
                  >
                    {option.term}
                  </span>
                </ShownWordChoice>
              ))}
            </div>
          )}
        </div>
      )}

      {image.kind === "scene" && (
        <div className="flex flex-col gap-2">
          <p className="text-faint text-xs">
            A imagem aprovada da cena abre o cartão da pergunta na aula. A
            imagem é feita na tela de imagens, na seção Cenas.
          </p>
          {offered.length === 0 && sceneOffList === null ? (
            <p className="text-faint text-sm">Nenhuma cena ainda.</p>
          ) : (
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pt-1">
              {sceneOffList !== null && (
                <ShownWordChoice
                  name={`${id}-cena`}
                  checked
                  onChoose={() => chooseScene(sceneOffList)}
                >
                  <span className="text-warning flex h-12 max-w-40 items-center text-xs">
                    Cena fora da lista
                  </span>
                </ShownWordChoice>
              )}
              {offered.map((scene) => (
                <div
                  key={scene.id}
                  className="flex flex-col items-center gap-1"
                >
                  <ShownWordChoice
                    name={`${id}-cena`}
                    checked={image.id === scene.id}
                    onChoose={() => chooseScene(scene.id)}
                  >
                    {scene.imageUrl === null ? (
                      <span className="text-warning border-rule flex size-12 items-center justify-center rounded-sm border border-dashed text-center text-[10px] leading-tight">
                        sem imagem
                      </span>
                    ) : (
                      <Image
                        src={scene.imageUrl}
                        alt=""
                        width={48}
                        height={48}
                        className="size-12 rounded-sm object-cover"
                      />
                    )}
                    <span
                      className="max-w-28 truncate text-xs"
                      title={scene.description}
                    >
                      {scene.description}
                    </span>
                  </ShownWordChoice>
                  {/* Outside the label, so a tap here does not choose the scene. */}
                  {scene.imageUrl === null && (
                    <a
                      href={sceneHref(scene.id)}
                      target="_blank"
                      rel="noopener"
                      aria-label={`Fazer a imagem da cena ${scene.description} em Imagens, abre em outra aba`}
                      className="text-faint hover:text-foreground text-xs underline underline-offset-2"
                    >
                      fazer imagem ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {chosenScene !== undefined && chosenScene.imageUrl === null && (
            <div className="border-warning/60 flex flex-col gap-1 rounded-sm border border-dashed p-3 text-sm">
              <p>
                <span className="font-semibold">Próximo passo.</span> Esta cena
                ainda não tem imagem. Faça e aprove a imagem em Imagens › Cenas:
                até lá, a pergunta só pode ser salva com Publicada desmarcada.
                Na aula, a pergunta mostra a imagem aprovada.
              </p>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <a
                  href={sceneHref(chosenScene.id)}
                  target="_blank"
                  rel="noopener"
                  className="font-semibold underline underline-offset-2"
                >
                  Fazer a imagem em Imagens ↗
                </a>
                <span className="text-faint text-xs">abre em outra aba</span>
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${id}-nova-cena`}
              className="text-xs font-semibold"
            >
              Criar cena
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={`${id}-nova-cena`}
                type="text"
                lang="en"
                autoComplete="off"
                readOnly={creating}
                value={description}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  // Enter here creates the scene, not the question.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void create();
                  }
                }}
                className="border-rule bg-background min-w-0 flex-1 basis-48 rounded-sm border px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={creating || description.trim() === ""}
                onClick={() => void create()}
                className="border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
              >
                {creating ? "Criando…" : "Criar cena"}
              </button>
            </div>
            <p className="text-faint text-xs">
              Criar não liga a cena à pergunta: ela passa a ser mostrada quando
              você salvar a pergunta.
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * What Criar cena starts with: the expected answer when it is in English,
 * since it usually says what the picture shows ("the pen's on the book"),
 * and the question otherwise.
 */
export function sceneSuggestion(fields: {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: string;
}): string {
  const answer = fields.expectedAnswer.trim();
  return fields.answerLanguage === "en" && answer !== ""
    ? answer
    : fields.prompt.trim();
}
