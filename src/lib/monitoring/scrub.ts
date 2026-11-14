/**
 * What an error may keep before it is stored or e-mailed (#69): the text of
 * an error can carry a person (an e-mail, what she said, her id, a CPF, a
 * token), so every message, stack and route goes through here, on the
 * server, also what the browser sends: nothing that arrives is trusted.
 *
 * A pattern cannot see a loose name. The rule that covers it is in
 * docs/context.md (Sensitive data): an error message never interpolates a
 * name, an e-mail or what someone said.
 *
 * Pure: the browser bundle and the tests import it without a server.
 */

export const MESSAGE_LIMIT = 500;
export const STACK_LIMIT = 4000;
/** Frames kept after the stack's first line. */
export const STACK_FRAMES = 30;
export const ROUTE_LIMIT = 200;

/** Characters that end a URL inside a message or a frame. */
const URL_END = `\\s"'<>()`;

/**
 * The rules, in order. The query of a URL goes first (its token_hash would
 * otherwise reach the later rules in pieces); the tokens before the
 * numbers, so a key is one [token] and not a key with [número] inside; the
 * Key (column)=(value) before the e-mail and the quotes, so its value is one
 * [valor]; the UUID before the numbers, for the same reason.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  // The query and the fragment of a URL, with or without its host; a frame's
  // line and column after the query stay.
  [
    new RegExp(
      `((?:\\bhttps?://|/)[^?#${URL_END}]*)[?#][^${URL_END}]*?(:\\d+:\\d+)?(?=[${URL_END}]|$)`,
      "g",
    ),
    "$1$2",
  ],
  // A token handed as a parameter, outside any URL.
  [
    /\b(token_hash|access_token|refresh_token|token|code)=[^\s&#"'<>()]+/g,
    "$1=[token]",
  ],
  // A JWT (the session cookie holds one with the e-mail).
  [/\beyJ[\w-]+(?:\.[\w-]+)*/g, "[token]"],
  // The keys of the app, by their prefix: Supabase, Asaas, Resend.
  [/\$?\b(?:sb_secret_|sb_publishable_|aact_|re_)[\w+/=-]+/g, "[token]"],
  [/\bBearer\s+[^\s"'<>()]+/g, "Bearer [token]"],
  // Postgres's detail of a unique or foreign key: the value is a person's.
  [/\bKey \(([^\n]*?)\)=\(([^\n]*)\)/g, "Key ($1)=([valor])"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // Quoted text: what someone said, a name. A quoted identifier with an
  // underscore (a constraint, a function) is no person and says where it
  // failed, so it stays; any other quoted text goes.
  [/"(?![a-z0-9]+(?:_[a-z0-9]+)+")[^"\n]*"/g, '"[texto]"'],
  [/`[^`\n]*`/g, '"[texto]"'],
  [/“[^”\n]*”/g, '"[texto]"'],
  [/‘[^’\n]*’/g, '"[texto]"'],
  // A single quote opens and closes only beside a non-letter, so a
  // contraction (can't) neither opens nor closes, and one inside (I don't
  // know) does not end the text.
  [
    /(?<![\p{L}\p{N}])'(?:[^'\n]|'(?=[\p{L}\p{N}]))*'(?![\p{L}\p{N}])/gu,
    '"[texto]"',
  ],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "[id]",
  ],
  // Eight digits or more, with or without separators: a CPF (123.456.789-09
  // or not), a WhatsApp (+55 (11) 98765-4321 or 5511987654321).
  [/\+?\d(?:[ .()-]{0,2}\d){7,}/g, "[número]"],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function scrubMessage(text: string): string {
  const out = scrubText(text).trim().slice(0, MESSAGE_LIMIT);
  return out === "" ? "(sem mensagem)" : out;
}

/** The whole stack: its first line repeats the message. */
export function scrubStack(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text.trim() === "") return null;
  return scrubText(text)
    .split("\n")
    .slice(0, STACK_FRAMES + 1)
    .join("\n")
    .slice(0, STACK_LIMIT);
}

/**
 * A route as a pattern: no query, no fragment, an id as [id], a number as
 * [n]. The server's routePath is already a pattern (/teacher/[book]); the
 * browser's pathname is made one here and in client.ts.
 */
export function scrubRoute(text: string): string {
  const path = text.replace(/[?#][\s\S]*$/, "");
  const out = scrubText(
    path
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "[id]",
      )
      .replace(/(?<=\/)\d+(?=\/|$)/g, "[n]"),
  ).slice(0, ROUTE_LIMIT);
  return out === "" ? "/" : out;
}

/** Next's digest is a hash of the error, letters, digits and hyphens. */
export function scrubDigest(text: string | null | undefined): string | null {
  return typeof text === "string" && /^[\w-]{1,64}$/.test(text) ? text : null;
}
