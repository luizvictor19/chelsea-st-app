"use client";

import type { ProposalItem } from "@/lib/lessons/proposals/view";

import { ProposalList } from "../proposal-list";
import { answerMyProposal, withdrawMyProposal } from "./lessons/actions";

/** Said in the yes's dialog: who pays, and what the yes brings. */
export const STUDENT_ACCEPT_NOTE =
  "Os créditos saem do seu saldo, pelo custo da aula do seu plano. Cada aula chega na sua agenda e pode ser cancelada até 1 hora antes, com os créditos de volta.";

/**
 * The teacher's open proposals, on top of /dashboard (#319): the "bem
 * visível" of the issue, one card each, with the cost, her balance and the
 * yes or no, each behind a dialog.
 */
export function ProposalCards({
  items,
}: {
  readonly items: readonly ProposalItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Propostas de aula" className="flex flex-col gap-2">
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        {items.length === 1
          ? "Uma proposta de aula para você"
          : `${items.length} propostas de aula para você`}
      </p>
      <ProposalList
        items={items}
        answer={answerMyProposal}
        withdraw={withdrawMyProposal}
        acceptNote={STUDENT_ACCEPT_NOTE}
        highlight
      />
    </section>
  );
}
