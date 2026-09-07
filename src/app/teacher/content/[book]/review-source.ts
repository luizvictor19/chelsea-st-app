import type {
  StoredBlock,
  StoredPage,
} from "../../../../lib/content/batch-store.ts";
import type { PageState } from "../../../../lib/content/review-navigation.ts";
import type { BlockKind } from "../../../../lib/extraction/classify.ts";
import {
  isRefused,
  pointForBlock,
  reviewOrder,
  type ResolvedPage,
} from "../../../../lib/extraction/pipeline.ts";
import type {
  PageOpening,
  Placement,
} from "../../../../lib/extraction/reconcile.ts";
import type { Band, Bitmap } from "../../../../lib/extraction/types.ts";
import {
  asksForPoint,
  type PageQuestion,
} from "../../../../lib/content/point-question.ts";
import {
  startPlacements,
  type PointStart,
} from "../../../../lib/content/unread-points.ts";

/**
 * The batch as the review screen works on it.
 *
 * Two things become one shape here: a batch just read, which still holds the
 * page images, and the same batch read back from the browser's database, which
 * does not. The screen should not care which one it is looking at, except in
 * the single place where it cannot be anything but honest: a flagged table has
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

export type ReviewSourcePage = PageOpening & {
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
  /** Whether that lesson starts here, which the point above it is not in. */
  readonly opensLesson: boolean;
  readonly disputes: readonly {
    readonly y: number;
    readonly candidates: readonly number[];
  }[];
  readonly unsupported: "revision_exercise" | null;
  readonly refused: boolean;
  /**
   * Where the teacher said a point the margin reader missed begins.
   *
   * Empty on a batch just read: it is an answer, and nobody has been asked yet.
   * A restored batch brings back whatever was answered before the reload, which
   * is what keeps an answered page answered.
   */
  readonly pointStarts: readonly PointStart[];
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
    precedingPoint: page.precedingPoint,
    openingPoint: page.openingPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    opensLesson: page.opensLesson,
    disputes: page.disputes,
    unsupported: page.extraction.unsupported,
    refused: isRefused(page.extraction),
    // Nobody has been asked yet.
    pointStarts: [],
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
    precedingPoint: page.precedingPoint,
    openingPoint: page.openingPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    opensLesson: page.opensLesson,
    disputes: page.disputes,
    unsupported: page.unsupported,
    refused: page.refused,
    pointStarts: page.pointStarts,
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

/**
 * The page as it goes into the browser's database, images left behind.
 *
 * The draft's side of it arrives as one object rather than as a row of
 * positional arguments. There are four of them now and three are a list or a
 * flag, which is exactly the shape where swapping two costs nothing at the
 * compiler and everything at the teacher's next reload.
 */
export function toStored(
  page: ReviewSourcePage,
  draft: {
    readonly blocks: readonly StoredBlock[];
    readonly savedPoints: readonly number[];
    readonly changedSinceSaving: boolean;
    readonly pointStarts: readonly PointStart[];
  },
): StoredPage {
  return {
    id: page.id,
    fileName: page.fileName,
    uploadIndex: page.uploadIndex,
    points: page.points,
    // Kept so a restored spread can still split its blocks by height.
    placements: page.placements,
    inheritedPoint: page.inheritedPoint,
    precedingPoint: page.precedingPoint,
    openingPoint: page.openingPoint,
    duplicateOf: page.duplicateOf,
    lessonNumber: page.lessonNumber,
    opensLesson: page.opensLesson,
    disputes: page.disputes,
    unsupported: page.unsupported,
    refused: page.refused,
    pointStarts: draft.pointStarts,
    blocks: draft.blocks,
    savedPoints: draft.savedPoints,
    changedSinceSaving: draft.changedSinceSaving,
  };
}

/**
 * The point this page opens in, when something printed above its first number
 * is actually filed there.
 *
 * A page that carries numbers still writes outside them: what sits above its
 * first number was printed under the last number of the page before. Naming
 * that point matters twice over. The heading would otherwise say one point
 * while two are written, and the check for "this point already holds content"
 * would miss the one belonging to the page before and replace its work.
 */
function openingTarget(
  page: ReviewSourcePage,
  placements: readonly Placement[],
): readonly number[] {
  if (page.openingPoint === null || placements.length === 0) {
    return [];
  }
  const writesThere = page.blocks.some(
    (block) => pointForBlock(placements, block.top, page) === page.openingPoint,
  );
  return writesThere ? [page.openingPoint] : [];
}

