/**
 * Paths that were in Portuguese until #116, and where each one went. Every
 * path is in English now; the screens still speak Portuguese.
 *
 * Kept for good, as permanent redirects (next.config.ts): an email already
 * sent (an invite, "Esqueci minha senha") carries the old path in its link,
 * and so do bookmarks and the browser's history.
 *
 * No imports, so next.config.ts can read it without pulling the app in.
 */
export const RENAMED_PATHS: readonly {
  readonly from: string;
  readonly to: string;
}[] = [
  { from: "/definir-senha", to: "/set-password" },
  { from: "/esqueci-senha", to: "/forgot-password" },
  { from: "/teacher/convites", to: "/teacher/invites" },
  { from: "/teacher/aula", to: "/teacher/lesson" },
];
