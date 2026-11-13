import type { Metadata } from "next";
import Link from "next/link";

import { requireTeacher } from "@/lib/content/queries";

import {
  openInvites,
  readInvitableOrganizations,
  readOpenInvites,
  readWaitingPersonalPlans,
} from "./invitable";
import { InviteList } from "./invite-list";
import { InviteTypes } from "./invite-types";

export const metadata: Metadata = {
  title: "Convites",
};

/**
 * The one invite screen (#292): invite someone to an organization, or, for
 * the platform admin, make a Plano Fundador Personalizado for an e-mail; and
 * follow what is still open. Who may invite whom is the database's rule
 * (0031); the form only offers what the rule allows, so a refusal is the
 * exception and not the way to learn it. The organization a signup enters
 * (open_signup) takes no student invite: the signup is that door.
 */
export default async function InvitesPage() {
  const { supabase, user, access } = await requireTeacher();

  const [organizations, rows, personalPlans] = await Promise.all([
    readInvitableOrganizations(supabase, user.id, access.platformAdmin),
    readOpenInvites(supabase),
    access.platformAdmin ? readWaitingPersonalPlans(supabase) : [],
  ]);
  const invites = openInvites(rows, organizations, new Date());

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Convites
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Convidar</h1>
        <p className="text-muted max-w-prose">
          Organização: a pessoa recebe um e-mail, clica, define a senha e entra.
          O link do e-mail vale por 24 horas; o convite fica aberto por 15 dias.
          Se o link vencer, use Reenviar, ou a pessoa pede um link em “Esqueci
          minha senha” com o mesmo e-mail. Quem já tem conta não recebe e-mail:
          vê o convite ao entrar na plataforma e aceita ali. Avise a pessoa.
          Aluna não se convida: ela se cadastra.
        </p>
        {access.platformAdmin && (
          <p className="text-muted max-w-prose">
            Plano personalizado: o plano fica pronto para o e-mail, e a pessoa
            recebe um e-mail da agenda com o link para entrar ou criar a conta.
            Ao entrar com esse e-mail, ela cai na assinatura do plano. O convite
            vale enquanto o plano estiver à venda.
          </p>
        )}
        {access.platformAdmin && (
          <Link
            href="/teacher/organizations"
            className="text-accent self-start font-semibold underline"
          >
            Nova empresa
          </Link>
        )}
      </div>

      <InviteTypes
        organizations={organizations}
        platformAdmin={access.platformAdmin}
      />

      <InviteList
        invites={invites}
        showOrganization={organizations.length > 1}
        personalPlans={personalPlans}
      />
    </section>
  );
}