/**
 * Every number the page files a block under.
 *
 * The answers to a point the margin reader missed are placements like any
 * other, and they are counted here: a page that carries only a 7 and was told
 * point 6 begins at its second block writes 5, 6 and 7, and a heading naming
 * only the 7 would be describing a different page than the one being written.
 */
function settledNumbers(
  page: ReviewSourcePage,
  starts: readonly PointStart[] = page.pointStarts,
): readonly number[] {
  const answered = startPlacements(starts);
  const placements = [...page.placements, ...answered].sort(
    (a, b) => a.y - b.y,
  );
  return [
    ...new Set([
      ...openingTarget(page, placements),
      ...page.points,
      ...answered.map((placement) => placement.number),
    ]),
  ].sort((a, b) => a - b);
}

/**
 * The points this page is the author of, which are the only ones it may replace.
 *
 * Narrower than targetsOf on purpose. A page writes to the point it opens in,
 * but it did not write that point, the page before did, so confirming this
 * one adds to it and never clears it. Replacing there would delete the previous
 * page's work on a point this one only contributed a panel to.
 */
export function authoredPoints(page: ReviewSourcePage): readonly number[] {
  if (page.points.length > 0) {
    return page.points;
  }
  return page.inheritedPoint === null ? [] : [page.inheritedPoint];
}

/** The points a page will be written to, before the teacher answers anything. */
export function targetsOf(page: ReviewSourcePage): readonly number[] {
  if (page.points.length > 0) {
    return settledNumbers(page);
  }
  return page.inheritedPoint === null ? [] : [page.inheritedPoint];
}

/**
 * Whether this page's lesson stops short of the point it opens in.
 *
 * Only when the page starts the lesson itself. Then the header is printed
 * between the point above and the page's own numbers, and the point above is on
 * the other side of it. A page that merely carried a lesson in from an earlier
 * page of the same upload has no boundary on it, and its lesson covers the
 * point it opens in exactly as it covers its own.
 *
 * A page carrying no number of its own is not this case at all: it opens in the
 * point it inherits, that point is the whole page, and the page's lesson is its
 * lesson. Written the other way round, this threw away the header for every
 * continuation page in an upload.
 *
 * And the boundary needs a page on the other side of it, which is why this
 * reads precedingPoint and not openingPoint. On the page carrying the book's
 * own first point the two differ: nothing precedes it, so the header at its top
 * has nothing above it and covers the point it opens in like any other. Read
 * off openingPoint, the first page of book 1 held its own point 1 back for a
 * lesson before lesson 1, and asked for a page that does not exist.
 */
function opensAfterItsPoint(
  page: ReviewSourcePage,
  pointNumber: number,
): boolean {
  return (
    page.opensLesson &&
    page.points.length > 0 &&
    page.precedingPoint !== null &&
    pointNumber === page.precedingPoint
  );
}

/**
 * The LESSON header of this page that may speak for one of its points.
 *
 * Null does not mean "no lesson". It means this page cannot answer, so the
 * lessons the book already holds are asked next. Reading the header across a
 * boundary filed the last point of one lesson under the next, and silently,
 * because a point carries no evidence of which lesson it should have had.
 */
export function headerFor(
  page: ReviewSourcePage,
  pointNumber: number,
): number | null {
  return opensAfterItsPoint(page, pointNumber) ? null : page.lessonNumber;
}

/**
 * Whether only the page before can say which lesson this point is in.
 *
 * The teacher's answer on this screen is about the lesson this page opens, so
 * it must not be spent on a point that is in the one before. When this is true
 * and the book does not already know the point, the page waits for the page
 * before to be confirmed rather than guessing. False whenever there is no page
 * before, which the screen relies on: it says "confirm the previous page" and
 * writes nothing until that happens.
 */
export function lessonIsThePageBefores(
  page: ReviewSourcePage,
  pointNumber: number,
): boolean {
  return opensAfterItsPoint(page, pointNumber);
}

/**
 * Whether this page is the teacher's to work on at all.
 *
 * A second scan, a kind the pipeline refuses, and an image that is not a page
 * of this book are all the same answer to every question the screen asks: no.
 * Written out at each place that asks, the three drifted apart, and a duplicate
 * ended up told "nothing of it will be written" and asked which point it was on
 * the same screen. `stateOf` says which of the three it is, because the rail
 * names them differently; everything else only needs this.
 */
