/** One area of the teacher bar, with a screen behind it. */
export type NavLink = { readonly label: string; readonly href: string };

/** The content screens: written by the platform admin alone (0043, #211). */
const CONTENT: readonly NavLink[] = [
  { label: "Conteúdo", href: "/teacher/content" },
  { label: "Imagens", href: "/teacher/content/images" },
  { label: "Perguntas", href: "/teacher/content/questions" },
];

/** What whoever teaches opens. */
const TEACHING: readonly NavLink[] = [
  { label: "Aula ao vivo", href: "/teacher/lesson" },
  { label: "Alunos", href: "/teacher/students" },
  { label: "Convites", href: "/teacher/invites" },
];

/**
 * The bar of /teacher. A teacher only teaches: the content screens show only
 * to whoever writes content, and the routes refuse anyone else on their own
 * (requireContentWriter), so hiding them here is the map, not the guard.
 */
export function teacherLinks(writesContent: boolean): readonly NavLink[] {
  return writesContent ? [...CONTENT, ...TEACHING] : TEACHING;
}
