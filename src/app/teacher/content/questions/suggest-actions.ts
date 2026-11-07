"use server";

import { unstable_rethrow } from "next/navigation";

import { requireContentWriter } from "@/lib/content/queries";
import { ACTION_BEAT_MS, withHeartbeat, type Heartbeat } from "@/lib/heartbeat";
import { everyRow } from "@/lib/questions/every-row";
import { approvedPicture } from "@/lib/questions/shown-word";
import {
  SUGGEST_QUESTIONS_MODEL,
  SUGGEST_QUESTIONS_SCHEMA,
} from "@/lib/questions/suggest-questions";
import { createClaudeProvider } from "@/lib/text/claude";

import { LESSON_CALL } from "../images/suggestion-call";
import {
  QUESTIONS_WORDING,
  proposeQuestions,
  type BookWord,
  type PointInputs,
  type SuggestQuestionsResult,
} from "./suggest-flow";

/** As in queries.ts: a page of rows, read until the total. */
const PAGE = 1000;

type Client = Awaited<ReturnType<typeof requireContentWriter>>["supabase"];

/**
 * What the point's prompt needs, read as the questions screen reads it:
 * every common word of the point's book with its point, class, kind, picture
 * (approvedPicture, the screen's rule) and the subject of the picture; the
 * contrast sets; the scenes in use with a picture; every question of the
 * book, for the pending words. Null when the point is not there.
 */
async function pointInputs(
  supabase: Client,
  pointId: string,
): Promise<PointInputs | null> {
  const { data: point, error } = await supabase
    .from("points")
    .select("number, book_id, books!inner(position)")
    .eq("id", pointId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (point === null) return null;

  const [rows, sets, scenes, questions] = await Promise.all([
    everyRow(async (from) => {
      const {
        data,
        count,
        error: e,
      } = await supabase
        .from("vocabulary_items")
        .select(
          "id, term, word_class, representation, image_path, image_subject, points!inner(number, book_id)",
          { count: "exact" },
        )
        .eq("points.book_id", point.book_id)
        .is("organization_id", null)
        .order("id")
        .range(from, from + PAGE - 1);
      if (e) throw new Error(e.message);
      return { rows: data, total: count ?? data.length };
    }),
    everyRow(async (from) => {
      const {
        data,
        count,
        error: e,
      } = await supabase
        .from("contrast_set_items")
        .select("set_id, vocabulary_item_id", { count: "exact" })
        .order("vocabulary_item_id")
        .range(from, from + PAGE - 1);
      if (e) throw new Error(e.message);
      return { rows: data, total: count ?? data.length };
    }),
    supabase
      .from("scenes")
      .select("id, description, image_path")
      .is("organization_id", null)
      .is("archived_at", null)
      .not("image_path", "is", null),
    everyRow(async (from) => {
      const {
        data,
        count,
        error: e,
      } = await supabase
        .from("questions")
        .select(
          "id, prompt, expected_answer, answer_language, points!inner(number, book_id)",
          { count: "exact" },
        )
        .eq("points.book_id", point.book_id)
        .order("id")
        .range(from, from + PAGE - 1);
      if (e) throw new Error(e.message);
      return { rows: data, total: count ?? data.length };
    }),
  ]);
  if (scenes.error) throw new Error(scenes.error.message);

  const setOf = new Map(
    sets.map((row) => [row.vocabulary_item_id, row.set_id]),
  );
  const words = rows.map((row): BookWord => ({
    id: row.id,
    point: row.points.number,
    term: row.term,
    class: row.word_class,
    kind: row.representation,
    picture:
      approvedPicture({
        representation: row.representation,
        imageUrl: row.image_path,
      }) !== null,
    subject: row.image_subject,
    set: setOf.get(row.id) ?? null,
  }));
  return {
    book: point.books.position,
    point: point.number,
    words,
    scenes: scenes.data.map((scene) => ({
      id: scene.id,
      description: scene.description,
    })),
    questions: questions.map((row) => ({
      point: row.points.number,
      prompt: row.prompt,
      expectedAnswer: row.expected_answer,
      answerLanguage: row.answer_language,
    })),
  };
}

async function suggest(
  pointId: string,
  count: number,
): Promise<SuggestQuestionsResult> {
  try {
    const { supabase } = await requireContentWriter();
    return await proposeQuestions(
      {
        canWrite: async () => {
          const { data, error } = await supabase.rpc("can_write_content", {
            // null is "common content" in the function (0029), the only
            // content there is since 0043; the generated type says string
            // because the generator never marks an argument nullable.
            p_organization: null as unknown as string,
          });
          if (error) throw new Error(error.message);
          return data === true;
        },
        inputs: () => pointInputs(supabase, pointId),
        provider: () =>
          createClaudeProvider(
            SUGGEST_QUESTIONS_MODEL,
            SUGGEST_QUESTIONS_SCHEMA,
            LESSON_CALL,
          ),
        log: (line) => console.log(JSON.stringify({ pointId, ...line })),
      },
      count,
    );
  } catch (cause) {
    // requireContentWriter redirects an expired session to /login by throwing.
    unstable_rethrow(cause);
    console.log(
      JSON.stringify({
        event: "suggest_questions",
        pointId,
        outcome: "threw",
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    // No cause on the answer: the screen reads one as a lost response.
    return { ok: false, error: QUESTIONS_WORDING.failed };
  }
}

/**
 * "Sugerir perguntas" for one point (#230), streamed with a heartbeat so the
 * connection is never quiet for more than ACTION_BEAT_MS while the model
 * thinks: 6.6 s median and 10.8 s worst, measured in #83. Writes nothing,
 * so asking again after a lost answer is safe (askTwiceIfLost on the
 * screen, #231).
 */
export async function suggestQuestions(
  pointId: string,
  count: number,
): Promise<AsyncGenerator<Heartbeat<SuggestQuestionsResult>>> {
  return withHeartbeat(suggest(pointId, count), ACTION_BEAT_MS);
}
