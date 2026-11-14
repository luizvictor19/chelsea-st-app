import type { Metadata } from "next";
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth";
import {
  BADGE_SOURCE_LABEL,
  daySaoPaulo,
  founderSince,
  isBadgeSource,
} from "@/lib/badges";

import { Coupons, type CouponRow } from "./coupons";
import { FounderList, type Founder } from "./founder-list";
import { RepairGrant } from "./repair-grant";
import { SeatsForm } from "./seats-form";

export const metadata: Metadata = {
  title: "Fundadores",
};

/**
 * The founders (#292, 0058), for the platform admin alone: the seats, the
 * coupons (#296, 0059), who holds a live Founder seal, the seal given by hand
 * as a repair, and the seal taken back. The seal comes normally by a coupon
 * or a founder invite (/teacher/invites). Every write goes through the
 * admin's own client: founder_program's policies, create_founder_coupon,
 * founder_coupons_update, grant_badge and revoke_badge decide.
 */
export default async function FoundersPage() {
  const { supabase } = await requirePlatformAdmin();

  const [program, left, seals, signupDoor, couponRows, origins] =
    await Promise.all([
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
      supabase
        .from("founder_coupons")
        .select(
          "id, label, max_uses, expires_at, founder_coupon_redemptions(count)",
        )
        .order("created_at", { ascending: false }),
      supabase.from("signup_origins").select("person_id, origin"),
    ]);
  if (program.error)
    throw new Error(`founder_program: ${program.error.message}`);
  if (left.error) throw new Error(`founder_seats_left: ${left.error.message}`);
  if (seals.error) throw new Error(`person_badges: ${seals.error.message}`);
  if (signupDoor.error) {
    throw new Error(`organizations: ${signupDoor.error.message}`);
  }
  if (couponRows.error) {
    throw new Error(`founder_coupons: ${couponRows.error.message}`);
  }
  if (origins.error) {
    throw new Error(`signup_origins: ${origins.error.message}`);
  }

  const now = new Date();
  const coupons: CouponRow[] = couponRows.data.map((coupon) => {
    const open = new Date(coupon.expires_at) > now;
    return {
      id: coupon.id,
      label: coupon.label,
      uses: coupon.founder_coupon_redemptions[0]?.count ?? 0,
      maxUses: coupon.max_uses,
      validity: open
        ? `vale até ${daySaoPaulo(coupon.expires_at)}`
        : `vencido em ${daySaoPaulo(coupon.expires_at)}`,
      open,
    };
  });
  // Where a signup came from (#296, Q4): beside the name, where the repair
  // decides.
  const cameFrom = new Map(
    origins.data.map((row) => [row.person_id, row.origin]),
  );

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
      name: originLabel(
        member.profiles?.full_name ?? "Sem nome",
        cameFrom.get(member.user_id),
      ),
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

      <section aria-labelledby="coupons" className="flex flex-col gap-3">
        <h2 id="coupons" className="text-xl font-bold tracking-tight">
          Cupons
        </h2>
        <Coupons coupons={coupons} />
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

/** "Ana · veio pela GrifoAI" when her signup came from the GrifoAI landing. */
function originLabel(name: string, origin: string | undefined): string {
  return origin === "grifoai" ? `${name} · veio pela GrifoAI` : name;
}
