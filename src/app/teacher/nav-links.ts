/** The drawings of the teacher menu, one per item (nav-icons.tsx). */
export type NavIcon =
  | "home"
  | "content"
  | "images"
  | "questions"
  | "live"
  | "agenda"
  | "students"
  | "invites"
  | "lessons"
  | "plans"
  | "organizations";

/**
 * One item of the teacher menu. A null href is an area with no screen yet,
 * shown muted instead of left out: the menu is the map of the teacher area,
 * and the area that is not ready reads as not ready rather than appearing
 * under the teacher later.
 */
export type NavLink = {
  readonly label: string;
  readonly href: string | null;
  readonly icon: NavIcon;
};

/**
 * The start of the area. The brand name links there too, but a host outside
 * the brand list shows no brand name (#194), so the start needs its own item.
 */
const HOME: readonly NavLink[] = [
  { label: "Início", href: "/teacher", icon: "home" },
];

/** The content screens: written by the platform admin alone (0043, #211). */
const CONTENT: readonly NavLink[] = [
  { label: "Conteúdo", href: "/teacher/content", icon: "content" },
  { label: "Imagens", href: "/teacher/content/images", icon: "images" },
  { label: "Perguntas", href: "/teacher/content/questions", icon: "questions" },
];

/** What whoever teaches opens. */
const TEACHING: readonly NavLink[] = [
  { label: "Aula ao vivo", href: "/teacher/lesson", icon: "live" },
  { label: "Agenda", href: "/teacher/agenda", icon: "agenda" },
  { label: "Alunos", href: "/teacher/students", icon: "students" },
  { label: "Convites", href: "/teacher/invites", icon: "invites" },
  { label: "Aulas", href: null, icon: "lessons" },
];

/** The platform's own screens, behind requirePlatformAdmin (#72, #205). */
const PLATFORM: readonly NavLink[] = [
  { label: "Planos e custos", href: "/teacher/plans", icon: "plans" },
  {
    label: "Organizações",
    href: "/teacher/organizations",
    icon: "organizations",
  },
];

/**
 * The menu of /teacher, in the sections it draws apart. A teacher only
 * teaches: the content and platform screens show only to the platform admin,
 * and the routes refuse anyone else on their own (requireContentWriter,
 * requirePlatformAdmin), so hiding them here is the map, not the guard.
 */
export function teacherSections(
  platformAdmin: boolean,
): readonly (readonly NavLink[])[] {
  return platformAdmin ? [HOME, CONTENT, TEACHING, PLATFORM] : [HOME, TEACHING];
}

/** Every item of the menu, in order. */
export function teacherLinks(platformAdmin: boolean): readonly NavLink[] {
  return teacherSections(platformAdmin).flat();
}

/**
 * The item a pathname belongs to. Imagens and Perguntas live under Conteúdo,
 * so the longest matching href wins and only one item is ever highlighted.
 * Início matches only itself: every screen sits under /teacher, and a screen
 * outside the menu lights nothing rather than the start.
 */
export function activeHref(
  links: readonly NavLink[],
  pathname: string,
): string | null {
  let active: string | null = null;
  for (const { href } of links) {
    if (href === null) continue;
    const matches =
      pathname === href ||
      (href !== "/teacher" && pathname.startsWith(`${href}/`));
    if (matches && (active === null || href.length > active.length)) {
      active = href;
    }
  }
  return active;
}
