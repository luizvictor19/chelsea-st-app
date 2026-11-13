import type { Metadata } from "next";
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth";
import {
  BADGE_SOURCE_LABEL,
  daySaoPaulo,
  founderSince,
  isBadgeSource,
} from "@/lib/badges";

import { FounderList, type Founder } from "./founder-list";
import { RepairGrant } from "./repair-grant";
import { SeatsForm } from "./seats-form";

export const metadata: Metadata = {
  title: "Fundadores",
};

/**
 * The founders (#292, 0058), for the platform admin alone: the seats, who
 * holds a live Founder seal, the seal given by hand as a repair, and the seal
 * taken back. The seal comes normally by a coupon or an invite (#296). Every
 * write goes through the admin's own client: founder_program's policies,
 * grant_badge and revoke_badge decide.
 */
export default async function FoundersPage() {
  const { supabase } = await requirePlatformAdmin();

  const [program, left, seals, signupDoor] = await Promise.all([
    supabase.from("founder_program").select("seats_total").maybeSingle(),
    supabase.rpc("founder_seats_left"),
    supabase
      .from("person_badges")
      .select(
        "person_id, source, granted_at, terms_fixed_at, profiles!person_badges_person_id_fkey(full_name)",
      )
      .eq("badge", "founder")
      .is("revoked_at", null)
      .order("granted_at"),
    supabase.from("organizations").select("id").eq("open_signup", true),
  ]);
  if (program.error)
    throw new Error(`founder_program: ${program.error.message}`);
  if (left.error) throw new Error(`founder_seats_left: ${left.error.message}`);
  if (seals.error) throw new Error(`person_badges: ${seals.error.message}`);
  if (signupDoor.error) {
    throw new Error(`organizations: ${signupDoor.error.message}`);
  }

  // The students of the organization a signup enters (open_signup: Chelsea
  // St's), without a live seal: who the repair may reach.
  const doorIds = (signupDoor.data ?? []).map((org) => org.id);
  const { data: members, error: membersError } =
    doorIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("organization_members")
          .select(
            "user_id, profiles!organization_members_user_id_fkey(full_name)",
          )
          .in("organization_id", doorIds)
          .eq("role", "student");
  if (membersError)
    throw new Error(`organization_members: ${membersError.message}`);

  const founders: Founder[] = (seals.data ?? []).map((seal) => ({
    personId: seal.person_id,
    name: seal.profiles?.full_name ?? "Sem nome",
    since: founderSince(seal.granted_at),
    source: isBadgeSource(seal.source)
      ? BADGE_SOURCE_LABEL[seal.source]
      : seal.source,
    termsSince:
      seal.terms_fixed_at === null ? null : daySaoPaulo(seal.terms_fixed_at),
  }));
  const sealed = new Set(founders.map((founder) => founder.personId));
  const students = (members ?? [])
    .filter((member) => !sealed.has(member.user_id))
    .map((member) => ({
      id: member.user_id,
      name: member.profiles?.full_name ?? "Sem nome",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Fundadores
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Selo de fundador
        </h1>
        <p className="text-muted max-w-prose">
          O selo é o direito de assinar o Plano Fundador pelo preço de fundador,
          de ficar nele e de voltar a ele, para sempre. Ele não sai quando a
          assinatura vence ou é cancelada. O preço de fundador fica guardado no
          primeiro pagamento confirmado do Plano Fundador. Os planos estão em{" "}
          <Link href="/teacher/plans" className="underline">
            Planos e custos
          </Link>
          .
        </p>
      </div>

      <section aria-labelledby="seats" className="flex flex-col gap-3">
        <h2 id="seats" className="text-xl font-bold tracking-tight">
          Vagas
        </h2>
        <SeatsForm
          total={program.data?.seats_total ?? null}
          left={left.data ?? null}
        />
      </section>

      <section aria-labelledby="founders" className="flex flex-col gap-3">
        <h2 id="founders" className="text-xl font-bold tracking-tight">
          Fundadores
        </h2>
        <FounderList founders={founders} />
      </section>

      <section aria-labelledby="repair" className="flex flex-col gap-3">
        <h2 id="repair" className="text-xl font-bold tracking-tight">
          Corrigir
        </h2>
        <RepairGrant students={students} />
      </section>
    </section>
  );
}
