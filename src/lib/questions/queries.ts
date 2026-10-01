import { requireTeacher } from "@/lib/content/queries";
import type { Database } from "@/lib/supabase/types";

import type { LessonWord, SetRow } from "./point-words";

export type AnswerLanguage = Database["public"]["Enums"]["answer_language"];

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
   * presented up to its point, in this book or an earlier one.
   */
  readonly words: readonly LessonWord[];
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

  const [lessonRows, wordRows, setRows] = await Promise.all([
    supabase
      .from("lessons_content")
      .select("id, number, books!inner(position, title)"),
    supabase
      .from("vocabulary_items")
      .select("id, term, points!inner(number, books!inner(position))"),
    supabase
      .from("contrast_set_items")
      .select("set_id, vocabulary_item_id, position"),
  ]);
  if (lessonRows.error) throw new Error(lessonRows.error.message);
  if (wordRows.error) throw new Error(wordRows.error.message);
  if (setRows.error) throw new Error(setRows.error.message);

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

  const words = wordRows.data.map((row) => ({
    id: row.id,
    term: row.term,
    place: { book: row.points.books.position, point: row.points.number },
  }));

  if (lesson === null) {
    return {
      lessons,
      lesson,
      points: [],
      questions: [],
      words,
      sets: setRows.data,
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
      "id, point_id, position, prompt, expected_answer, answer_language, is_published",
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
    })),
    words,
    sets: setRows.data,
  };
}
