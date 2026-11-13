import { redirect } from "next/navigation";

import { destinationFor, manages, teaches, type Access } from "@/lib/access";
import { isBrandKey, type BrandKey } from "@/lib/brand";
import { homeSite } from "@/lib/brand-home";
import { currentSite, siteConfig } from "@/lib/current-site";
import { pendingPersonalPlan } from "@/lib/personal-plan-way";
import { createClient } from "@/lib/supabase/server";

/** A screen of this host, or the front door of the brand she belongs to. */
export type Destination =
  | "/login"
  | "/dashboard"
  | "/teacher"
  | "/team"
  | `/dashboard/plano?plano=${string}`
  | URL;

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The current person's roles, read on the server from organization_members and
 * platform_admins (0029), each with whether its organization has a teacher
 * (0042). A role decided in the browser is a role the browser can lie about;
 * RLS is the real defence and this is only routing.
 *
 * A read that fails counts as no role, which lands on the screen that says
 * the account is not released yet: never on a screen the person may not use.
 */
export async function readAccess(
  supabase: Client,
  userId: string,
): Promise<Access> {
  const [{ data: members }, { data: admin }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("role, organizations!inner(has_teacher)")
      .eq("user_id", userId),
    supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    platformAdmin: admin !== null,
    memberships: (members ?? []).map((member) => ({
      role: member.role,
      hasTeacher: member.organizations.has_teacher,
    })),
  };
}

/**
 * The signed-in person and her access, or the login screen: the prologue of
 * requireManager, requireInviter and requirePlatformAdmin. requireTeacher
 * keeps its own, which reads the profile beside the access in one round trip.
 */
async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  return { supabase, user, access: await readAccess(supabase, user.id) };
}

/**
 * /team is for the admin of an organization without a teacher (0042). Anyone
 * else goes where she belongs, never to a screen that would send her back.
 */
export async function requireManager() {
  const signed = await signedIn();
  if (!manages(signed.access)) {
    redirect(destinationFor(signed.access));
  }
  return signed;
}

/**
 * The invite actions serve /teacher/invites and /team: whoever teaches, or
 * runs an organization without a teacher. What each may invite is the
 * database's rule (can_invite, 0031, and the triggers of 0042).
 */
export async function requireInviter() {
  const signed = await signedIn();
  if (!teaches(signed.access) && !manages(signed.access)) {
    redirect(destinationFor(signed.access));
  }
  return signed;
}

/**
 * Only the platform admin creates an organization (#205): anyone else goes
 * where she belongs. organizations_write refuses the rest anyway.
 */
export async function requirePlatformAdmin() {
  const signed = await signedIn();
  if (!signed.access.platformAdmin) {
    redirect(destinationFor(signed.access));
  }
  return signed;
}

/**
 * The brands of the organizations someone belongs to (0041). A read that
 * fails, or a brand this code does not know, counts as none: she stays on the
 * host she came to, which is what happened before #195.
 */
async function readMemberBrands(
  supabase: Client,
  userId: string,
): Promise<BrandKey[]> {
  const { data } = await supabase
    .from("organization_members")
    .select("organizations!inner(brand)")
    .eq("user_id", userId);
  return (data ?? [])
    .map((member) => member.organizations.brand)
    .filter(isBrandKey);
}

/**
 * Where the current visitor belongs.
 *
 * Someone with no role still lands on /dashboard, which is the screen that
 * explains the account is not released yet. Sending them somewhere else would
 * need a route the spec does not have.
 *
 * Someone whose organizations all wear the other brand goes to that brand's
 * front door instead (homeSite, #195): the session is per domain, so she signs
 * in there once more.
 *
 * A student with a Plano Fundador Personalizado bound to her, on sale, and no
 * subscription alive goes to its checkout (#292, pendingPersonalPlan): the
 * way in of the plan's e-mail, after the login and after the signup.
 */
export async function resolveDestination(): Promise<Destination> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return "/login";
  }

  const [access, memberBrands, here] = await Promise.all([
    readAccess(supabase, user.id),
    readMemberBrands(supabase, user.id),
    currentSite(),
  ]);
  const there = homeSite({
    here,
    platformAdmin: access.platformAdmin,
    memberBrands,
    config: siteConfig(),
  });
  if (there) return new URL("/", there.origin);
  const destination = destinationFor(access);
  if (destination !== "/dashboard") return destination;
  return (await personalPlanCheckout(supabase, user.id)) ?? destination;
}

/** Her personal plan's checkout, when it waits for her; null otherwise. */
async function personalPlanCheckout(
  supabase: Client,
  userId: string,
): Promise<Destination | null> {
  const [{ data: plans }, { data: subscriptions }] = await Promise.all([
    supabase
      .from("plans")
      .select("id, is_active")
      .eq("audience", "person")
      .eq("person_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("status").eq("person_id", userId),
  ]);
  // A read that fails sends her to /dashboard, as before: never to a guess.
  if (plans === null || subscriptions === null) return null;
  return pendingPersonalPlan({
    destination: "/dashboard",
    plans: plans.map((plan) => ({ id: plan.id, isActive: plan.is_active })),
    subscriptionStatuses: subscriptions.map((row) => row.status),
  });
}
