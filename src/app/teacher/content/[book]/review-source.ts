import type { StoredBlock, StoredPage } from "@/lib/content/batch-store";
import type { PageState } from "@/lib/content/review-navigation";
import type { BlockKind } from "@/lib/extraction/classify";
import {
  isRefused,
  reviewOrder,
  type ResolvedPage,
} from "@/lib/extraction/pipeline";
import type { Placement } from "@/lib/extraction/reconcile";
import type { Band, Bitmap } from "@/lib/extraction/types";

/**
 * The batch as the review screen works on it.
 *
 * Two things become one shape here: a batch just read, which still holds the
 * page images, and the same batch read back from the browser's database, which
 * does not. The screen should not care which one it is looking at, except in
 * the single place where it cannot be anything but honest — a flagged table has
 * no crop beside it once the pages are gone.
 */
export type ReviewCrop = {
  readonly page: Bitmap;
  readonly band: Band;
};

export type ReviewBlock = {
  readonly kind: BlockKind;
  readonly content: string;
  readonly needsReview: boolean;
  /** The strip of the page this came from, while the page is still in memory. */
  readonly crop: ReviewCrop | null;
  /** Where it sat on the page, which is what splits a spread's two points. */
  readonly top: number;
};

export type ReviewSourcePage = {
  /**
   * The page's identity in this batch, unique per uploaded file.
   *
   * Not the file name: two files dropped in together may carry the same name,
   * and a draft keyed by the name would be one draft for both.
   */
  readonly id: string;
  /** The file this page was read from, which is what the database records. */
  readonly fileName: string;
  readonly uploadIndex: number;
  readonly points: readonly number[];
  readonly placements: readonly Placement[];
  readonly inheritedPoint: number | null;
  readonly duplicateOf: string | null;
  readonly lessonNumber: number | null;
  readonly disputes: readonly {
    readonly y: number;
    readonly candidates: readonly number[];
  }[];
  readonly unsupported: "revision_exercise" | null;
  readonly refused: boolean;
  readonly blocks: readonly ReviewBlock[];
  /** Points already written from this page, so a resumed batch knows. */
  readonly savedPoints: readonly number[];
  /** Written, then edited: the blocks here are ahead of the database. */
  readonly changedSinceSaving: boolean;
  /** False for a restored batch: the images were deliberately not stored. */
  readonly hasImage: boolean;
};

/**
 * A page of a batch just read, with its image still at hand.
 *
 * The file name is passed in rather than read off the extraction: the
 * extraction is keyed by an identity the upload made unique, and the name is
 * only what the file happened to be called.
 */
export function fromResolved(
  page: ResolvedPage,
  fileName: string,
): ReviewSourcePage {
  const image = page.extraction.page;
  return {
    id: page.extraction.id,
    fileName,
    uploadIndex: page.extraction.uploadIndex,
    points: page.points,
    placements: page.placements,
    inheritedPoint: page.inheritedPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    disputes: page.disputes,
    unsupported: page.extraction.unsupported,
    refused: isRefused(page.extraction),
    blocks: reviewOrder(page.extraction.blocks).map((block) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
      crop: { page: image, band: block.band },
      top: block.band.top,
    })),
    savedPoints: [],
    changedSinceSaving: false,
    hasImage: true,
  };
}

/**
 * A page read back from the browser's database.
 *
 * The heights come back with it: each number's placement and each block's top
 * are stored, so a restored spread splits its blocks by where they were printed
 * exactly as the batch that read them did. What does not come back is the page
 * image, which is deliberately never stored, so a flagged table is shown
 * without the crop beside it and the work column says so.
 */
export function fromStored(page: StoredPage): ReviewSourcePage {
  return {
    id: page.id,
    fileName: page.fileName,
    uploadIndex: page.uploadIndex,
    points: page.points,
    placements: page.placements,
    inheritedPoint: page.inheritedPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    disputes: page.disputes,
    unsupported: page.unsupported,
    refused: page.refused,
    blocks: page.blocks.map((block) => ({
      kind: block.kind,
      content: block.content,
      needsReview: block.needsReview,
      crop: null,
      top: block.top,
    })),
    savedPoints: page.savedPoints,
    changedSinceSaving: page.changedSinceSaving,
    hasImage: false,
  };
}

