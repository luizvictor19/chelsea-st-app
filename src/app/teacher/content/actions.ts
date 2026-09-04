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
   * The upload these blocks came from.
   *
   * A file name, not an identity. It holds while the same page arrives called
   * the same thing, and stops holding the moment a page is photographed again
   * and saved under another name: the writer looks new, so its blocks are added
   * beside the old ones instead of replacing them. Real page identity is what
   * the duplicate merge works out inside a batch, from the numbers read and the
   * panels found, and that knowledge does not survive the upload.
   *
   * Which is why the stronger scope below exists, and why it is only ever
   * reached by someone deciding it.
   */
  readonly sourcePage: string;
  /**
   * Empty the point before writing, rather than only this page's rows.
   *
   * For when the teacher was shown that the point already holds content and
   * said to replace it. A person saying "replace this" may be trusted further
   * than a file name may.
   */
  readonly replaceWholePoint: boolean;
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

/** Records the book's range and creates its empty points. */
export async function configureBook(
  bookId: string,
  bookPosition: number,
  firstPoint: number,
  lastPoint: number,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("materialize_points", {
    p_book_id: bookId,
    p_first_point: firstPoint,
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

  // Normally only this page's rows go: another page's contribution to the same
  // point is not ours to remove. When the teacher asked to replace a point that
  // was already filled, everything goes, because a file name cannot be trusted
  // to recognise a page that was photographed twice.
  const clearing = supabase.from("blocks").delete().eq("point_id", row.id);
  const { error: clearError } = point.replaceWholePoint
    ? await clearing
    : await clearing.eq("source_page", point.sourcePage);
  if (clearError) {
    return { status: "error", message: clearError.message };
  }

  // Positions continue after whatever is left, so the unique index holds and
  // the order on screen is the order on the page.
  const { data: last } = await supabase
    .from("blocks")
    .select("position")
    .eq("point_id", row.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const offset = last === null ? 0 : last.position + 1;

  if (point.blocks.length > 0) {
    const { error: insertError } = await supabase.from("blocks").insert(
      point.blocks.map((block, position) => ({
        point_id: row.id,
        position: offset + position,
        kind: block.kind,
        content: block.content,
        needs_review: block.needsReview,
        source_page: point.sourcePage,
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

/**
 * Which of these points already hold content.
 *
 * The review screen asks before it draws. Without this the batch lives only in
 * the browser's memory, so a reload showed everything as ungraved and the
 * teacher had no way to tell what had already gone in. Knowing where you
 * stopped is most of what this product is for.
 */
export async function filledPoints(
  bookId: string,
  numbers: readonly number[],
): Promise<readonly number[]> {
  if (numbers.length === 0) {
    return [];
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("points")
    .select("number")
    .eq("book_id", bookId)
    .in("number", [...numbers])
    .not("filled_at", "is", null);
  return (data ?? []).map((row) => row.number);
}
