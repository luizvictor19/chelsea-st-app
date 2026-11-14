import { cookies } from "next/headers";

import { requireTeacher } from "@/lib/content/queries";
import { currentSite } from "@/lib/current-site";

import { PendingInvites } from "../auth/pending-invites";
import { isCollapsed, NAV_COOKIE } from "./nav-state";
import { Snackbar } from "./snackbar";
import { TeacherNav } from "./teacher-nav";

/**
 * The shell for everything under /teacher. The role is checked here so no
 * screen below has to repeat it, and the page container lives here so every
 * screen lines up on the same column.
 *
 * The menu sits on the left from md and on top below it (#316). The main
 * column takes min-w-0 in the row: without it a wide screen would push the
 * row past the window instead of keeping its width.
 */
export default async function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [{ profile, access }, site, cookieStore] = await Promise.all([
    requireTeacher(),
    currentSite(),
    cookies(),
  ]);
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <TeacherNav
        brandName={site?.brand.name ?? null}
        initial={initial}
        platformAdmin={access.platformAdmin}
        initialCollapsed={isCollapsed(cookieStore.get(NAV_COOKIE)?.value)}
      />
      <main className="mx-auto flex w-full max-w-[1760px] min-w-0 flex-1 flex-col gap-7 px-5 py-10 sm:px-8">
        <PendingInvites />
        {children}
      </main>
      {/* Outside main and outside every screen, so a notice outlives the
          screen that raised it. */}
      <Snackbar />
    </div>
  );
}
