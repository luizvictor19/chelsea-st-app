/**
 * The Meet link as a teacher types it: once per student on the fixed agenda
 * (students.meet_url, until #295), once per teacher on the booking's profile
 * (teachers.meet_url, 0052, whose check teachers_meet_url_https says the same:
 * https and no space).
 */

export type MeetUrl =
  | { readonly ok: true; readonly url: string | null }
  | { readonly ok: false; readonly error: string };

/** The Meet link as typed: https only, trimmed, no space; empty clears it. */
export function parseMeetUrl(raw: string): MeetUrl {
  const text = raw.trim();
  if (text === "") return { ok: true, url: null };
  if (/\s/.test(text)) {
    return { ok: false, error: "O link não pode ter espaços." };
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "Cole o link inteiro, começando com https://." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "O link precisa começar com https://." };
  }
  return { ok: true, url: text };
}
