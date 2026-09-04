"use server";

import { revalidatePath } from "next/cache";

import type { BlockKind } from "@/lib/extraction/classify";
import { createClient } from "@/lib/supabase/server";

export type ActionResult =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly message: string };

/** One block as the teacher confirmed it, after any edit on the review screen. */
export type ConfirmedBlock = {
  readonly kind: BlockKind;
  readonly content: string;
  readonly needsReview: boolean;
};

export type ConfirmedPoint = {
  readonly bookId: string;
  /** The book's position, which is also its path segment. */
  readonly bookPosition: number;
  readonly pointNumber: number;
  readonly lessonNumber: number | null;
  readonly blocks: readonly ConfirmedBlock[];
  /** Words to introduce at this point, already folded by the caller. */
  readonly vocabulary: readonly string[];
  /**
   * "replace" for the page that carries the number, which is what makes a
   * re-upload idempotent. "append" for a continuation page, whose blocks belong
   * to the same point and must not wipe what the first page put there.
   */
  readonly mode: "replace" | "append";
};

/**
 * Refreshes the screens a write changes.
 *
 * The index, for the bars, and the book itself, because that is where the
 * ceiling and the list of points live. Revalidating only the index left the
 * book page holding the value it was rendered with, so an upload kept being
 * refused for want of a ceiling that had in fact just been saved.
 */
function refreshBookScreens(bookPosition: number): void {
  revalidatePath("/teacher/content");
  revalidatePath(`/teacher/content/${bookPosition}`);
}

/** Sets the book's ceiling and creates its empty points. */
export async function configureBook(
  bookId: string,
  bookPosition: number,
  lastPoint: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("materialize_points", {
    p_book_id: bookId,
    p_last_point: lastPoint,
  });
  if (error) {
    return { status: "error", message: error.message };
  }
  refreshBookScreens(bookPosition);
  return { status: "ok" };
}

/**
 * Writes one reviewed point.
 *
 * Nothing reaches the database before this call: the extraction lives in the
 * teacher's browser until confirmed, and the raw OCR text is never stored, only
 * what came back from the review screen.
 *
 * The point's blocks are deleted before the new ones are inserted. That is what
 * makes re-uploading a page idempotent: the unique index on (point_id, position)
 * refuses a duplicate, it does not replace one, so the replacing has to happen
 * here.
 */
export async function confirmPoint(
  point: ConfirmedPoint,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: row, error: lookupError } = await supabase
    .from("points")
    .select("id")
    .eq("book_id", point.bookId)
    .eq("number", point.pointNumber)
    .maybeSingle();

  if (lookupError) {
    return { status: "error", message: lookupError.message };
  }
  if (row === null) {
    return {
      status: "error",
      message: `O ponto ${point.pointNumber} não existe neste livro. Confira o último ponto do livro.`,
    };
  }

  let offset = 0;
  if (point.mode === "replace") {
    const { error: clearError } = await supabase
      .from("blocks")
      .delete()
      .eq("point_id", row.id);
    if (clearError) {
      return { status: "error", message: clearError.message };
    }
  } else {
    const { data: last } = await supabase
      .from("blocks")
      .select("position")
      .eq("point_id", row.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    offset = last === null ? 0 : last.position + 1;
  }

  if (point.blocks.length > 0) {
    const { error: insertError } = await supabase.from("blocks").insert(
      point.blocks.map((block, position) => ({
        point_id: row.id,
        position: offset + position,
        kind: block.kind,
        content: block.content,
        needs_review: block.needsReview,
      })),
    );
    if (insertError) {
      return { status: "error", message: insertError.message };
    }
  }

  if (point.lessonNumber !== null) {
    // The lesson is created the first time one of its points is confirmed, and
    // its range widens as the rest arrive. Only linking, as this did before,
    // left lessons_content permanently empty: nothing else creates a lesson.
    const { data: existing } = await supabase
      .from("lessons_content")
      .select("id, first_point, last_point")
      .eq("book_id", point.bookId)
      .eq("number", point.lessonNumber)
      .maybeSingle();

    let lessonId = existing?.id ?? null;
    if (existing === null) {
      const { data: created, error: lessonError } = await supabase
        .from("lessons_content")
        .insert({
          book_id: point.bookId,
          number: point.lessonNumber,
          first_point: point.pointNumber,
          last_point: point.pointNumber,
        })
        .select("id")
        .maybeSingle();
      if (lessonError) {
        return { status: "error", message: lessonError.message };
      }
      lessonId = created?.id ?? null;
    } else if (
      point.pointNumber < existing.first_point ||
      point.pointNumber > existing.last_point
    ) {
      await supabase
        .from("lessons_content")
        .update({
          first_point: Math.min(existing.first_point, point.pointNumber),
          last_point: Math.max(existing.last_point, point.pointNumber),
        })
        .eq("id", existing.id);
    }

    if (lessonId !== null) {
      await supabase
        .from("points")
        .update({ lesson_content_id: lessonId })
        .eq("id", row.id);
    }
  }

  // A word belongs to the first point that introduces it, so an existing row is
  // left alone rather than moved to whichever page was uploaded last.
  for (const term of point.vocabulary) {
    const { data: existing } = await supabase
      .from("vocabulary_items")
      .select("id")
      .ilike("term", term)
      .maybeSingle();
    if (existing === null) {
      await supabase
        .from("vocabulary_items")
        .insert({ term, first_point_id: row.id });
    }
  }

  const { error: fillError } = await supabase
    .from("points")
    .update({ filled_at: new Date().toISOString() })
    .eq("id", row.id);
  if (fillError) {
    return { status: "error", message: fillError.message };
  }

  refreshBookScreens(point.bookPosition);
  return { status: "ok" };
}
