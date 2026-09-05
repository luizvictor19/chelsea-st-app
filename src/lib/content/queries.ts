import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  gaps,
  pointsInRange,
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
  readonly firstPoint: number | null;
  readonly lastPoint: number | null;
  readonly progress: Progress;
  /** The highest point filled so far, which is where the teacher stopped. */
  readonly lastFilledPoint: number | null;
  /** Every point of the book's range is filled. */
  readonly complete: boolean;
};

export type BooksOverview = {
  readonly books: readonly BookSummary[];
  /**
   * How many books are finished, meaning every point of their range is filled.
   *
   * Not how many have a range. Typing a range takes ten seconds and says
   * nothing about how much of the course is in the product, which is the only
   * question this screen is asked.
   */
  readonly complete: number;
  readonly total: number;
  /**
   * The share of the whole course, or null while it cannot be counted.
   *
   * The denominator is the sum of the twelve ranges, so until every book has
   * one there is no denominator: a percentage over the books that happen to be
   * configured describes those books and pretends to describe the course.
   */
  readonly course: Progress | null;
};

export async function listBooks(): Promise<BooksOverview> {
  const { supabase } = await requireTeacher();

  const { data: books } = await supabase
    .from("books")
    .select("id, position, title, first_point, last_point")
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

  const summaries = (books ?? []).map((book) => {
    const own = byBook.get(book.id) ?? [];
    const filledNumbers = own
      .filter((point) => point.filled)
      .map((point) => point.number);
    return {
      id: book.id,
      position: book.position,
      title: book.title,
      firstPoint: book.first_point,
      lastPoint: book.last_point,
      progress: progress(own, book.first_point, book.last_point),
      lastFilledPoint:
        filledNumbers.length === 0 ? null : Math.max(...filledNumbers),
      complete: own.length > 0 && own.every((point) => point.filled),
    };
  });

  const everyBookHasARange =
    summaries.length > 0 &&
    summaries.every(
      (book) => book.firstPoint !== null && book.lastPoint !== null,
    );
  const filled = summaries.reduce((sum, book) => sum + book.progress.filled, 0);
  const coursePoints = summaries.reduce(
    (sum, book) => sum + book.progress.total,
    0,
  );

  return {
    books: summaries,
    complete: summaries.filter((book) => book.complete).length,
    total: summaries.length,
    course: everyBookHasARange
      ? {
          filled,
          total: coursePoints,
          remaining: Math.max(0, coursePoints - filled),
          fraction: coursePoints === 0 ? 0 : Math.min(1, filled / coursePoints),
        }
      : null,
  };
}

export type BookDetail = {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly firstPoint: number | null;
  readonly lastPoint: number | null;
  readonly points: readonly { number: number; filled: boolean }[];
  readonly gaps: readonly Gap[];
  readonly progress: Progress;
  /** Where the teacher stopped, and the lesson that point belongs to. */
  readonly lastFilledPoint: number | null;
  readonly lastFilledLesson: number | null;
};

export async function loadBook(position: number): Promise<BookDetail | null> {
  const { supabase } = await requireTeacher();

  const { data: book } = await supabase
    .from("books")
    .select("id, position, title, first_point, last_point")
    .eq("position", position)
    .maybeSingle();

  if (book === null) {
    return null;
  }

  const { data: rows } = await supabase
    .from("points")
    .select("number, filled_at, lessons_content(number)")
    .eq("book_id", book.id)
    .order("number");

  const filledRows = (rows ?? []).filter((row) => row.filled_at !== null);
  const filledNumbers = filledRows.map((row) => row.number);
  const furthest = filledRows.at(-1) ?? null;
  const points = pointsInRange(
    filledNumbers,
    book.first_point,
    book.last_point,
  );

  return {
    id: book.id,
    position: book.position,
    title: book.title,
    firstPoint: book.first_point,
    lastPoint: book.last_point,
    points,
    gaps: gaps(points),
    progress: progress(points, book.first_point, book.last_point),
    lastFilledPoint: furthest?.number ?? null,
    lastFilledLesson: furthest?.lessons_content?.number ?? null,
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
      remaining: all.length - withImage,
      fraction: all.length === 0 ? 0 : withImage / all.length,
    },
  };
}
