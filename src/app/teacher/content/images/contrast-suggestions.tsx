"use client";

import { useEffect, useState } from "react";

import { saveContrastSet, suggestContrastSets } from "./actions";
import {
  addMember,
  askTwiceIfLost,
  cardsFrom,
  removeMember,
  type Card,
  type Member,
} from "./contrast-proposals";
import { MIN_MEMBERS, moveMember } from "./contrast-sets";
import { settle } from "./panel-state";

type Status =
  | { readonly kind: "idle" }
  | {
      readonly kind: "asking";
      readonly since: number;
      readonly retrying: boolean;
    }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

/**
 * "Sugerir conjuntos" for one lesson, and the proposals it brings back.
 *
 * Nothing here writes until the teacher accepts a card, and then only through
 * saveContrastSet, the same path the set section uses: a proposal is not a
 * set, and the model never declares one. Refusing a card takes it off the
 * screen and nothing more.
 *
 * `candidates` is the lesson's words with a picture and in no set, as the
 * page last rendered them. It only says whether there is anything to ask and
 * what can be added to a card; the action reads the lesson again for itself.
 *
 * Rendered as `contents` inside the lesson's header row, so the button sits
 * beside Sugerir tipos and the cards wrap onto a line of their own below.
 */
export function ContrastSuggestions({
  lessonContentId,
  candidates,
  undecided,
}: {
  readonly lessonContentId: string;
  readonly candidates: readonly Member[];
  /** Words with no kind yet, which cannot be sent: nobody knows their picture. */
  readonly undecided: number;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [cards, setCards] = useState<readonly Card[]>([]);
  /*
   * The card open for editing, and its members as they were when the edit
   * began, so Cancelar puts the proposal back rather than keeping half an
   * edit.
   */
  const [editing, setEditing] = useState<{
    readonly key: string;
    readonly before: readonly Member[];
  } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const asking = status.kind === "asking";
  useEffect(() => {
    if (!asking) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [asking]);

  const nothingToAsk = candidates.length < MIN_MEMBERS;
  const why =
    undecided > 0
      ? "Decida os tipos antes: só palavras com imagem entram num conjunto"
      : "Menos de duas palavras com imagem fora de conjunto";

  async function ask() {
    const since = Date.now();
    setNow(since);
    setStatus({ kind: "asking", since, retrying: false });
    let first = true;
    const { answer } = await askTwiceIfLost(() => {
      if (!first) setStatus({ kind: "asking", since, retrying: true });
      first = false;
      return suggestContrastSets(lessonContentId);
    });

    if (!answer.ok) {
      setStatus({ kind: "error", text: answer.error });
      return;
    }
    if (answer.sent < MIN_MEMBERS) {
      setStatus({
        kind: "note",
        text: "Não há o que sugerir: menos de duas palavras com imagem fora de conjunto.",
      });
      return;
    }
    // Added to the cards already on screen rather than replacing them: a
    // card the teacher has not decided on yet is not the model's to take back.
    setCards((current) => [...current, ...cardsFrom(answer.proposals)]);
    setStatus({
      kind: "note",
      text:
        answer.proposals.length === 0
          ? "O modelo não propôs nenhum conjunto."
          : answer.proposals.length === 1
            ? "1 conjunto proposto."
            : `${answer.proposals.length} conjuntos propostos.`,
    });
  }

  function update(key: string, change: (card: Card) => Card) {
    setCards((current) =>
      current.map((card) => (card.key === key ? change(card) : card)),
    );
  }

  function drop(key: string) {
    setCards((current) => current.filter((card) => card.key !== key));
    if (editing?.key === key) setEditing(null);
  }

  async function accept(card: Card) {
    if (saving !== null) return;
    setSaving(card.key);
    const result = await settle(() =>
      saveContrastSet(
        card.members.map((member) => member.id),
        null,
      ),
    );
    setSaving(null);
    if (result.ok) {
      drop(card.key);
      return;
    }
    // The proposal stays, with the reason on it, to be edited or refused.
    update(card.key, (c) => ({ ...c, error: result.error }));
  }

  const elapsed =
    status.kind === "asking"
      ? Math.max(0, Math.round((now - status.since) / 1000))
      : 0;

  return (
    <div className="contents">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={asking || nothingToAsk}
          onClick={() => void ask()}
          title={
            nothingToAsk
              ? why
              : "Propõe conjuntos de contraste. Nada é gravado até você aceitar."
          }
          className="border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs font-semibold normal-case transition-colors disabled:opacity-40"
        >
          {asking ? "sugerindo" : "Sugerir conjuntos"}
        </button>
        <span className="flex items-center gap-2">
          {asking && (
            <span
              role="progressbar"
              aria-label="Esperando a proposta de conjuntos"
              aria-valuetext={`${elapsed} segundos`}
              className="bg-surface block h-1 w-40 overflow-hidden rounded-full"
            >
              <span className="bg-foreground contrast-wait block h-full" />
            </span>
          )}
          <span className="text-faint text-xs normal-case">
            {status.kind === "asking"
              ? status.retrying
                ? `A resposta se perdeu no caminho. Perguntando de novo · ${elapsed} s`
                : `${elapsed} s · costuma levar de 30 s a 1 min`
              : status.kind === "note"
                ? status.text
                : nothingToAsk
                  ? why
                  : ""}
          </span>
        </span>
      </div>

      {status.kind === "error" && (
        <p role="alert" className="text-accent basis-full text-xs normal-case">
          {status.text}
        </p>
      )}

      {cards.length > 0 && (
        <ul className="flex basis-full flex-col gap-2 normal-case">
          {cards.map((card) => {
            const open = editing?.key === card.key;
            const busy = saving === card.key;
            const addable = candidates.filter(
              (word) => !card.members.some((m) => m.id === word.id),
            );
            return (
              <li
                key={card.key}
                className="border-rule bg-surface flex flex-col gap-2 rounded-sm border p-3"
              >
                {open ? (
                  <ol className="flex flex-col gap-1">
                    {card.members.map((member, index) => (
                      <li key={member.id} className="flex items-center gap-2">
                        <span className="text-faint w-5 font-mono text-xs">
                          {index + 1}
                        </span>
                        <span className="mr-auto text-sm font-semibold">
                          {member.term}
                          <span className="text-faint ml-1 font-mono text-xs">
                            {member.point ?? "·"}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`Subir ${member.term}`}
                          disabled={busy || index === 0}
                          onClick={() =>
                            update(card.key, (c) => ({
                              ...c,
                              members: reorder(c.members, index, -1),
                              error: null,
                            }))
                          }
                          className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Descer ${member.term}`}
                          disabled={busy || index === card.members.length - 1}
                          onClick={() =>
                            update(card.key, (c) => ({
                              ...c,
                              members: reorder(c.members, index, 1),
                              error: null,
                            }))
                          }
                          className="text-muted hover:text-foreground px-1 text-sm disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            update(card.key, (c) => removeMember(c, member.id))
                          }
                          className="text-muted hover:text-foreground px-1 text-xs disabled:opacity-30"
                        >
                          tirar
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm">
                    {card.members.map((member, index) => (
                      <span key={member.id}>
                        {index > 0 && <span className="text-faint"> · </span>}
                        <span className="font-semibold">{member.term}</span>
                        <span className="text-faint ml-1 font-mono text-xs">
                          {member.point ?? "·"}
                        </span>
                      </span>
                    ))}
                  </p>
                )}

                {card.reason !== "" && (
                  <p className="text-muted text-xs">{card.reason}</p>
                )}

                {open && addable.length > 0 && (
                  <label className="text-faint flex items-center gap-2 text-xs">
                    Acrescentar
                    <select
                      value=""
                      disabled={busy}
                      onChange={(event) => {
                        const word = addable.find(
                          (w) => w.id === event.target.value,
                        );
                        if (word !== undefined) {
                          update(card.key, (c) => addMember(c, word));
                        }
                      }}
                      className="border-rule bg-background text-foreground rounded-sm border px-2 py-1 text-sm"
                    >
                      <option value="">escolha uma palavra</option>
                      {addable.map((word) => (
                        <option key={word.id} value={word.id}>
                          {word.term} ({word.point ?? "·"})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {card.error !== null && (
                  <p role="alert" className="text-accent text-xs">
                    {card.error}
                  </p>
                )}
                {open && card.members.length < MIN_MEMBERS && (
                  <p className="text-muted text-xs">
                    Um conjunto precisa de pelo menos duas palavras.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      saving !== null || card.members.length < MIN_MEMBERS
                    }
                    onClick={() => void accept(card)}
                    className="border-foreground bg-foreground text-background rounded-sm border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? "gravando" : open ? "Salvar conjunto" : "Aceitar"}
                  </button>
                  {open ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const before = editing.before;
                        update(card.key, (c) => ({
                          ...c,
                          members: before,
                          error: null,
                        }));
                        setEditing(null);
                      }}
                      className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors"
                    >
                      Cancelar edição
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || editing !== null}
                      onClick={() =>
                        setEditing({ key: card.key, before: card.members })
                      }
                      className="border-rule hover:bg-background rounded-sm border px-3 py-1 text-xs transition-colors disabled:opacity-40"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => drop(card.key)}
                    title="Tira a proposta da tela. Nada é gravado."
                    className="text-muted hover:text-foreground px-2 py-1 text-xs"
                  >
                    Recusar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function reorder(
  members: readonly Member[],
  index: number,
  delta: -1 | 1,
): readonly Member[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  return moveMember(
    members.map((member) => member.id),
    index,
    delta,
  ).map((id) => byId.get(id) as Member);
}
