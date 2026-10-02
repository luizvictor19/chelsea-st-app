import { publicImageUrl, requireTeacher } from "@/lib/content/queries";
import type { Database } from "@/lib/supabase/types";

import { everyRow } from "./every-row";
import type { SetRow } from "./point-words";
import type { PicturedWord } from "./shown-word";

export type AnswerLanguage = Database["public"]["Enums"]["answer_language"];

/**
 * How many rows one request asks for. Not a claim about what the server
 * gives: one capped lower answers with fewer, and everyRow asks again from
 * there.
 */
const PAGE = 1000;

/** A lesson of a book, as the lesson picker lists it. */
export type LessonOption = {
  readonly id: string;
  readonly book: number;
  readonly bookTitle: string;
  readonly number: number;
};

export type LessonPoint = {
  readonly id: string;
  readonly number: number;
};

export type Question = {
  readonly id: string;
  readonly pointId: string;
  readonly position: number;
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: AnswerLanguage;
  readonly isPublished: boolean;
  /** The word whose picture the lesson shows with it (0028), or null. */
  readonly shownWordId: string | null;
};

export type QuestionsScreen = {
  /** Every lesson of every book, in book order. */
  readonly lessons: readonly LessonOption[];
  /** The lesson being shown, or null when the course has none yet. */
  readonly lesson: LessonOption | null;
  readonly points: readonly LessonPoint[];
  /** In point order, then in position order. */
  readonly questions: readonly Question[];
  /**
   * The whole vocabulary, not the lesson's: a question may use any word
   * presented up to its point, in this book or an earlier one. Each with its
   * approved picture, for the word a question shows.
   */
  readonly words: readonly PicturedWord[];
  readonly sets: readonly SetRow[];
};

/**
 * Everything the questions screen shows, in one call.
 *
 * One requireTeacher for all of it, for the reason readWordAttempts gives:
 * each one is a round trip to the auth server. The lesson asked for is named
 * by the numbers a person reads, book and lesson; one that does not exist
 * falls back to the first lesson, so a stale link still opens a screen.
 */
export async function loadQuestionsScreen(asked: {
  readonly book: number | null;
  readonly lesson: number | null;
}): Promise<QuestionsScreen> {
  const { supabase } = await requireTeacher();

  // The two the validator reads go through everyRow: a short answer there is
  // a word marked for no reason. Each is ordered by its key, so the pages of
  // one read never overlap.
  const [lessonRows, wordRows, sets] = await Promise.all([
    supabase
      .from("lessons_content")
      .select("id, number, books!inner(position, title)"),
    everyRow(async (from) => {
      const { data, count, error } = await supabase
        .from("vocabulary_items")
        .select(
          "id, term, representation, image_path, points!inner(number, books!inner(position))",
          { count: "exact" },
        )
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      return { rows: data, total: count ?? data.length };
    }),
    everyRow(async (from) => {
      const { data, count, error } = await supabase
        .from("contrast_set_items")
        .select("set_id, vocabulary_item_id, position", { count: "exact" })
        .order("vocabulary_item_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      return { rows: data, total: count ?? data.length };
    }),
  ]);
  if (lessonRows.error) throw new Error(lessonRows.error.message);

  // Sorted here and not in the query, for the reason listVocabularyImages
  // gives: the key is one level down, in the book.
  const lessons = lessonRows.data
    .map((row) => ({
      id: row.id,
      book: row.books.position,
      bookTitle: row.books.title,
      number: row.number,
    }))
    .sort((a, b) => a.book - b.book || a.number - b.number);

  const lesson =
    lessons.find(
      (option) => option.book === asked.book && option.number === asked.lesson,
    ) ??
    lessons.at(0) ??
    null;

  const words = wordRows.map((row) => ({
    id: row.id,
    term: row.term,
    place: { book: row.points.books.position, point: row.points.number },
    representation: row.representation,
    imageUrl: publicImageUrl(supabase, row.image_path),
  }));

  if (lesson === null) {
    return {
      lessons,
      lesson,
      points: [],
      questions: [],
      words,
      sets,
    };
  }

  const pointRows = await supabase
    .from("points")
    .select("id, number")
    .eq("lesson_content_id", lesson.id)
    .order("number");
  if (pointRows.error) throw new Error(pointRows.error.message);

  const questionRows = await supabase
    .from("questions")
    .select(
      "id, point_id, position, prompt, expected_answer, answer_language, is_published, shown_vocabulary_item_id",
    )
    .in(
      "point_id",
      pointRows.data.map((point) => point.id),
    )
    .order("position");
  if (questionRows.error) throw new Error(questionRows.error.message);

  return {
    lessons,
    lesson,
    points: pointRows.data,
    questions: questionRows.data.map((row) => ({
      id: row.id,
      pointId: row.point_id,
      position: row.position,
      prompt: row.prompt,
      expectedAnswer: row.expected_answer,
      answerLanguage: row.answer_language,
      isPublished: row.is_published,
      shownWordId: row.shown_vocabulary_item_id,
    })),
    words,
    sets,
  };
}
