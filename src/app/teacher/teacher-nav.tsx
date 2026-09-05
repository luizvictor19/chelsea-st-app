"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The areas that already have a screen behind them. */
const links = [
  { label: "Conteúdo", href: "/teacher/content" },
  { label: "Imagens", href: "/teacher/content/images" },
] as const;

/*
 * Aulas and Alunos have no screens yet, and are rendered as plain disabled
 * labels instead of being left out. The bar is the map of the teacher area:
 * showing all four says what the product is, and the two that are not ready
 * read as not ready. Omitting them would hide the shape now and make the bar
 * grow under the teacher later, which is a worse surprise than a muted label.
 */
const comingSoon = ["Aulas", "Alunos"] as const;

/**
 * The section a pathname belongs to. Imagens lives under Conteúdo, so the
 * longest matching href wins and only one item is ever highlighted.
 */
function activeHref(pathname: string): string | null {
  let active: string | null = null;
  for (const { href } of links) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (active === null || href.length > active.length)) {
      active = href;
    }
  }
  return active;
}

export function TeacherNav({ initial }: { readonly initial: string }) {
  const active = activeHref(usePathname());

  return (
    <header className="border-rule bg-background sticky top-0 z-10 border-b">
      <div className="mx-auto flex h-14 w-full max-w-[1160px] items-center justify-between gap-6 px-5 sm:px-7">
        <div className="flex min-w-0 items-center gap-4 sm:gap-8">
          <Link
            href="/teacher"
            className="text-foreground shrink-0 text-[15px] font-extrabold tracking-[-0.02em] whitespace-nowrap"
          >
            Chelsea St
          </Link>
          <nav
            aria-label="Área do professor"
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
          >
            {links.map(({ label, href }) => (
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
            ))}
            {comingSoon.map((label) => (
              <span
                key={label}
                aria-disabled="true"
                title="Em breve"
                className="text-faint cursor-default rounded-sm px-3 py-1.5 text-sm whitespace-nowrap"
              >
                {label}
              </span>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3.5">
          <span className="text-faint hidden font-mono text-[11px] sm:inline">
            professor
          </span>
          <span
            aria-hidden="true"
            className="bg-rule text-muted flex size-[26px] items-center justify-center rounded-full text-[11px] font-bold"
          >
            {initial}
          </span>
        </div>
      </div>
    </header>
  );
}
