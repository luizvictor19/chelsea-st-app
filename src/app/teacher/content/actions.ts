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
  readonly pointNumber: number;
  readonly lessonNumber: number | null;
  readonly blocks: readonly ConfirmedBlock[];
  /** Words to introduce at this point, already folded by the caller. */
  readonly vocabulary: readonly string[];
};

/** Sets the book's ceiling and creates its empty points. */
export async function configureBook(
  bookId: string,
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
  revalidatePath("/teacher/content");
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

  const { error: clearError } = await supabase
    .from("blocks")
    .delete()
    .eq("point_id", row.id);
  if (clearError) {
    return { status: "error", message: clearError.message };
  }

  if (point.blocks.length > 0) {
    const { error: insertError } = await supabase.from("blocks").insert(
      point.blocks.map((block, position) => ({
        point_id: row.id,
        position,
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
    const { data: lesson } = await supabase
      .from("lessons_content")
      .select("id")
      .eq("book_id", point.bookId)
      .eq("number", point.lessonNumber)
      .maybeSingle();
    if (lesson !== null) {
      await supabase
        .from("points")
        .update({ lesson_content_id: lesson.id })
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

  revalidatePath("/teacher/content");
  return { status: "ok" };
}
