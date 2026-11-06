"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { inviteRefusal } from "@/lib/invites";
import {
  COMPANY,
  createdButNotInvited,
  createdButNotMailed,
  organizationRefusal,
  readCompanyForm,
} from "@/lib/organizations";

import { mailInvite } from "../invites/mail-invite";

export type CompanyState =
  | { status: "idle" }
  | { status: "created"; email: string }
  // The organization exists and something after it failed: the form is not
  // given back, since sending it again would only meet the slug taken.
  | { status: "created-with-problem"; message: string }
  // Nothing was written: what was typed goes back to the form.
  | {
      status: "error";
      message: string;
      name: string;
      slug: string;
      email: string;
    };

/** Every screen that lists organizations or their invites. */
function refreshOrganizationScreens(): void {
  revalidatePath("/teacher/organizations");
  revalidatePath("/teacher/invites");
  revalidatePath("/team");
}

/**
 * Creates a company's organization (GrifoAI, no teacher) and invites its
 * first admin, with the platform admin's own client: organizations_write and
 * can_invite decide (#205). Three steps in this order, each needing the one
 * before: the organization, the invite, the email. The form is read whole
 * first, so a bad email never leaves an organization without an admin; a
 * refusal after the creation says the organization exists and where to finish.
 */
export async function createCompanyOrganization(
  _previous: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const { supabase } = await requirePlatformAdmin();

  const typed = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    email: String(formData.get("email") ?? ""),
  };
  const form = readCompanyForm(typed);
  if (!form.ok) {
    return { status: "error", message: form.message, ...typed };
  }
  const { name, slug, email } = form.company;

  const { data: organization, error } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      brand: COMPANY.brand,
      has_teacher: COMPANY.hasTeacher,
    })
    .select("id")
    .single();
  if (error) {
    return {
      status: "error",
      message: organizationRefusal(error),
      ...typed,
    };
  }

  refreshOrganizationScreens();

  const { error: inviteError } = await supabase
    .from("organization_invites")
    .insert({ organization_id: organization.id, email, role: "admin" });
  if (inviteError) {
    return {
      status: "created-with-problem",
      message: createdButNotInvited(inviteRefusal(inviteError)),
    };
  }

  const problem = await mailInvite(supabase, email, organization.id);
  if (problem !== null) {
    return {
      status: "created-with-problem",
      message: createdButNotMailed(problem),
    };
  }
  return { status: "created", email };
}
