import type { Metadata } from "next";
import Link from "next/link";

import { studies } from "@/lib/access";
import { requireManager } from "@/lib/auth";
import { TEAM_WEEKS, teamOf, weekLabels } from "@/lib/team";

import { PendingInvites } from "../auth/pending-invites";
import { SignOutButton } from "../auth/sign-out-button";
import { BrandMark } from "../brand-mark";
import {
  openInvites,
  readInvitableOrganizations,
  readOpenInvites,
} from "../teacher/invites/invitable";
import { InviteForm } from "../teacher/invites/invite-form";
import { InviteList } from "../teacher/invites/invite-list";
import { Snackbar } from "../teacher/snackbar";
import { readTeam } from "./queries";
import { TeamProgress } from "./team-progress";

export const metadata: Metadata = {
  title: "Equipe",
};

/**
 * The screen of the admin of an organization without a teacher (0042): she
 * invites her people, follows the invites and the team's practice (#198), and
 * reaches nothing of a teacher's.
 */
export default async function TeamPage() {
  const { supabase, user, access } = await requireManager();

  // Only the organizations she runs without a teacher: one where she also
  // teaches is invited to from /teacher/invites.
  const [invitable, rows] = await Promise.all([
    readInvitableOrganizations(supabase, user.id, access.platformAdmin),
    readOpenInvites(supabase),
  ]);
  const organizations = invitable.filter(
    (organization) => !organization.hasTeacher,
  );
  const now = new Date();
  const invites = openInvites(rows, organizations, now);
  const team = await readTeam(
    supabase,
    organizations.map((organization) => organization.id),
    user.id,
  );
  const sections = organizations.map((organization) => ({
    organizationId: organization.id,
    organizationName: organization.name,
    rows: teamOf({ organizationId: organization.id, ...team, now }),
  }));
  // The weeks are labelled in the admin's own zone; each row counts in its
  // person's, which differs only for a few hours around Monday's midnight.
  const viewerZone =
    team.profiles.find((profile) => profile.id === user.id)?.timeZone ??
    "America/Sao_Paulo";

  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-4">
            <BrandMark />
            <div className="flex items-center gap-4">
              {studies(access) ? (
                <Link
                  href="/dashboard"
                  className="text-muted hover:text-foreground text-sm whitespace-nowrap transition-colors"
                >
                  Praticar
                </Link>
              ) : null}
              <SignOutButton />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {organizations.length === 1 ? organizations[0].name : "Equipe"}
          </h1>
          <p className="text-muted max-w-prose">
            Convide as pessoas da empresa para praticar inglês. A pessoa recebe
            um e-mail, clica, define a senha e entra. O link do e-mail vale por
            24 horas; o convite fica aberto por 15 dias. Se o link vencer, use
            Reenviar. Quem já tem conta não recebe e-mail: vê o convite ao
            entrar na plataforma e aceita ali.
          </p>
        </div>

        <PendingInvites />

        {organizations.length === 0 ? null : (
          <TeamProgress
            sections={sections}
            weeks={weekLabels(now, viewerZone, TEAM_WEEKS)}
          />
        )}

        {organizations.length === 0 ? (
          <p className="text-muted">Você não pode convidar ninguém.</p>
        ) : (
          <InviteForm organizations={organizations} />
        )}

        <InviteList
          invites={invites}
          showOrganization={organizations.length > 1}
        />
      </main>
      {/* The invite list tells what happened to a row through it. */}
      <Snackbar />
    </>
  );
}