export function isWritable(page: ReviewSourcePage): boolean {
  return (
    page.duplicateOf === null && page.unsupported === null && !page.refused
  );
}

/**
 * Whether a page opens already written, before the teacher touches anything.
 *
 * Written once and edited since is not written: the edit still has to reach the
 * database, and a restore that called it saved buried it a second time. Every
 * other question the screen asks about a restored page hangs off this one, so
 * it is here where it can be tested against a real round trip rather than
 * inline in the screen's initial state.
 */
export function isSavedOnOpening(page: ReviewSourcePage): boolean {
  return page.savedPoints.length > 0 && !page.changedSinceSaving;
}

/**
 * Whether the points this page writes may hold somebody else's work.
 *
 * The note it drives says that confirming will empty the point, including
 * whatever another page put there, and it is worth saying: two pages can write
 * to one point, and replacing is how the second one loses the first one's
 * panel.
 *
 * It is not worth saying about a page's own work. A page that has already
 * written these points in this batch knows it wrote them, and telling it that
 * the content might be somebody else's is both false and frightening, over
 * content the teacher put there five minutes ago. Restored batches are where
 * this bit: `savedPoints` comes back with the page and nothing was consulting
 * it.
 */
export function mayHoldAnotherPagesWork(page: ReviewSourcePage): boolean {
  return page.savedPoints.length === 0;
}

/**
 * Everything about a draft that decides what gets written.
 *
 * Structural on purpose: the screen's draft carries more than this, and the
 * rest of it, the error showing, the flag about a point already holding
 * content, is the screen talking to itself.
 */
export type WrittenShape = {
  readonly blocks: readonly {
    readonly kind: BlockKind;
    readonly content: string;
    readonly top: number;
  }[];
  readonly pointNumber: number | null;
  readonly continuation: boolean;
  readonly typedPoint: string;
  readonly typedLesson: string;
  readonly pointStarts: readonly PointStart[];
};

/**
 * Whether two drafts would write the same thing.
 *
 * Confirming has to know whether the teacher typed into the page while the
 * write was in flight, because calling a page saved when it has been edited
 * since buries that edit. It compared the two drafts by object identity, which
 * answers a different question: whether anything at all made a new object.
 *
 * Something does. The screen asks the database which points already hold
 * content, and when that answer lands it puts a flag on every draft, so a save
 * in flight came back to a draft it no longer recognised and called itself
 * unsaved. It was then kept as "written and edited since", and on the next open
 * the page was waiting again, the counter read zero written, and the question
 * it had already answered was put to it a second time.
 *
 * So the comparison is over what would be written and nothing else.
 */
export function writesTheSame(a: WrittenShape, b: WrittenShape): boolean {
  const sameBlocks =
    a.blocks.length === b.blocks.length &&
    a.blocks.every((block, at) => {
      const other = b.blocks[at];
      return (
        block.kind === other.kind &&
        block.content === other.content &&
        block.top === other.top
      );
    });
  const sameStarts =
    a.pointStarts.length === b.pointStarts.length &&
    a.pointStarts.every((start, at) => {
      const other = b.pointStarts[at];
      return start.number === other.number && start.top === other.top;
    });
  return (
    sameBlocks &&
    sameStarts &&
    a.pointNumber === b.pointNumber &&
    a.continuation === b.continuation &&
    a.typedPoint === b.typedPoint &&
    a.typedLesson === b.typedLesson
  );
}

/** The page's side of the point question, which does not change while typing. */
export function questionOf(page: ReviewSourcePage): PageQuestion {
  return {
    points: page.points,
    inheritedPoint: page.inheritedPoint,
    disputeCandidates: disputeCandidates(page),
  };
}

/**
 * Whether the screen puts the point question to the teacher.
 *
 * Three things in order, and the first is the one that was missing: a page
 * nobody may write is asked nothing, however little its margin said. Then a
 * page already written, which has had its answer. Only then the question
 * itself, which is about the page and never about what has been typed into it.
 */
export function asksThePoint(page: ReviewSourcePage, saved: boolean): boolean {
  return isWritable(page) && !saved && asksForPoint(questionOf(page));
}

