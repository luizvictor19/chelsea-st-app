import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireTeacher } from "@/lib/content/queries";

import { HowItWorks } from "./how-it-works";
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
 * The invites of an organization, for the admin of a school (#292, #366).
 * The platform admin invites where each invite belongs: to an organization
 * in Organizações, a founder and a personal plan in Fundadores; an old link
 * here takes her to Organizações. Who may invite whom is the database's rule
 * (0031); the form only offers what the rule allows. The organization a
 * signup enters (open_signup) takes no student invite: the signup is that
 * door.
 */
export default async function InvitesPage() {
  const { supabase, user, access } = await requireTeacher();
  if (access.platformAdmin) redirect("/teacher/organizations#convidar");

  const now = new Date();
  const [organizations, rows] = await Promise.all([
    readInvitableOrganizations(supabase, user.id, false),
    readOpenInvites(supabase),
  ]);
  const invites = openInvites(rows, organizations, now);
  const offerable = organizations.filter((each) => each.roles.length > 0);

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Convites
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Convidar</h1>
        <p className="text-muted max-w-prose">
          O link do e-mail vale por 24 horas; o convite fica aberto por 15 dias.
          Se o link vencer, use Reenviar, ou a pessoa pede um link em “Esqueci
          minha senha” com o mesmo e-mail. Quem já tem conta não recebe e-mail:
          vê o convite ao entrar na plataforma e aceita ali. Aluno não se
          convida: ele se cadastra.
        </p>
      </div>

      <HowItWorks kind="organization" />
      {offerable.length === 0 ? (
        <p className="text-muted">Você não pode convidar ninguém.</p>
      ) : (
        <InviteForm organizations={offerable} />
      )}

      <InviteList
        invites={invites}
        showOrganization={organizations.length > 1}
      />
    </section>
  );
}
