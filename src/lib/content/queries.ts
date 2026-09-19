import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import type { LessonRange } from "./lesson-range";
import {
  gaps,
  pointsInRange,
  progress,
  type Gap,
  type PointProgress,
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
      complete: isComplete(own),
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
  readonly points: readonly BookPoint[];
  /** The lessons this book has, which is what cuts the points into groups. */
  readonly lessons: readonly LessonRange[];
  readonly gaps: readonly Gap[];
  readonly progress: Progress;
  /** Where the teacher stopped, and the lesson that point belongs to. */
  readonly lastFilledPoint: number | null;
  readonly lastFilledLesson: number | null;
  /** Every point of the book's range is filled. */
  readonly complete: boolean;
};

/**
 * Whether every point of the book is filled.
 *
 * Named once and read by both shapes. A book with no points is not finished,
 * it is unconfigured, which is why the emptiness is checked and not just the
 * absence of an unfilled point.
 */
function isComplete(points: readonly PointProgress[]): boolean {
  return points.length > 0 && points.every((point) => point.filled);
}

/** A point of the book, and the lesson it is recorded under, if any. */
export type BookPoint = PointProgress & {
  readonly lesson: number | null;
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
  const lessonOf = new Map(
    (rows ?? []).map((row) => [
      row.number,
      row.lessons_content?.number ?? null,
    ]),
  );
  // The lesson a point carries is its own, not one deduced: a filled point with
  // none is the thing the screen has to show.
  const points = pointsInRange(
    filledNumbers,
    book.first_point,
    book.last_point,
  ).map((point) => ({
    ...point,
    lesson: lessonOf.get(point.number) ?? null,
  }));

  const { data: lessonRows } = await supabase
    .from("lessons_content")
    .select("id, number, first_point, last_point")
    .eq("book_id", book.id)
    .order("first_point");

  return {
    id: book.id,
    position: book.position,
    title: book.title,
    firstPoint: book.first_point,
    lastPoint: book.last_point,
    points,
    lessons: (lessonRows ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      firstPoint: row.first_point,
      lastPoint: row.last_point,
    })),
    gaps: gaps(points),
    progress: progress(points, book.first_point, book.last_point),
    complete: isComplete(points),
    lastFilledPoint: furthest?.number ?? null,
    lastFilledLesson: furthest?.lessons_content?.number ?? null,
  };
}

export type Representation = Database["public"]["Enums"]["representation_kind"];

export type WordImage = {
  readonly id: string;
  readonly term: string;
  readonly pointNumber: number | null;
  readonly representation: Representation | null;
  readonly imageUrl: string | null;
  readonly attempts: number;
  /** The rule the vocabulary_items_pending_image_idx predicate spells out. */
  readonly pending: boolean;
};

export type LessonWords = {
  /** Null for a point that belongs to no lesson yet. */
  readonly lessonNumber: number | null;
  readonly words: readonly WordImage[];
};

export type ImageAttempt = {
  readonly id: string;
  readonly status: string;
  readonly provider: string;
  readonly model: string | null;
  readonly imageUrl: string | null;
  readonly error: string | null;
  readonly creditsSpent: number | null;
  readonly createdAt: string;
};

/** A word is waiting when it has no decision, or a decision it cannot meet yet. */
function isPending(
  representation: Representation | null,
  imagePath: string | null,
): boolean {
  return (
    representation === null || (representation !== "none" && imagePath === null)
  );
}

function publicImageUrl(
  supabase: Awaited<ReturnType<typeof requireTeacher>>["supabase"],
  path: string | null,
): string | null {
  if (path === null) return null;
  return supabase.storage.from("vocabulary-images").getPublicUrl(path).data
    .publicUrl;
}

/**
 * Every word with the state of its image, grouped by lesson and in the order
 * the book introduces them.
 *
 * Sorted here rather than in the query: the ordering key lives two levels down
 * (the lesson of the point of the word) and a few hundred rows cost nothing to
 * sort, while a nested order in PostgREST is the kind of thing that quietly
 * stops applying.
 */
export async function listVocabularyImages(): Promise<{
  readonly lessons: readonly LessonWords[];
  readonly progress: Progress;
}> {
  const { supabase } = await requireTeacher();

  /*
   * image_attempts is named by its foreign key, not by its table. The two
   * tables reference each other: an attempt points at its word, and a word
   * points back at its approved attempt, so PostgREST finds two relationships
   * and refuses to guess which one the embed means. The lesson generalises:
   * whenever two tables reference each other, an embed needs the constraint
   * name. Here it is the attempt-to-word direction; the other way round would
   * be vocabulary_items_approved_attempt_id_fkey.
   */
  const { data: rows, error } = await supabase
    .from("vocabulary_items")
    .select(
      "id, term, representation, image_path, points!inner(number, lessons_content(number)), image_attempts!image_attempts_vocabulary_item_id_fkey(count)",
    );
  if (error) throw new Error(error.message);

  const all = (rows ?? []).map((row) => ({
    lessonNumber: row.points?.lessons_content?.number ?? null,
    pointNumber: row.points?.number ?? null,
    word: {
      id: row.id,
      term: row.term,
      pointNumber: row.points?.number ?? null,
      representation: row.representation,
      imageUrl: publicImageUrl(supabase, row.image_path),
      // An array now, and correctly so: naming the attempt-to-word key makes
      // this the to-many side. Unhinted, the generated type resolved to the
      // to-one approved_attempt_id relationship, so this read a count that was
      // never the number of attempts.
      attempts: row.image_attempts?.[0]?.count ?? 0,
      pending: isPending(row.representation, row.image_path),
    } satisfies WordImage,
  }));

  all.sort((a, b) => {
    // A point with no lesson sorts last: it is not part of the book's order yet.
    const lessonA = a.lessonNumber ?? Number.MAX_SAFE_INTEGER;
    const lessonB = b.lessonNumber ?? Number.MAX_SAFE_INTEGER;
    if (lessonA !== lessonB) return lessonA - lessonB;
    const pointA = a.pointNumber ?? Number.MAX_SAFE_INTEGER;
    const pointB = b.pointNumber ?? Number.MAX_SAFE_INTEGER;
    if (pointA !== pointB) return pointA - pointB;
    return a.word.term.localeCompare(b.word.term, "en");
  });

  const lessons: LessonWords[] = [];
  for (const entry of all) {
    const last = lessons.at(-1);
    if (last === undefined || last.lessonNumber !== entry.lessonNumber) {
      lessons.push({ lessonNumber: entry.lessonNumber, words: [entry.word] });
    } else {
      (last.words as WordImage[]).push(entry.word);
    }
  }

  const resolved = all.filter((entry) => !entry.word.pending).length;
  return {
    lessons,
    progress: {
      filled: resolved,
      total: all.length,
      remaining: all.length - resolved,
      fraction: all.length === 0 ? 0 : resolved / all.length,
    },
  };
}

/** Every attempt for one word, newest first, for the panel on the right. */
export async function listWordAttempts(
  wordId: string,
): Promise<readonly ImageAttempt[]> {
  const { supabase } = await requireTeacher();

  const { data: rows, error } = await supabase
    .from("image_attempts")
    .select(
      "id, status, provider, model, storage_path, error, credits_spent, created_at",
    )
    .eq("vocabulary_item_id", wordId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (rows ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    imageUrl: publicImageUrl(supabase, row.storage_path),
    error: row.error,
    creditsSpent: row.credits_spent,
    createdAt: row.created_at,
  }));
}
