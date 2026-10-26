"use client";

import { useEffect, useRef, useState } from "react";

import type { ImageAttempt, SceneImage } from "@/lib/content/queries";
import {
  MAX_REFERENCE_BYTES,
  REFERENCE_TOO_BIG,
  runningAttempt,
} from "@/lib/images/generation";
import {
  COMPOSE_MODELS,
  DEFAULT_SCENE_MODEL,
  IMAGE_MODELS,
  TEXT_MODELS,
  composesPictures,
  defaultComposeModel,
  defaultReferenceModel,
  isImageModelId,
  modelCredits,
  modelLabel,
} from "@/lib/images/provider";
import {
  UPLOAD_ACCEPT,
  UPLOAD_LIMIT_LABEL,
  refuseFile,
} from "@/lib/images/upload";

import type { ActionResult } from "./attempt-store";
import { AttemptList } from "./attempt-list";
import { trackGeneration, useRunningGeneration } from "./generation-tracking";
import {
  IMAGE_STYLE_LABELS,
  imageApproved,
  imageDiscarded,
  montageSent,
  picturesChosen,
  picturesRemoved,
  referenceAttached,
  referenceRemoved,
  styleChanged,
  tell,
  uploadSent,
  wordFailed,
  type NoticeText,
} from "./notice-texts";
import { JoinApproved, type ApprovedPicture } from "./join-approved";
import { attemptsToShow, settle, type LastAnswer } from "./panel-state";
import {
  approveSceneAttempt,
  clearScenePictures,
  clearSceneReference,
  rejectSceneAttempt,
  setScenePictures,
  setSceneReference,
  setSceneStyle,
  startSceneGeneration,
  uploadSceneImage,
} from "./scene-actions";
import { groupLabel } from "./scenes";
import { NotAPicture, shrinkReference } from "./shrink-reference";

/** Which control is waiting on the server, so only that one shows it. */
type Busy = { readonly key: string } | null;

/** The models that can be handed a picture to work from. */
const ACCEPT_REFERENCE = IMAGE_MODELS.filter(
  (option) => option.reference !== "none",
);

/**
 * A scene's picture (#64): the word panel's generation and attempts, without
 * what only a word has (kind, class, suggestions, contrast sets).
 *
 * The rules each control follows are the word panel's, and the reasons are
 * written there once: nothing moves before the server answers, the list an
 * action answers with is shown until the server sends its own, a reference
 * moves the model to one that takes it, and Gerar waits on the tracker and on
 * the rows. Notices are named by the scene's description.
 */
