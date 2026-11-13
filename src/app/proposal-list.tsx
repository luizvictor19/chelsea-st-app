"use client";

import { useRef, useState, useTransition, type RefObject } from "react";

import type { ProposalItem } from "@/lib/lessons/proposals/view";

import type { ProposalResult } from "./proposal-form";

const buttonClass =
  "border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const primaryClass =
  "border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
const dialogClass =
  "border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40";

type Answer = "accept" | "decline";

/**
 * Lesson proposals (#319), each with what the reader may do to it: the other
 * side accepts or declines, the proposer withdraws. Every one of the three
 * asks first, in a dialog that says what happens: the yes debits, the no
 * and the withdrawal undo what was agreed (the exception of AGENTS.md).
 * `highlight` is the dashboard's card, on top of everything.
 */
export function ProposalList({
  items,
  answer,
  withdraw,
  acceptNote,
  highlight = false,
}: {
  readonly items: readonly ProposalItem[];
  readonly answer: (id: string, answer: Answer) => Promise<ProposalResult>;
  readonly withdraw: (id: string) => Promise<ProposalResult>;
  /** Said in the yes's dialog, under the cost: who pays. */
  readonly acceptNote: string;
  readonly highlight?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProposalResult | null>(null);

  function run(action: () => Promise<ProposalResult>) {
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({
          ok: false,
          error: "A resposta não chegou. Recarregue a página para conferir.",
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {result === null ? null : result.ok ? (
        <p role="status" className="border-rule rounded-sm border p-3 text-sm">
          {result.message}
        </p>
      ) : (
        <p
          role="alert"
          className="text-accent border-accent rounded-sm border p-3 text-sm"
        >
          {result.error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <ProposalCard
            key={item.id}
            item={item}
            pending={pending}
            highlight={highlight}
            acceptNote={acceptNote}
            onAnswer={(choice) => run(() => answer(item.id, choice))}
            onWithdraw={() => run(() => withdraw(item.id))}
          />
        ))}
      </ul>
    </div>
  );
}

function ProposalCard({
  item,
  pending,
  highlight,
  acceptNote,
  onAnswer,
  onWithdraw,
}: {
  readonly item: ProposalItem;
  readonly pending: boolean;
  readonly highlight: boolean;
  readonly acceptNote: string;
  readonly onAnswer: (answer: Answer) => void;
  readonly onWithdraw: () => void;
}) {
  const accept = useRef<HTMLDialogElement>(null);
  const decline = useRef<HTMLDialogElement>(null);
  const withdraw = useRef<HTMLDialogElement>(null);
  const count =
    item.lessons.length === 1 ? "a aula" : `as ${item.lessons.length} aulas`;

  return (
    <li
      className={`bg-surface flex flex-col gap-2 rounded-sm border p-4 ${
        highlight && item.canAnswer ? "border-accent border-2" : "border-rule"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{item.title}</p>
        <p className="text-faint text-xs">{item.status}</p>
      </div>
      <ul className="text-muted list-disc pl-5 text-sm">
        {item.lessons.map((lesson) => (
          <li key={lesson} className="first-letter:uppercase">
            {lesson}
          </li>
        ))}
      </ul>
      {item.cost === null ? null : (
        <p className="text-sm">Custo: {item.cost}.</p>
      )}
      {item.balanceNote === null ? null : (
        <p className={`text-sm ${item.short ? "text-accent" : "text-muted"}`}>
          {item.balanceNote}
        </p>
      )}
      {item.warnings.map((warning) => (
        <p key={warning} className="text-accent text-sm">
          {warning}
        </p>
      ))}

      {item.canAnswer ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => accept.current?.showModal()}
            className={primaryClass}
          >
            {pending ? "enviando" : "Aceitar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => decline.current?.showModal()}
            className={buttonClass}
          >
            Recusar
          </button>
        </div>
      ) : null}
      {item.canWithdraw ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => withdraw.current?.showModal()}
          className={`${buttonClass} self-start`}
        >
          {pending ? "enviando" : "Retirar proposta"}
        </button>
      ) : null}

      <Confirm
        dialog={accept}
        title={`Aceitar ${count}?`}
        lines={[
          item.cost === null ? null : `Custo: ${item.cost}.`,
          acceptNote,
          item.balanceNote,
        ]}
        confirm="Aceitar e pagar"
        onConfirm={() => onAnswer("accept")}
      />
      <Confirm
        dialog={decline}
        title="Recusar a proposta?"
        lines={[
          "Nada é debitado. Para combinar outro horário, é preciso uma proposta nova.",
        ]}
        confirm="Recusar"
        onConfirm={() => onAnswer("decline")}
      />
      <Confirm
        dialog={withdraw}
        title="Retirar a proposta?"
        lines={[
          "Ela deixa de valer para o outro lado. Para mudar algo, retire e proponha de novo.",
        ]}
        confirm="Retirar"
        onConfirm={onWithdraw}
      />
    </li>
  );
}

function Confirm({
  dialog,
  title,
  lines,
  confirm,
  onConfirm,
}: {
  readonly dialog: RefObject<HTMLDialogElement | null>;
  readonly title: string;
  readonly lines: readonly (string | null)[];
  readonly confirm: string;
  readonly onConfirm: () => void;
}) {
  return (
    <dialog ref={dialog} className={dialogClass}>
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
        {lines.map((line) =>
          line === null ? null : (
            <p key={line} className="text-muted text-sm">
              {line}
            </p>
          ),
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <form method="dialog">
            <button type="submit" className={buttonClass}>
              Voltar
            </button>
          </form>
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
