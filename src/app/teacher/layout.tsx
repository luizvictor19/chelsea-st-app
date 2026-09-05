import { requireTeacher } from "@/lib/content/queries";

import { TeacherNav } from "./teacher-nav";

/**
 * The shell for everything under /teacher. The role is checked here so no
 * screen below has to repeat it, and the page container lives here so every
 * screen lines up on the same column.
 */
export default async function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { profile } = await requireTeacher();
  const initial = profile.full_name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex min-h-dvh flex-col">
      <TeacherNav initial={initial} />
      <main className="mx-auto flex w-full max-w-[1760px] flex-1 flex-col gap-7 px-5 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