export function ScenePanel({
  scene,
  attempts,
  point,
  approved,
}: {
  readonly scene: SceneImage;
  readonly attempts: readonly ImageAttempt[];
  /** The group the scene is filed under, for the header. */
  readonly point: number | null;
  /** Every approved picture but this scene's, for Juntar (#120). */
  readonly approved: readonly ApprovedPicture[];
}) {
  const label = scene.description;
  const [busy, setBusy] = useState<Busy>(null);
  const [answered, setAnswered] = useState<LastAnswer<ImageAttempt> | null>(
    null,
  );
  const shown = attemptsToShow(attempts, answered);
  /*
   * A scene has no column for its instruction: the description is what it
   * is, and each attempt keeps what it was drawn from. So the field opens on
   * the newest attempt's instruction, which is the one the teacher was last
   * refining, or on the description when there is none yet.
   */
  const [subject, setSubject] = useState(
    () => scene.latestSubject ?? scene.description,
  );
  const [model, setModel] = useState<string>(() =>
    scene.pictureUrls !== null
      ? (defaultComposeModel() ?? DEFAULT_SCENE_MODEL)
      : scene.referenceUrl === null
        ? DEFAULT_SCENE_MODEL
        : (defaultReferenceModel() ?? DEFAULT_SCENE_MODEL),
  );
  const [reference, setReferenceUrl] = useState<string | null>(
    scene.referenceUrl,
  );
  // The chosen pictures (#120): one or the other with the reference (0033).
  const [pictures, setPictures] = useState<readonly string[] | null>(
    scene.pictureUrls,
  );
  const [modelNote, setModelNote] = useState<string | null>(null);
  const credits = isImageModelId(model) ? modelCredits(model) : null;
  const tracked = useRunningGeneration(scene.id);
  const rowRunning = runningAttempt(shown);
  const running = tracked ?? rowRunning;
  const runningId = tracked?.attemptId ?? rowRunning?.id ?? null;
  const [now, setNow] = useState(() => Date.now());
  const referenceInput = useRef<HTMLInputElement>(null);
  const finishedInput = useRef<HTMLInputElement>(null);
  const [usedSubject, setUsedSubject] = useState("");
  const zoom = useRef<HTMLDialogElement>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);

  function openZoom(url: string) {
    setZoomed(url);
    zoom.current?.showModal();
  }

  useEffect(() => {
    if (runningId === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningId]);

  async function run(
    key: string,
    action: () => Promise<ActionResult>,
    done?: () => NoticeText | null,
  ) {
    if (busy !== null) return;
    setBusy({ key });
    const result = await settle(action);
    setBusy(null);
    if ("attempts" in result && result.attempts !== undefined) {
      setAnswered({ list: result.attempts, served: attempts });
    }
    if ("reference" in result && result.reference !== undefined) {
      setReferenceUrl(result.reference);
    }
    if ("pictures" in result && result.pictures !== undefined) {
      setPictures(result.pictures);
    }
    if (result.ok) {
      const notice = done?.() ?? null;
      if (notice !== null) tell(notice);
    } else {
      tell(wordFailed(label, result.error));
      if ("cause" in result) console.error(result.cause);
    }
  }

  // A model that composes has nothing to draw without the pictures, and one
  // that does not would ignore them: with pictures, only those that compose.
  const modelOptions =
    pictures !== null && COMPOSE_MODELS.length > 0
      ? COMPOSE_MODELS
      : reference !== null && ACCEPT_REFERENCE.length > 0
        ? ACCEPT_REFERENCE
        : TEXT_MODELS;

  function choosePictures(chosen: readonly ApprovedPicture[]) {
    void run(
      "compor",
      async () => {
        const result = await setScenePictures(
          scene.id,
          chosen.map((picture) => picture.key),
        );
        if (result.ok) {
          const target = defaultComposeModel();
          if (target !== null && target !== model) {
            setModel(target);
            setModelNote(
              `Mudei para ${modelLabel(target)}, que desenha a cena a partir das imagens escolhidas.`,
            );
          }
        }
        return result;
      },
      () => picturesChosen(label, chosen.length),
    );
  }

  function moveModelToTakeReference() {
    const target = defaultReferenceModel();
    if (target === null || target === model) {
      setModelNote(null);
      return;
    }
    setModel(target);
    setModelNote(
      ACCEPT_REFERENCE.length === 1
        ? `Mudei para ${modelLabel(target)}, o único modelo que aceita referência.`
        : `Mudei para ${modelLabel(target)}, que aceita referência e tem custo medido. Os outros que aceitam estão no seletor.`,
    );
  }

  function attachReference(file: File) {
    void run(
      "referencia",
      async () => {
        let ready: File;
        try {
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
        const result = await setSceneReference(scene.id, ready);
        if (result.ok) moveModelToTakeReference();
        return result;
      },
      () => referenceAttached(label),
    );
  }

  function sendFinished(file: File) {
    void run(
      "enviar-pronta",
      async () => {
        // Before a byte leaves the browser; see the word panel's sendFinished.
        const refusal = refuseFile({ size: file.size, type: file.type });
        if (refusal !== null) return { ok: false, error: refusal };
        const result = await uploadSceneImage(scene.id, file, usedSubject);
        if (result.ok) setUsedSubject("");
        return result;
      },
      () => uploadSent(label),
    );
  }

  const working = busy !== null;

  return (
    <section
      aria-label={`Imagem da cena ${label}`}
      className="border-rule bg-surface flex flex-col gap-6 rounded-sm border p-6"
    >
      <header className="flex flex-col gap-1">
        <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Cena
        </span>
        <h2 className="text-2xl font-extrabold tracking-tight wrap-anywhere">
          {label}
        </h2>
        <span className="text-faint font-mono text-xs">
          {groupLabel(point).toLowerCase()}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Estilo
        </span>
        <label className="flex w-fit items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scene.imageStyle === "realistic"}
            disabled={working}
            onChange={(event) => {
              const style = event.target.checked ? "realistic" : "flat";
              void run(
                "estilo",
                () => setSceneStyle(scene.id, style),
                () => styleChanged(label, style),
              );
            }}
            className="accent-foreground size-4"
          />
          {busy?.key === "estilo" ? "salvando" : IMAGE_STYLE_LABELS.realistic}
        </label>
        <p className="text-faint text-xs">
          Vetor chapado por padrão. Realista é para o que não tem silhueta para
          recortar, como um cômodo.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="instrucao-cena"
          className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
        >
          Instrução
        </label>
        <input
          id="instrucao-cena"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="o que a imagem mostra, em inglês"
          className="border-rule bg-background w-full rounded-sm border px-3 py-2 text-sm"
        />
        <p className="text-faint text-xs">
          Começa pela descrição da cena. O que você mudar aqui fica guardado só
          na tentativa; a descrição da cena não muda.
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Referência
          </span>
          {reference === null && pictures !== null ? (
            // One or the other (0033): attaching here would drop the chosen
            // pictures, and the teacher has to see that, not find it later.
            <p className="text-faint text-xs">
              Tire as imagens escolhidas, abaixo, para anexar uma referência.
            </p>
          ) : reference === null ? (
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
                {/* eslint-disable-next-line @next/next/no-img-element -- a public bucket URL, shown as stored */}
                <img
                  src={reference}
                  alt={`Referência de ${label}`}
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
                    void run(
                      "tirar-referencia",
                      async () => {
                        const result = await clearSceneReference(scene.id);
                        if (result.ok) setModelNote(null);
                        return result;
                      },
                      () => referenceRemoved(label),
                    )
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
            A imagem entra como guia de forma, não de estilo.
          </p>
        </div>

        {pictures !== null && (
          <div className="flex flex-col gap-2 pt-2">
            <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
              Imagens escolhidas
            </span>
            <div className="flex flex-wrap items-start gap-2">
              {pictures.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => openZoom(url)}
                  title="Ver grande"
                  className="border-rule shrink-0 rounded-sm border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a public bucket URL, shown as stored */}
                  <img
                    src={url}
                    alt={`Imagem ${i + 1} de ${label}`}
                    className="size-20 rounded-sm object-cover"
                  />
                </button>
              ))}
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  void run(
                    "tirar-imagens",
                    async () => {
                      const result = await clearScenePictures(scene.id);
                      if (
                        result.ok &&
                        isImageModelId(model) &&
                        composesPictures(model)
                      ) {
                        setModel(DEFAULT_SCENE_MODEL);
                      }
                      if (result.ok) setModelNote(null);
                      return result;
                    },
                    () => picturesRemoved(label),
                  )
                }
                className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-50"
              >
                {busy?.key === "tirar-imagens" ? "tirando" : "Tirar"}
              </button>
            </div>
            <p className="text-faint text-xs">
              Vão separadas, nesta ordem, para o Gerar: o modelo desenha a cena
              com elas. Para trocar, escolha outras em Juntar imagens aprovadas.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {IMAGE_MODELS.length > 1 && (
            <select
              aria-label="Modelo"
              value={model}
              onChange={(event) => setModel(event.target.value)}
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
            Its own button, and the only thing here that spends: creating the
            scene generated nothing (#62).
          */}
          <button
            type="button"
            disabled={working || running !== null || subject.trim() === ""}
            onClick={() =>
              void run("gerar", async () => {
                const result = await startSceneGeneration(
                  scene.id,
                  subject,
                  model,
                );
                const opened =
                  "attempts" in result && result.attempts !== undefined
                    ? runningAttempt(result.attempts)
                    : null;
                if (opened !== null) {
                  trackGeneration({
                    attemptId: opened.id,
                    ownerId: scene.id,
                    label,
                    startedAt: opened.createdAt,
                  });
                }
                return result;
              })
            }
            className="border-foreground bg-foreground text-background rounded-sm border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy?.key === "gerar" ? "enviando" : "Gerar"}
          </button>
        </div>
        {(modelNote !== null || reference !== null || pictures !== null) && (
          <p className="text-faint text-xs">
            {modelNote ??
              (pictures !== null
                ? "Com imagens escolhidas, só os modelos que desenham a partir delas. Tire as imagens para escolher os outros."
                : "Com uma referência anexada, só os modelos que aceitam uma. Tire a referência para escolher os outros.")}
          </p>
        )}
        <p className="text-faint text-xs">
          {credits === null
            ? "O custo deste modelo ainda não foi medido no painel do Freepik."
            : `${credits} créditos por imagem, medido no painel do Freepik.`}
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Imagem pronta
          </span>
          <label htmlFor="instrucao-usada-cena" className="text-faint text-xs">
            Instrução usada (opcional)
          </label>
          <input
            id="instrucao-usada-cena"
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
            PNG, JPEG ou WebP de até {UPLOAD_LIMIT_LABEL}, enviado como está.
            Entra nas tentativas e espera a sua aprovação.
          </p>
        </div>

        <JoinApproved
          pictures={approved}
          working={working}
          busyKey={busy?.key ?? null}
          onSideBySide={(file) =>
            void run(
              "lado-a-lado",
              async () => {
                const refusal = refuseFile({
                  size: file.size,
                  type: file.type,
                });
                if (refusal !== null) return { ok: false, error: refusal };
                return uploadSceneImage(scene.id, file, "");
              },
              () => montageSent(label),
            )
          }
          onCompose={choosePictures}
          composeBlocked={
            reference === null
              ? null
              : "Tire a referência, acima, para usar as imagens como referência."
          }
        />
      </div>

      <AttemptList
        attempts={shown}
        label={label}
        now={now}
        working={working}
        busyKey={busy?.key ?? null}
        onApprove={(id) =>
          void run(
            `aprovar-${id}`,
            () => approveSceneAttempt(id),
            () => imageApproved(label),
          )
        }
        onDiscard={(id) =>
          void run(
            `descartar-${id}`,
            () => rejectSceneAttempt(id),
            () => imageDiscarded(label),
          )
        }
        onZoom={openZoom}
      />

      {/* Esc closes it, and so does a click outside the picture. */}
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
            {/* eslint-disable-next-line @next/next/no-img-element -- a public bucket URL, shown as stored */}
            <img
              src={zoomed}
              alt={`Imagem de ${label}`}
              className="max-h-[80vh] w-auto rounded-sm"
            />
          </div>
        )}
      </dialog>
    </section>
  );
}
