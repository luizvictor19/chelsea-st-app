/**
 * The founder invite as /teacher/founders makes it (#296, 0059): written in
 * founder_invites with the platform admin's own client, then mailed from
 * agenda@. When an account is already confirmed with the e-mail, the
 * database gives the seal as the row is written (founder_invites_grant_confirmed)
 * or refuses the write with no seat left. The invite is kept whatever the
 * mail does, and the screen always shows the link, to send by hand.
 *
 * Pure of Next and of Supabase: the store, the mailer and the clock come in.
 */

import { looksLikeEmail, normalizeEmail } from "./credentials.ts";
import type { Mailer } from "./mail/mailer.ts";
import {
  founderInviteEmail,
  founderInviteLink,
} from "./founder-invite-mail.ts";

export type FounderInviteValues = {
  readonly email: string;
  readonly days: number;
};

export type StoreError = { readonly code?: string; readonly message?: string };

export type FounderInviteDeps = {
  /** Writes the invite; its id, or the refusal. */
  readonly insert: (row: {
    readonly email: string;
    readonly expires_at: string;
  }) => Promise<{ ok: true; id: string } | { ok: false; error: StoreError }>;
  /**
   * Whether the invite was accepted: the seal given when it was written.
   * Null when the read failed: then nothing is mailed, rather than the
   * wrong e-mail.
   */
  readonly accepted: (id: string) => Promise<boolean | null>;
  /** Null when the app has no key to send with. */
  readonly mailer: Mailer | null;
  /** The origin of the chelsea-st site; null when there is none. */
  readonly origin: string | null;
  readonly now: () => Date;
};

export type FounderInviteState =
  | { readonly status: "idle" }
  | {
      readonly status: "sent" | "unsent";
      readonly email: string;
      readonly granted: boolean;
      /** Why it was not mailed, when it was not. */
      readonly message?: string;
      /** The link of the e-mail, to send by hand; null with no site. */
      readonly link: string | null;
    }
  | { readonly status: "error"; readonly message: string };

/** The default and the longest validity of an invite, in days. */
export const INVITE_DAYS = 15;
const MOST_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const UNCHECKED =
  "O convite foi gravado, mas não deu para conferir se ela já tem conta, e o e-mail não saiu. Use Reenviar na lista.";

export const NOT_MAILED =
  "O convite foi gravado, mas o e-mail não saiu. Mande o link abaixo, ou use Reenviar.";

export function readFounderInviteForm(
  form: FormData,
):
  | { readonly ok: true; readonly values: FounderInviteValues }
  | { readonly ok: false; readonly message: string } {
  const email = normalizeEmail(form.get("email"));
  if (!looksLikeEmail(email)) {
    return { ok: false, message: "Digite um e-mail válido." };
  }
  const text = String(form.get("days") ?? "").trim();
  const days = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(days >= 1 && days <= MOST_DAYS)) {
    return {
      ok: false,
      message: `A validade é um número de dias, de 1 a ${MOST_DAYS}.`,
    };
  }
  return { ok: true, values: { email, days } };
}

/** The validity of an invite written or renewed now. */
export function expiresAt(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** What the screen says when the write of an invite is refused. */
export function founderInviteRefusal(error: StoreError): string {
  if ((error.message ?? "").includes("founder_seats_available")) {
    return "Não há vagas de fundador. Aumente o total em Fundadores.";
  }
  if (error.code === "23505") {
    return "Já existe um convite de fundador aberto para esse e-mail. Use Reenviar na lista.";
  }
  if (error.code === "42501") {
    return "Só o admin da plataforma convida fundadores.";
  }
  return "Não foi possível gravar o convite agora. Tente de novo em alguns instantes.";
}

/** Sends the invite; the sentence to show, or null when it went. */
export async function mailFounderInvite(
  deps: Pick<FounderInviteDeps, "mailer" | "origin">,
  invite: { readonly email: string; readonly granted: boolean },
  log: (line: string) => void = (line) => console.error(line),
): Promise<string | null> {
  if (deps.mailer === null || deps.origin === null) {
    log("founder invite mail not sent: no mailer or no site");
    return NOT_MAILED;
  }
  try {
    await deps.mailer.send(
      founderInviteEmail({
        to: invite.email,
        origin: deps.origin,
        granted: invite.granted,
      }),
    );
    return null;
  } catch (cause) {
    // The kind of failure only: never the address.
    log(
      `founder invite mail failed: ${cause instanceof Error ? cause.name : "unknown"}`,
    );
    return NOT_MAILED;
  }
}

/**
 * The answer of the screen once the invite is written, mailed or not. With
 * granted unknown (null), nothing is mailed: the wrong e-mail would tell a
 * founder to create the account she has.
 */
export async function finishFounderInvite(
  deps: Pick<FounderInviteDeps, "mailer" | "origin">,
  invite: { readonly email: string; readonly granted: boolean | null },
  log?: (line: string) => void,
): Promise<FounderInviteState> {
  const granted = invite.granted === true;
  const problem =
    invite.granted === null
      ? UNCHECKED
      : await mailFounderInvite(deps, { email: invite.email, granted }, log);
  const link =
    deps.origin === null
      ? null
      : founderInviteLink(deps.origin, invite.email, granted);
  return problem === null
    ? { status: "sent", email: invite.email, granted, link }
    : {
        status: "unsent",
        email: invite.email,
        granted,
        link,
        message: problem,
      };
}

export async function inviteFounder(
  deps: FounderInviteDeps,
  form: FormData,
  log?: (line: string) => void,
): Promise<FounderInviteState> {
  const read = readFounderInviteForm(form);
  if (!read.ok) return { status: "error", message: read.message };
  const { email, days } = read.values;

  const written = await deps.insert({
    email,
    expires_at: expiresAt(deps.now(), days),
  });
  if (!written.ok) {
    return { status: "error", message: founderInviteRefusal(written.error) };
  }
  const granted = await deps.accepted(written.id);
  return finishFounderInvite(deps, { email, granted }, log);
}
