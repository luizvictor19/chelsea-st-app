/**
 * The Plano Fundador Personalizado as /teacher/invites makes it (#292, 0058):
 * written for one e-mail with the platform admin's own client, then mailed
 * from agenda@. The plan is kept whatever the mail does: a mail that did not
 * go is said, and "Reenviar" sends it again.
 *
 * Pure of Next and of Supabase: the store, the mailer and the key come in,
 * so every path is tested with fakes.
 */

import type { Mailer } from "./mail/mailer.ts";
import { personalPlanEmail } from "./personal-plan-mail.ts";
import {
  readPersonalPlanForm,
  type PersonalPlanValues,
} from "./billing/plan-form.ts";

export type PersonalPlanRow = PersonalPlanValues & { readonly key: string };

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code?: string; readonly message?: string };

export type PersonalPlanDeps = {
  readonly insert: (row: PersonalPlanRow) => Promise<WriteResult>;
  /** Null when the app has no key to send with. */
  readonly mailer: Mailer | null;
  /** The origin of the site the links go to; null when there is none. */
  readonly origin: string | null;
  readonly newKey: () => string;
};

export type PersonalInvite =
  | { readonly status: "sent"; readonly email: string }
  | {
      readonly status: "unsent";
      readonly email: string;
      readonly message: string;
    }
  | { readonly status: "error"; readonly message: string };

export const NOT_MAILED =
  "O plano foi criado, mas o e-mail não saiu. Use Reenviar.";

/** "personal-" and 8 hex digits: plans_key_shape, and no name in the key. */
export function personalKey(random: Uint8Array): string {
  return `personal-${Array.from(random.slice(0, 4), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/** Sends the e-mail of a personal plan; the sentence to show, or null when it went. */
export async function mailPersonalPlan(
  deps: Pick<PersonalPlanDeps, "mailer" | "origin">,
  plan: { readonly email: string; readonly name: string },
  log: (line: string) => void = (line) => console.error(line),
): Promise<string | null> {
  if (deps.mailer === null || deps.origin === null) {
    log("personal plan mail not sent: no mailer or no site");
    return NOT_MAILED;
  }
  try {
    await deps.mailer.send(
      personalPlanEmail({
        to: plan.email,
        planName: plan.name,
        origin: deps.origin,
      }),
    );
    return null;
  } catch (cause) {
    // The kind of failure only: never the address.
    log(
      `personal plan mail failed: ${cause instanceof Error ? cause.name : "unknown"}`,
    );
    return NOT_MAILED;
  }
}

export async function invitePersonalPlan(
  deps: PersonalPlanDeps,
  form: FormData,
  log?: (line: string) => void,
): Promise<PersonalInvite> {
  const read = readPersonalPlanForm(form);
  if (!read.ok) return { status: "error", message: read.message };

  const written = await deps.insert({ ...read.values, key: deps.newKey() });
  if (!written.ok) {
    return {
      status: "error",
      message:
        written.code === "23505"
          ? "Já existe um plano com essa chave. Tente de novo."
          : "Não foi possível gravar o plano agora. Tente de novo em alguns instantes.",
    };
  }

  const problem = await mailPersonalPlan(
    deps,
    { email: read.values.person_email, name: read.values.name },
    log,
  );
  return problem === null
    ? { status: "sent", email: read.values.person_email }
    : { status: "unsent", email: read.values.person_email, message: problem };
}