/** The candidates the batch could not choose between, as one sorted list. */
export function disputeCandidates(page: ReviewSourcePage): readonly number[] {
  return [
    ...new Set(page.disputes.flatMap((dispute) => dispute.candidates)),
  ].sort((a, b) => a - b);
}

/** The page's title in the work column. */
/**
 * The numbers a page will actually be written to.
 *
 * Not `page.points`, which holds only what the batch settled by itself. A page
 * can carry one settled number and one the teacher answered, and the answer is
 * written too; reading the heading off `page.points` named only one of them and
 * then, for a spread, named the wrong one.
 */
export function writtenNumbers(
  page: ReviewSourcePage,
  target: number | null,
  continuation: boolean,
  starts: readonly PointStart[] = page.pointStarts,
): readonly number[] {
  if (continuation) {
    return target === null ? [] : [target];
  }
  const settled = settledNumbers(page, starts);
  if (target === null || settled.includes(target)) {
    return settled;
  }
  return [...settled, target].sort((a, b) => a - b);
}

export function headingFor(
  page: ReviewSourcePage,
  target: number | null,
  continuation: boolean,
  starts: readonly PointStart[] = page.pointStarts,
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
  const numbers = writtenNumbers(page, target, continuation, starts);
  if (numbers.length > 1) {
    return `Pontos ${listOf(numbers)}`;
  }
  return `Ponto ${numbers[0] ?? target}`;
}

/**
 * "117 e 118", "5, 6 e 7".
 *
 * A page could only ever write two points until it could be told where a point
 * the reader missed begins; now it can write three, and "5 e 6 e 7" is not
 * Portuguese.
 */
function listOf(numbers: readonly number[]): string {
  if (numbers.length < 2) {
    return String(numbers[0] ?? "");
  }
  return `${numbers.slice(0, -1).join(", ")} e ${numbers[numbers.length - 1]}`;
}

/** The same, short enough for the rail. */
function shortPoints(
  page: ReviewSourcePage,
  target: number | null,
  continuation: boolean,
  starts: readonly PointStart[],
): string {
  if (target === null) {
    return "sem número";
  }
  if (continuation) {
    return `continuação do ponto ${target}`;
  }
  // The same numbers the heading names, so the rail and the page agree.
  const numbers = writtenNumbers(page, target, continuation, starts);
  if (numbers.length > 1) {
    return listOf(numbers);
  }
  return `ponto ${numbers[0] ?? target}`;
}

/** What the rail says a page turned out to be. */
export function summaryFor({
  page,
  state,
  target,
  continuation,
  flagged,
  starts = page.pointStarts,
  changedSinceSaving = false,
  alreadyInDatabase = false,
}: {
  page: ReviewSourcePage;
  state: PageState;
  target: number | null;
  continuation: boolean;
  /** Blocks the extraction is unsure about, which is what to look at first. */
  flagged: number;
  /** Where the teacher placed a point the margin reader missed, if anywhere. */
  starts?: readonly PointStart[];
  /**
   * The page was written and then edited, so the database is behind the screen.
   *
   * It reads as waiting, because it is: what is on the screen has not been
   * written. Saying only "gravado" would be the false half of the truth, and it
   * is the half that loses the edit.
   */
  changedSinceSaving?: boolean;
  /**
   * The point already holds content from a round before this one.
   *
   * Said on the rail because it changes what the button does: confirming
   * replaces what is there. It used to be said only inside the page, so
   * finding it meant clicking every page to look.
   */
  alreadyInDatabase?: boolean;
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
      return `${shortPoints(page, target, continuation, starts)} · gravado`;
    default: {
      const short = shortPoints(page, target, continuation, starts);
      if (changedSinceSaving) {
        return `${short} · alteração não gravada`;
      }
      if (alreadyInDatabase) {
        return `${short} · já gravado`;
      }
      if (flagged === 0) {
        return short;
      }
      // Not "tabela". The height flag was the only one for a while, so the rail
      // could name the block by the reason it was flagged and be right. It is
      // not the only one any more: a vocabulary panel or an explanation holding
      // a character the book cannot print is flagged too, and calling that a
      // table sends the teacher looking for a table the page does not have.
      return `${short} · ${flagged} ${flagged === 1 ? "bloco a conferir" : "blocos a conferir"}`;
    }
  }
}
