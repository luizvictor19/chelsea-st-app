"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { SignOutButton } from "../auth/sign-out-button";
import { Icon } from "./nav-icons";
import { activeHref, teacherSections, type NavLink } from "./nav-links";
import { navCookie } from "./nav-state";

type Account = {
  readonly initial: string;
  /** Also a student: the admin who checks the student's screens. */
  readonly alsoStudent: boolean;
  /** The platform admin: the content and platform screens (0043, #211). */
  readonly platformAdmin: boolean;
};

/**
 * The menu of /teacher (#316), in two shapes for one list:
 *
 * - From md, a column down the left that minimizes to its icons and
 *   maximizes to icon and label. Minimized, every item keeps its name as
 *   aria-label and title, so a screen reader and a pointer still read it.
 * - Below md, a bar of 3.5rem and a 1px rule, as the old top bar (the screens
 *   that subtract its height still add up), with a button that opens the menu
 *   in a drawer. The content keeps the whole width, and nothing scrolls
 *   sideways at 360 px.
 */
export function TeacherNav({
  brandName,
  initialCollapsed,
  ...account
}: Account & {
  /** The Host's brand (#194); null on an unknown host, which names none. */
  readonly brandName: string | null;
  /** Minimized on the last visit, read from the cookie by the layout. */
  readonly initialCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const drawer = useRef<HTMLDialogElement>(null);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Read by the layout on the next load; this page already shows it.
    document.cookie = navCookie(next);
  }

  return (
    <>
      <header className="border-rule bg-background sticky top-0 z-10 border-b md:hidden">
        <div className="flex h-14 items-center gap-2 px-3">
          <button
            type="button"
            aria-label="Abrir o menu"
            aria-haspopup="dialog"
            onClick={() => drawer.current?.showModal()}
            className={ICON_BUTTON}
          >
            <Icon name="menu" />
          </button>
          <Brand name={brandName} />
          <Avatar initial={account.initial} className="mr-2 ml-auto" />
        </div>
      </header>

      {/*
        The drawer of the filters on Imagens, from the same edge: showModal
        brings Esc and the focus move, and a click that lands on the dialog
        element itself never reached the contents, so it is a click outside.
      */}
      <dialog
        ref={drawer}
        aria-label="Menu da área do professor"
        onClick={(event) => {
          if (event.target === drawer.current) drawer.current?.close();
        }}
        className="drawer bg-background text-foreground border-rule m-0 mr-auto h-dvh max-h-none w-72 max-w-[85vw] border-r p-0 backdrop:bg-black/40"
      >
        <div className="flex h-full flex-col">
          <div className="border-rule flex h-14 shrink-0 items-center gap-2 border-b px-3">
            <button
              type="button"
              aria-label="Fechar o menu"
              onClick={() => drawer.current?.close()}
              className={ICON_BUTTON}
            >
              <Icon name="close" />
            </button>
            <Brand name={brandName} />
          </div>
          <Menu
            {...account}
            collapsed={false}
            onNavigate={() => drawer.current?.close()}
          />
        </div>
      </dialog>

      <aside
        className={`border-rule bg-background sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-150 md:flex ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <div
          className={`border-rule flex h-12 shrink-0 items-center border-b px-3 ${
            collapsed ? "justify-center" : "justify-between gap-2"
          }`}
        >
          {collapsed ? null : <Brand name={brandName} />}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Maximizar o menu" : "Minimizar o menu"}
            title={collapsed ? "Maximizar o menu" : "Minimizar o menu"}
            className={ICON_BUTTON}
          >
            <Icon name={collapsed ? "expand" : "collapse"} />
          </button>
        </div>
        <Menu {...account} collapsed={collapsed} />
      </aside>
    </>
  );
}

const ICON_BUTTON =
  "text-muted hover:text-foreground hover:bg-surface flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors";

const IDLE = "text-muted hover:text-foreground hover:bg-surface cursor-pointer";

/**
 * Every row of the menu: one height, the icon first, the label beside it.
 * Relative, so a label kept for screen readers alone stays inside its row.
 */
function rowClass(collapsed: boolean, tone: string): string {
  return `relative flex h-8 w-full items-center gap-3 rounded-sm text-sm whitespace-nowrap transition-colors ${
    collapsed ? "justify-center" : "px-3"
  } ${tone}`;
}

function Brand({ name }: { readonly name: string | null }) {
  if (name === null) return null;
  return (
    <Link
      href="/teacher"
      className="text-foreground min-w-0 truncate px-1 text-[0.9375rem] font-extrabold tracking-[-0.02em] whitespace-nowrap"
    >
      {name}
    </Link>
  );
}

function Avatar({
  initial,
  className = "",
}: {
  readonly initial: string;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`bg-rule text-muted flex size-[26px] shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold ${className}`}
    >
      {initial}
    </span>
  );
}

/**
 * The items and the account. The items scroll on their own only in a window
 * too short for them, so the account stays in sight and nothing is ever cut
 * off. Rows of h-8 keep the whole column of the platform admin, with "Ver
 * como aluna", at 639 px (measured in Chromium on 13/11), inside a laptop's
 * 1366x768 window once the browser takes its bar.
 */
function Menu({
  initial,
  alsoStudent,
  platformAdmin,
  collapsed,
  onNavigate,
}: Account & {
  readonly collapsed: boolean;
  /** The drawer closes on a tap on any item. */
  readonly onNavigate?: () => void;
}) {
  const sections = teacherSections(platformAdmin);
  const active = activeHref(sections.flat(), usePathname());

  return (
    <>
      <nav
        aria-label="Área do professor"
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 py-2"
      >
        {sections.map((section, index) => (
          <ul
            key={section[0].label}
            className={`flex flex-col ${
              index === 0 ? "" : "border-rule mt-1.5 border-t pt-1.5"
            }`}
          >
            {section.map((link) => (
              <li key={link.label}>
                <Item
                  link={link}
                  active={link.href !== null && link.href === active}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        ))}
      </nav>

      <div className="border-rule flex shrink-0 flex-col border-t px-3 py-2">
        <div
          title={collapsed ? "Professor" : undefined}
          className={`flex h-8 items-center gap-3 ${collapsed ? "justify-center" : "px-3"}`}
        >
          <Avatar initial={initial} className="-mx-[3px]" />
          {collapsed ? null : (
            <span className="text-faint font-mono text-[0.6875rem]">
              professor
            </span>
          )}
        </div>
        {alsoStudent ? (
          <Link
            href="/dashboard"
            onClick={onNavigate}
            aria-label={collapsed ? "Ver como aluna" : undefined}
            title={collapsed ? "Ver como aluna" : undefined}
            className={rowClass(collapsed, IDLE)}
          >
            <Icon name="student" />
            {collapsed ? null : <span>Ver como aluna</span>}
          </Link>
        ) : null}
        <SignOutButton
          label={collapsed ? "Sair da conta" : undefined}
          className={rowClass(collapsed, IDLE)}
        >
          <Icon name="signOut" />
          {collapsed ? null : <span>Sair da conta</span>}
        </SignOutButton>
      </div>
    </>
  );
}

function Item({
  link: { label, href, icon },
  active,
  collapsed,
  onNavigate,
}: {
  readonly link: NavLink;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly onNavigate?: () => void;
}) {
  if (href === null) {
    // A span has no accessible name of its own, so the label stays in the
    // text, hidden from sight alone when the menu is minimized.
    return (
      <span
        aria-disabled="true"
        title={collapsed ? `${label} · em breve` : "Em breve"}
        className={rowClass(collapsed, "text-faint cursor-default")}
      >
        <Icon name={icon} />
        <span className={collapsed ? "sr-only" : undefined}>{label}</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={rowClass(
        collapsed,
        active ? "bg-surface text-foreground font-semibold" : IDLE,
      )}
    >
      <Icon name={icon} />
      {collapsed ? null : <span>{label}</span>}
    </Link>
  );
}
