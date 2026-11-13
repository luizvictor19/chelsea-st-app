"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "../auth/sign-out-button";
import { activeHref, teacherLinks } from "./nav-links";

export function TeacherNav({
  brandName,
  initial,
  alsoStudent,
  platformAdmin,
}: {
  /** The Host's brand (#194); null on an unknown host, which names none. */
  readonly brandName: string | null;
  readonly initial: string;
  /** Also a student: the admin who checks the student's screens. */
  readonly alsoStudent: boolean;
  /** The platform admin: the content and platform screens (0043, #211). */
  readonly platformAdmin: boolean;
}) {
  const links = teacherLinks(platformAdmin);
  const active = activeHref(links, usePathname());

  return (
    <header className="border-rule bg-background sticky top-0 z-10 border-b">
      <div className="mx-auto flex h-14 w-full max-w-[1760px] items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-4 sm:gap-8">
          {brandName ? (
            <Link
              href="/teacher"
              className="text-foreground shrink-0 text-[0.9375rem] font-extrabold tracking-[-0.02em] whitespace-nowrap"
            >
              {brandName}
            </Link>
          ) : null}
          <nav
            aria-label="Área do professor"
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
          >
            {links.map(({ label, href }) =>
              href === null ? (
                <span
                  key={label}
                  aria-disabled="true"
                  title="Em breve"
                  className="text-faint cursor-default rounded-sm px-3 py-1.5 text-sm whitespace-nowrap"
                >
                  {label}
                </span>
              ) : (
                <Link
                  key={href}
                  href={href}
                  aria-current={active === href ? "page" : undefined}
                  className={
                    active === href
                      ? "bg-surface text-foreground rounded-sm px-3 py-1.5 text-sm font-semibold whitespace-nowrap"
                      : "text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm whitespace-nowrap transition-colors"
                  }
                >
                  {label}
                </Link>
              ),
            )}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3.5">
          {alsoStudent ? (
            <Link
              href="/dashboard"
              className="text-muted hover:text-foreground text-sm whitespace-nowrap transition-colors"
            >
              Ver como aluna
            </Link>
          ) : null}
          <span className="text-faint hidden font-mono text-[0.6875rem] sm:inline">
            professor
          </span>
          <span
            aria-hidden="true"
            className="bg-rule text-muted flex size-[26px] items-center justify-center rounded-full text-[0.6875rem] font-bold"
          >
            {initial}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
