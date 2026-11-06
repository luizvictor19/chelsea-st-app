import type { Metadata } from "next";

import { requireTeacher } from "@/lib/content/queries";

import {
  openInvites,
  readInvitableOrganizations,
  readOpenInvites,
} from "./invitable";
import { InviteForm } from "./invite-form";
import { InviteList } from "./invite-list";

export const metadata: Metadata = {
  title: "Convites",
};

/**
 * Invite someone to an organization, and follow the invites still open. Who may
 * invite whom is the database's rule (0031); the form only offers what the
 * rule allows, so a refusal is the exception and not the way to learn it.
 */
export default async function InvitesPage() {
  const { supabase, user, access } = await requireTeacher();

  const [organizations, rows] = await Promise.all([
    readInvitableOrganizations(supabase, user.id, access.platformAdmin),
    readOpenInvites(supabase),
  ]);
  const invites = openInvites(rows, organizations, new Date());

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Convites
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Convidar para a escola
        </h1>
        <p className="text-muted max-w-prose">
          A pessoa recebe um e-mail, clica, define a senha e entra. O link do
          e-mail vale por 24 horas; o convite fica aberto por 15 dias. Se o link
          vencer, use Reenviar, ou a pessoa pede um link em “Esqueci minha
          senha” com o mesmo e-mail. Quem já tem conta não recebe e-mail: vê o
          convite ao entrar na plataforma e aceita ali. Avise a pessoa.
        </p>
      </div>

      {organizations.length === 0 ? (
        <p className="text-muted">Você não pode convidar ninguém.</p>
      ) : (
        <InviteForm organizations={organizations} />
      )}

      <InviteList
        invites={invites}
        showOrganization={organizations.length > 1}
      />
    </section>
  );
}
