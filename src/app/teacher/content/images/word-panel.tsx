"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type {
  ImageAttempt,
  Representation,
  WordImage,
} from "@/lib/content/queries";
import { IMAGE_MODELS } from "@/lib/images/provider";
import { isDrawableKind } from "@/lib/images/style";

import {
  approveAttempt,
  generateImage,
  rejectAttempt,
  setRepresentation,
  setWordClass,
  suggestSubject,
  uploadImage,
  type ActionResult,
} from "./actions";
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
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState(() => lastSubject(attempts));
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].id);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  /*
   * Generating takes most of a minute, so the wait is counted out loud. The
   * counter is only ever set from the interval callback; it is zeroed in the
   * handler that starts the work, where the decision to start is actually made.
   *
   * The panel is mounted with key={word.id}, so moving to another word
   * remounts it and the subject field, the error and this counter reset
   * without an effect having to undo them.
   */
  useEffect(() => {
    if (busy?.key !== "gerar") return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  /*
   * Nothing on this screen moves before the server answers. A picture that
   * appears and then vanishes because the upload failed is worse than one that
   * takes a second to appear.
   */
  async function run(
    key: string,
    action: () => Promise<ActionResult>,
    // An action that wrote nothing has nothing to reread, and refreshing
    // over a field the teacher is editing is worse than doing nothing.
    { refresh = true }: { refresh?: boolean } = {},
  ) {
    if (busy !== null) return;
    setBusy({ key });
    setError(null);
    if (key === "gerar") setElapsed(0);
    const result = await action();
    setBusy(null);
    if (result.ok) {
      if (refresh) router.refresh();
    } else {
      setError(result.error);
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
   * is a decision the teacher made. Dashed in the accent colour is the model
   * proposing, which is why it is an outline and not a fill: a proposal that
   * looked like a record would be read as one. Plain is neither.
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
      return `${base} border-dashed border-accent text-foreground`;
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
                void run(`tipo-${kind}`, () => setRepresentation(word.id, kind))
              }
              className={kindClass(kind)}
            >
              {busy?.key === `tipo-${kind}` ? "salvando" : label}
            </button>
          ))}
        </div>
        {disagrees !== null && (
          <p className="text-accent/70 pt-1 text-xs">
            O modelo sugeriu {labelFor(disagrees).toLowerCase()}.
          </p>
        )}
        {suggested !== null && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="text-faint text-xs">
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
                  void run(
                    "assunto",
                    async () => {
                      const result = await suggestSubject(word.id);
                      if (result.ok) setSubject(result.subject);
                      return result.ok
                        ? { ok: true }
                        : { ok: false, error: result.error };
                    },
                    { refresh: false },
                  )
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
              {/*
                One model means nothing to choose, so the control is left out
                rather than shown with a single option. It comes back on its
                own the day IMAGE_MODELS has a second entry.
              */}
              {IMAGE_MODELS.length > 1 && (
                <select
                  aria-label="Modelo"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="border-rule bg-background rounded-sm border px-3 py-2 text-sm"
                >
                  {IMAGE_MODELS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={working || subject.trim() === ""}
                onClick={() =>
                  void run("gerar", () =>
                    generateImage(word.id, subject, model),
                  )
                }
                className="border-foreground bg-foreground text-background rounded-sm border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy?.key === "gerar" ? `gerando, ${elapsed}s` : "Gerar"}
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

      {word.imageUrl !== null && (
        <div className="flex flex-col gap-2">
          <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Aprovada
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- the bucket
              host is not in next.config, and this screen is the teacher's
              workbench, not a page whose images need optimising. */}
          <img
            src={word.imageUrl}
            alt={`Imagem aprovada de ${word.term}`}
            className="border-rule w-full max-w-[200px] rounded-sm border"
          />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <span className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Tentativas ({attempts.length})
        </span>
        {/*
          No empty state: the heading already says zero, and a sentence
          repeating it is a line of screen saying nothing twice.
        */}
        {attempts.length > 0 && (
          <ul className="flex flex-col gap-3">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="border-rule flex flex-wrap items-start gap-3 rounded-sm border p-3"
              >
                {attempt.imageUrl !== null && (
                  // eslint-disable-next-line @next/next/no-img-element -- as above
                  <img
                    src={attempt.imageUrl}
                    alt={`Tentativa para ${word.term}`}
                    className="border-rule size-20 rounded-sm border object-cover"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-xs">
                    {STATUS_LABELS[attempt.status] ?? attempt.status}
                    {attempt.model !== null && ` · ${attempt.model}`}
                    {attempt.creditsSpent !== null &&
                      ` · ${attempt.creditsSpent} créditos`}
                  </span>
                  {attempt.error !== null && (
                    <span className="text-muted text-xs">{attempt.error}</span>
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
                    {attempt.status !== "rejected" && (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() =>
                          void run(`descartar-${attempt.id}`, () =>
                            rejectAttempt(attempt.id),
                          )
                        }
                        className="text-muted hover:text-foreground rounded-sm px-3 py-1 text-xs transition-colors disabled:opacity-50"
                      >
                        {busy?.key === `descartar-${attempt.id}`
                          ? "descartando"
                          : "Descartar"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
