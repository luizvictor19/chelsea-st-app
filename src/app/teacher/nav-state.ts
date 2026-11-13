/**
 * Whether the teacher menu is minimized (icons only) or maximized (icon and
 * label), kept in a cookie rather than localStorage: the layout reads it on
 * the server, so the menu arrives at its width and never jumps after load.
 * The layout already reads the session, so it was dynamic before this.
 */
export const NAV_COOKIE = "teacher-nav";

const COLLAPSED = "collapsed";
const EXPANDED = "expanded";

/** A year: the choice is a preference, not a session. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The state a cookie value means. Anything but "collapsed", no cookie
 * included, is the maximized menu: the labels are what a first visit needs.
 */
export function isCollapsed(value: string | undefined): boolean {
  return value === COLLAPSED;
}

/**
 * The cookie the browser writes on each toggle. Scoped to /teacher, the only
 * place that reads it; Lax because nothing about it crosses sites.
 */
export function navCookie(collapsed: boolean): string {
  return [
    `${NAV_COOKIE}=${collapsed ? COLLAPSED : EXPANDED}`,
    "Path=/teacher",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ].join("; ");
}
