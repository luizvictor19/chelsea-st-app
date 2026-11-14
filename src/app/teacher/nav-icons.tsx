import type { NavIcon } from "./nav-links";

/** The drawings of the menu's own controls, beside the items' drawings. */
export type ControlIcon =
  "collapse" | "expand" | "menu" | "close" | "student" | "signOut";

/*
 * Drawn here, on a 24 px grid with a round 1.75 stroke, rather than taken
 * from an icon library: none is a dependency, and nineteen simple shapes do
 * not pay for one. Each is the inside of an <svg>, which colours them with
 * currentColor, so an icon follows the text colour of its item.
 */
const PATHS: Record<NavIcon | ControlIcon, React.ReactNode> = {
  home: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  content: (
    <>
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13.5C7 18 10 18.5 12 20c2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z" />
      <path d="M12 6.5V20" />
    </>
  ),
  images: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15.5-5-5L5.5 20" />
    </>
  ),
  questions: (
    <>
      <path d="M4 5h16v11H9.5L4 20Z" />
      <path d="M10 8.75a2 2 0 1 1 2.6 1.9c-.35.12-.6.45-.6.82v.53" />
      <path d="M12 13.75h.01" />
    </>
  ),
  live: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="m15 10.5 6-3.5v10l-6-3.5" />
    </>
  ),
  agenda: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  students: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17.5 14.5c2.2.3 3.6 1.9 4 4.5" />
    </>
  ),
  invites: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  lessons: (
    <>
      <path d="m12 3 9 5-9 5-9-5Z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 16.5 9 5 9-5" />
    </>
  ),
  plans: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6.5 15h4" />
    </>
  ),
  founders: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8.5 14-1.5 7 5-3 5 3-1.5-7" />
    </>
  ),
  organizations: (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
      <path d="M10.5 21v-3h3v3" />
    </>
  ),
  errors: (
    <>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.5h.01" />
    </>
  ),
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m15.5 10-2 2 2 2" />
    </>
  ),
  expand: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m13.5 10 2 2-2 2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  student: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  signOut: (
    <>
      <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9" />
    </>
  ),
};

/** One icon, decorative: its item always carries the name as text or label. */
export function Icon({ name }: { readonly name: NavIcon | ControlIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-5 shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}