/** The page as it goes into the browser's database, images left behind. */
export function toStored(
  page: ReviewSourcePage,
  blocks: readonly StoredBlock[],
  savedPoints: readonly number[],
  changedSinceSaving: boolean,
): StoredPage {
  return {
    id: page.id,
    fileName: page.fileName,
    uploadIndex: page.uploadIndex,
    points: page.points,
    // Kept so a restored spread can still split its blocks by height.
    placements: page.placements,
    inheritedPoint: page.inheritedPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    disputes: page.disputes,
    unsupported: page.unsupported,
    refused: page.refused,
    blocks,
    savedPoints,
    changedSinceSaving,
  };
}

/** The points a page will be written to, before the teacher answers anything. */
export function targetsOf(page: ReviewSourcePage): readonly number[] {
  if (page.points.length > 0) {
    return page.points;
  }
  return page.inheritedPoint === null ? [] : [page.inheritedPoint];
}

/** The candidates the batch could not choose between, as one sorted list. */
export function disputeCandidates(page: ReviewSourcePage): readonly number[] {
  return [
    ...new Set(page.disputes.flatMap((dispute) => dispute.candidates)),
  ].sort((a, b) => a - b);
}

/** The page's title in the work column. */
export function headingFor(
  page: ReviewSourcePage,
  target: number | null,
  continuation: boolean,
): string {
  if (page.unsupported !== null) {
    return "Exercício de revisão, ainda não suportado";
  }
  if (page.refused) {
    return "Não é uma página deste livro";
  }
  if (page.duplicateOf !== null) {
    return "Reenvio da mesma página";
  }
  if (target === null) {
    // Unresolved is a state of its own, not a number missing from beside a
    // lesson that is known: naming the lesson here reads as a defect.
    return "Número do ponto não resolvido";
  }
  if (continuation) {
    return `Continuação do ponto ${target}`;
  }
  if (page.points.length > 1) {
    return `Pontos ${page.points.join(" e ")}`;
  }
  return `Ponto ${target}`;
}

/** The same, short enough for the rail. */
function shortPoints(
  page: ReviewSourcePage,
  target: number | null,
  continuation: boolean,
): string {
  if (target === null) {
    return "sem número";
  }
  if (continuation) {
    return `continuação do ponto ${target}`;
  }
  if (page.points.length > 1) {
    return page.points.join(" e ");
  }
  return `ponto ${target}`;
}

/** What the rail says a page turned out to be. */
export function summaryFor({
  page,
  state,
  target,
  continuation,
  flagged,
  changedSinceSaving = false,
}: {
  page: ReviewSourcePage;
  state: PageState;
  target: number | null;
  continuation: boolean;
  /** Blocks the extraction is unsure about, which is what to look at first. */
  flagged: number;
  /**
   * The page was written and then edited, so the database is behind the screen.
   *
   * It reads as waiting, because it is: what is on the screen has not been
   * written. Saying only "gravado" would be the false half of the truth, and it
   * is the half that loses the edit.
   */
  changedSinceSaving?: boolean;
}): string {
  switch (state) {
    case "duplicate":
      return `mesma página que ${page.duplicateOf}`;
    case "unsupported":
      return "não suportada";
    case "refused":
      return "recusada";
    case "needs-answer":
      return "precisa do ponto";
    case "saved":
      return `${shortPoints(page, target, continuation)} · gravado`;
    default: {
      const short = shortPoints(page, target, continuation);
      if (changedSinceSaving) {
        return `${short} · alteração não gravada`;
      }
      if (flagged === 0) {
        return short;
      }
      return `${short} · ${flagged} ${flagged === 1 ? "tabela" : "tabelas"}`;
    }
  }
}
