import { publicImageUrl, requireTeacher } from "@/lib/content/queries";

import { readContrastRows } from "../content/images/contrast-rows";

import { buildDeck, type DeckWord, type Slide } from "./deck";

/** A book that has a range of points, which is a book there is a lesson in. */
export type CourseBook = {
  readonly position: number;
  readonly title: string;
  readonly firstPoint: number;
  readonly lastPoint: number;
};

export type CourseLesson = {
  readonly bookPosition: number;
  readonly number: number;
  readonly firstPoint: number;
  readonly lastPoint: number;
};

/** A published question, for the teacher's side list. */
export type PointQuestion = {
  readonly id: string;
  readonly pointNumber: number;
  readonly prompt: string;
  readonly expectedAnswer: string;
};

export type Course = {
  readonly books: readonly CourseBook[];
  readonly lessons: readonly CourseLesson[];
  readonly deck: readonly Slide[];
  readonly questions: readonly PointQuestion[];
};

/**
 * Everything the live lesson screen shows, in one read.
 *
 * The whole course and not one point: the arrows walk from a point into the
 * next without asking the server, which is what keeps a shared screen from
 * blinking between words. Measured on 2026-10-01 it is 283 words; a course of
 * twelve books at that density is a few thousand short rows, still one small
 * payload.
 */
export async function loadCourse(): Promise<Course> {
  const { supabase } = await requireTeacher();

  const { data: books, error: booksError } = await supabase
    .from("books")
    .select("id, position, title, first_point, last_point")
    .order("position");
  if (booksError) throw new Error(booksError.message);

  const { data: lessons, error: lessonsError } = await supabase
    .from("lessons_content")
    .select("book_id, number, first_point, last_point")
    .order("first_point");
  if (lessonsError) throw new Error(lessonsError.message);

  const { data: words, error: wordsError } = await supabase
    .from("vocabulary_items")
    .select(
      "id, term, representation, image_path, created_at, points!inner(number)",
    );
  if (wordsError) throw new Error(wordsError.message);

  // Zero rows today. The order is the one the questions were written in.
  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id, position, prompt, expected_answer, points!inner(number)")
    .eq("is_published", true)
    .order("position");
  if (questionsError) throw new Error(questionsError.message);

  const deckWords: DeckWord[] = words.map((row) => ({
    id: row.id,
    term: row.term,
    pointNumber: row.points.number,
    createdAt: row.created_at,
    representation: row.representation,
    imageUrl: publicImageUrl(supabase, row.image_path),
  }));

  const positionOf = new Map(books.map((book) => [book.id, book.position]));

  return {
    books: books.flatMap((book) =>
      book.first_point === null || book.last_point === null
        ? []
        : [
            {
              position: book.position,
              title: book.title,
              firstPoint: book.first_point,
              lastPoint: book.last_point,
            },
          ],
    ),
    lessons: lessons.flatMap((lesson) => {
      const bookPosition = positionOf.get(lesson.book_id);
      return bookPosition === undefined
        ? []
        : [
            {
              bookPosition,
              number: lesson.number,
              firstPoint: lesson.first_point,
              lastPoint: lesson.last_point,
            },
          ];
    }),
    deck: buildDeck(deckWords, await readContrastRows()),
    questions: questions.map((row) => ({
      id: row.id,
      pointNumber: row.points.number,
      prompt: row.prompt,
      expectedAnswer: row.expected_answer,
    })),
  };
}
