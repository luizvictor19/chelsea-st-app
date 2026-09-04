import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  gaps,
  pointsUpTo,
  progress,
  type Gap,
  type Progress,
} from "./progress";

/**
 * Every content screen is the teacher's. The role is read on the server; RLS is
 * the real defence and this only decides which screen someone lands on.
 */
export async function requireTeacher() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "teacher") {
    redirect("/dashboard");
  }

  return { supabase, user, profile };
}

export type BookSummary = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly lastPoint: number | null;
  readonly progress: Progress;
};

export async function listBooks(): Promise<{
  readonly books: readonly BookSummary[];
  readonly overall: Progress;
}> {
  const { supabase } = await requireTeacher();

  const { data: books } = await supabase
    .from("books")
    .select("id, position, title, last_point")
    .order("position");

  const { data: points } = await supabase
    .from("points")
    .select("book_id, number, filled_at");

  const byBook = new Map<string, { number: number; filled: boolean }[]>();
  for (const point of points ?? []) {
    const list = byBook.get(point.book_id) ?? [];
    list.push({ number: point.number, filled: point.filled_at !== null });
    byBook.set(point.book_id, list);
  }

  const summaries = (books ?? []).map((book) => ({
    id: book.id,
    position: book.position,
    title: book.title,
    lastPoint: book.last_point,
    progress: progress(byBook.get(book.id) ?? [], book.last_point),
  }));

  const filled = summaries.reduce((sum, book) => sum + book.progress.filled, 0);
  const total = summaries.reduce((sum, book) => sum + book.progress.total, 0);

  return {
    books: summaries,
    overall: {
      filled,
      total,
      fraction: total === 0 ? 0 : Math.min(1, filled / total),
    },
  };
}

export type BookDetail = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly lastPoint: number | null;
  readonly points: readonly { number: number; filled: boolean }[];
  readonly gaps: readonly Gap[];
  readonly progress: Progress;
};

export async function loadBook(position: number): Promise<BookDetail | null> {
  const { supabase } = await requireTeacher();

  const { data: book } = await supabase
    .from("books")
    .select("id, position, title, last_point")
    .eq("position", position)
    .maybeSingle();

  if (book === null) {
    return null;
  }

  const { data: rows } = await supabase
    .from("points")
    .select("number, filled_at")
    .eq("book_id", book.id)
    .order("number");

  const filledNumbers = (rows ?? [])
    .filter((row) => row.filled_at !== null)
    .map((row) => row.number);
  const points = pointsUpTo(filledNumbers, book.last_point);

  return {
    id: book.id,
    position: book.position,
    title: book.title,
    lastPoint: book.last_point,
    points,
    gaps: gaps(points),
    progress: progress(points, book.last_point),
  };
}

export type WordWithoutImage = {
  readonly id: string;
  readonly term: string;
  readonly firstPointNumber: number | null;
};

export async function listWordsWithoutImage(): Promise<{
  readonly words: readonly WordWithoutImage[];
  readonly progress: Progress;
}> {
  const { supabase } = await requireTeacher();

  const { data: rows } = await supabase
    .from("vocabulary_items")
    .select("id, term, image_path, points!inner(number)")
    .order("term");

  const all = rows ?? [];
  const missing = all
    .filter((row) => row.image_path === null)
    .map((row) => ({
      id: row.id,
      term: row.term,
      firstPointNumber: row.points?.number ?? null,
    }));

  const withImage = all.length - missing.length;
  return {
    words: missing,
    progress: {
      filled: withImage,
      total: all.length,
      fraction: all.length === 0 ? 0 : withImage / all.length,
    },
  };
}
