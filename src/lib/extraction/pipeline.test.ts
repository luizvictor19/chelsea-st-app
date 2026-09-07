import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  extractPage,
  isRefused,
  pointForBlock,
  unplacedBlocks,
  resolveBatch,
  reviewOrder,
} from "./pipeline.ts";
import {
  blankPage,
  fillRect,
  INK,
  inkLine,
  shadedBox,
  toBitmap,
  type MutablePage,
} from "./testing/synthetic-page.ts";
import type { Bitmap, OcrReader, OcrWord } from "./types.ts";

/**
 * A range wide enough to hold the numbers these cases invent, not a book's.
 *
 * Deliberately open at the floor: several cases below place a stray small
 * number on a page to prove the sequence rule removes it, and a real book's
 * floor would remove it first and prove nothing. Where a case is about a book's
 * own range it says so on the spot. See scripts/smoke-reconciliation.ts for
 * what a fixed range that pretends to be a book's costs.
 */
const RANGE = { first: 1, last: 128 };

function word(text: string, x: number, y: number, agreement = 1): OcrWord {
  void agreement;
  return {
    text,
    x,
    y,
    width: text.length * 9,
    height: 12,
    confidence: 50,
    symbols: [],
  };
}

/**
 * Stands in for the engine, answering by the shape of what it is handed.
 *
 * The pipeline reads three kinds of image: a tall narrow margin strip, the page
 * itself, and a panel crop. They are told apart by size here, which keeps the
 * pixel stages under test and the engine out of it.
 */
function scriptedReader(script: {
  margin?: readonly OcrWord[];
  page?: readonly OcrWord[];
  box?: readonly OcrWord[];
}): OcrReader {
  return {
    async read(image: Bitmap, options) {
      if (options?.allowedCharacters !== undefined) {
        return script.margin ?? [];
      }
      const isPage = image.width >= 1000;
      return (isPage ? script.page : script.box) ?? [];
    },
  };
}

/** A page with one vocabulary panel and one justified paragraph. */
function lessonPage(width: number): Bitmap {
  const height = Math.round((width * 1500) / 1100);
  const page: MutablePage = blankPage(width, height);
  const left = Math.round(width * 0.11);
  const right = Math.round(width * 0.89);
  const scale = width / 1100;
  shadedBox(page, left, Math.round(200 * scale), Math.round(60 * scale));
  for (const top of [400, 430, 460]) {
    inkLine(page, {
      left,
      right,
      top: Math.round(top * scale),
      height: Math.max(2, Math.round(10 * scale)),
      wordWidth: Math.max(4, Math.round(30 * scale)),
      wordGap: Math.max(2, Math.round(8 * scale)),
    });
  }
  return toBitmap(page);
}

describe("criterion 4: the same page twice does not duplicate anything", () => {
  test("two scans at different widths reduce to the same blocks", async () => {
    // The teacher's zoom is not part of the page. Both scans normalise to the
    // reference width before anything is measured.
    const reader = scriptedReader({
      margin: [word("57", 10, 300)],
      page: [word("we", 120, 400), word("use", 200, 400)],
      box: [word("see", 10, 10), word("such", 60, 10)],
    });

    const small = await extractPage("p057-519", 0, lessonPage(519), reader);
    const large = await extractPage("p057-534", 1, lessonPage(534), reader);

    // Structure, not content: the stubbed engine answers in fixed coordinates
    // that do not follow the page, so which line a word lands on is an artifact
    // of the stub. What criterion 4 is about is that neither scan produces an
    // extra block.
    assert.deepEqual(
      small.blocks.map((block) => [block.kind, block.needsReview]),
      large.blocks.map((block) => [block.kind, block.needsReview]),
      "the two scans must yield the same blocks",
    );
    assert.equal(small.boxCount, large.boxCount);
  });

  test("the batch keeps one of them and names the other a re-upload", async () => {
    const reader = scriptedReader({
      margin: [word("57", 10, 300)],
      page: [word("LESSON", 100, 40), word("10", 200, 40)],
      box: [word("see", 10, 10)],
    });
    const pages = [
      await extractPage("p057-519", 0, lessonPage(519), reader),
      await extractPage("p057-534", 1, lessonPage(534), reader),
    ];

    const resolved = resolveBatch(pages, RANGE);
    const duplicates = resolved.filter((page) => page.duplicateOf !== null);
    assert.equal(duplicates.length, 1, "exactly one is a re-upload");
    assert.equal(
      resolved.filter((page) => page.points.length > 0).length,
      1,
      "and only one of them holds the point",
    );
  });
});

describe("criterion 9: a page with no number, and an image that is not a page", () => {
  test("a page with no margin number inherits the current point", async () => {
    const numbered = scriptedReader({
      margin: [word("60", 10, 300)],
      page: [word("text", 120, 400)],
      box: [word("word", 10, 10)],
    });
    const unnumbered = scriptedReader({
      margin: [],
      page: [word("text", 120, 400)],
      box: [word("word", 10, 10)],
    });

    const pages = [
      await extractPage("p060", 0, lessonPage(1100), numbered),
      await extractPage("continuation", 1, lessonPage(1100), unnumbered),
    ];
    const resolved = resolveBatch(pages, RANGE);
    const continuation = resolved.find(
      (page) => page.extraction.id === "continuation",
    );
    assert.deepEqual(continuation?.points, []);
    assert.equal(continuation?.inheritedPoint, 60);
    assert.equal(isRefused(continuation!.extraction), false);
  });

  test("an image with no number, no panel, no header and no dictation is refused", async () => {
    const blank = toBitmap(blankPage(1100, 1500));
    const reader = scriptedReader({ margin: [], page: [], box: [] });
    const page = await extractPage("photo.jpg", 0, blank, reader);

    assert.equal(isRefused(page), true);
    assert.deepEqual(page.blocks, [], "nothing is extracted from it");
  });

  test("a dictation page with no number is not refused", async () => {
    const page: MutablePage = blankPage(1100, 1500);
    for (const top of [400, 430]) {
      inkLine(page, { left: 121, right: 980, top });
    }
    const reader = scriptedReader({
      margin: [],
      page: [
        word("the", 121, 400),
        word("man", 200, 400),
        word("/", 260, 400),
        word("who", 300, 400),
        word("/", 360, 400),
      ],
      box: [],
    });
    const extracted = await extractPage("dictation", 0, toBitmap(page), reader);
    assert.equal(isRefused(extracted), false);
  });
});

describe("criterion 8: a dictation page with nothing else on it", () => {
  test("a page that is only a slash paragraph still produces the dictation", () => {
    // The case the real pages break on. With no shaded panel anywhere, box_left
    // falls back to a tenth of the width, and the text sits to the left of that,
    // so the justification test rejects every line. The dictation must not
    // depend on that test: measured on the book, three of the eight dictation
    // pages look exactly like this.
    const page: MutablePage = blankPage(1100, 900);
    const textLeft = 89;
    for (const top of [200, 240, 280, 320]) {
      inkLine(page, { left: textLeft, right: 900, top });
    }

    const spoken = "the man / who lives / next door / is a doctor";
    const words = spoken
      .split(" ")
      .map((text, index) => word(text, textLeft + index * 60, 200));
    const reader = scriptedReader({ margin: [], page: words, box: [] });

    return extractPage("p061", 0, toBitmap(page), reader).then((extracted) => {
      assert.equal(extracted.isDictation, true, "slash density says dictation");
      const dictation = extracted.blocks.filter(
        (block) => block.kind === "dictation",
      );
      assert.equal(dictation.length, 1, "exactly one dictation block");
      assert.ok(
        dictation[0].content.includes("/"),
        "the slashes are the reading pauses and are kept",
      );
      assert.equal(isRefused(extracted), false);
    });
  });
});

describe("criterion 7: prose on a page with no shaded panel", () => {
  test("a justified paragraph is found where there is no panel to measure from", () => {
    // The text column starts in the same place with a panel or without one, but
    // box_left only knows about the panel. On a page with none it fell back to a
    // tenth of the width, twenty-one pixels out, and rejected every line: the
    // page carrying the present continuous explanation came out empty.
    const page: MutablePage = blankPage(1100, 900);
    const textLeft = 89;
    // Line spacing close enough that the three read as one paragraph, as they
    // do on the page: a blank wider than a line is what separates paragraphs.
    for (const top of [200, 215, 230]) {
      inkLine(page, { left: textLeft, right: 980, top });
    }

    const words = ["We", "use", "the", "present", "continuous"].map(
      (text, index) => word(text, textLeft + index * 70, 200),
    );
    const reader = scriptedReader({ margin: [], page: words, box: [] });

    return extractPage("p057-058", 0, toBitmap(page), reader).then(
      (extracted) => {
        const explanations = extracted.blocks.filter(
          (block) => block.kind === "explanation",
        );
        assert.equal(explanations.length, 1);
        assert.ok(explanations[0].content.includes("present continuous"));
      },
    );
  });

  test("question and answer on such a page still yields nothing", () => {
    // Two columns leave a wide hole mid-line whatever the margin is.
    const page: MutablePage = blankPage(1100, 900);
    for (const top of [200, 240, 280]) {
      inkLine(page, { left: 89, right: 980, top, centreGap: 120 });
    }
    const reader = scriptedReader({ margin: [], page: [], box: [] });

    return extractPage("p123", 0, toBitmap(page), reader).then((extracted) => {
      assert.deepEqual(
        extracted.blocks.filter((block) => block.kind === "explanation"),
        [],
      );
    });
  });
});

describe("a spread splits its content between the numbers it carries", () => {
  const spread = [
    { number: 117, y: 210 },
    { number: 118, y: 880 },
  ];
  /** A page preceded by another, which ended at `point`. */
  const after = (point: number) => ({
    precedingPoint: point,
    openingPoint: point,
  });
  /**
   * A page with nothing before it in the book, carrying the book's first point.
   *
   * The one place the two halves differ: the top of the page is its own.
   */
  const opensTheBook = (firstPoint: number) => ({
    precedingPoint: null,
    openingPoint: firstPoint,
  });
  /** A page that opens the upload somewhere in the middle of the book. */
  const OPENS_THE_UPLOAD = { precedingPoint: null, openingPoint: null };
  const OPENING = after(116);

  test("a block belongs to the last number printed above it", () => {
    assert.equal(pointForBlock(spread, 300, OPENING), 117);
    assert.equal(pointForBlock(spread, 833, OPENING), 117);
    assert.equal(pointForBlock(spread, 880, OPENING), 118);
    assert.equal(pointForBlock(spread, 1200, OPENING), 118);
  });

  test("a number printed inside a panel labels that panel", () => {
    // The margin number is not printed above the panel it names, it is printed
    // beside its first line, two to twenty-three pixels below the panel's top.
    // Measured over both books: 69 such pairs, none further than 23px, and the
    // next block up never closer than 72px. Reading "the last number above it"
    // literally handed every one of those panels to the number before.
    assert.equal(pointForBlock(spread, 858, OPENING), 118);
    assert.equal(pointForBlock(spread, 879, OPENING), 118);
  });

  test("the reach stops inside the measured void", () => {
    // 46px below the top still labels, 47 and beyond is another block.
    assert.equal(pointForBlock(spread, 880 - 46, OPENING), 118);
    assert.equal(pointForBlock(spread, 880 - 47, OPENING), 117);
  });

  test("a block above every number belongs to the point the page opens in", () => {
    // It was printed under the last number of the page before, and that is
    // where it belongs. Giving it to this page's earliest number filed it under
    // a point it was never printed beneath.
    assert.equal(pointForBlock(spread, 40, OPENING), 116);
  });

  test("a page carrying one number keeps what is printed under it", () => {
    assert.equal(
      pointForBlock([{ number: 121, y: 300 }], 900, after(120)),
      121,
    );
    assert.equal(
      pointForBlock([{ number: 121, y: 300 }], 280, after(120)),
      121,
    );
  });

  test("a page carrying none belongs entirely to the point it opens in", () => {
    assert.equal(pointForBlock([], 300, after(120)), 120);
    assert.equal(pointForBlock([], 300, OPENS_THE_UPLOAD), null);
  });

  test("nothing is chosen when the point above is not known", () => {
    // The first page of an upload has no page before it, so a block above its
    // first number has no owner to fall to. A guess here is the misfiling this
    // rule exists to stop.
    assert.equal(pointForBlock(spread, 40, OPENS_THE_UPLOAD), null);
  });

  test("the blocks a page cannot file are named, not filed anywhere", () => {
    // The screen has to know before it writes: a block with no point cannot be
    // put down, and putting it under the nearest number is the guess.
    const blocks = [{ top: 40 }, { top: 300 }, { top: 900 }];
    assert.deepEqual(unplacedBlocks(blocks, spread, OPENING), []);
    assert.deepEqual(unplacedBlocks(blocks, spread, OPENS_THE_UPLOAD), [
      { top: 40 },
    ]);
  });

  test("the top of the book's first page belongs to the book's first point", () => {
    // Nothing in the book precedes point 1, so nothing can have gone missing
    // above it and there is no earlier page for the block to have come from.
    assert.equal(
      pointForBlock([{ number: 1, y: 300 }], 40, opensTheBook(1)),
      1,
    );
    assert.deepEqual(
      unplacedBlocks([{ top: 40 }], [{ number: 1, y: 300 }], opensTheBook(1)),
      [],
    );
  });

  test("and still does when its own lowest number was misread", () => {
    // The case the merged field could not express, and the only behaviour this
    // split changes. Asked as "is my first number the one after the point above
    // me", a page whose lowest number came back as 3 answered no and was held
    // with a message asking for a previous page. Asked as "is there a page
    // above me at all", it answers no, and the top of the book's first page is
    // the book's first point whatever its other numbers were read as.
    assert.equal(
      pointForBlock([{ number: 3, y: 300 }], 40, opensTheBook(1)),
      1,
    );
  });

  test("nothing is chosen when a number is missing between the two", () => {
    // The page opens in 116 and its first number is 118, so 117 was printed
    // somewhere and never read. A block above the 118 belongs to 116 or to 117
    // and nothing on the page says which, so it is a question and not a guess.
    assert.equal(
      pointForBlock([{ number: 118, y: 880 }], 40, after(116)),
      null,
    );
  });
});

describe("criterion 5: boxes needing a human come first", () => {
  test("review-first ordering puts flagged boxes ahead of the rest", () => {
    const ordered = reviewOrder([
      {
        kind: "explanation",
        content: "prose",
        needsReview: false,
        band: { top: 100, bottom: 140 },
      },
      {
        kind: "grammar_table",
        content: "grid",
        needsReview: true,
        band: { top: 900, bottom: 1200 },
      },
      {
        kind: "vocabulary",
        content: "words",
        needsReview: false,
        band: { top: 50, bottom: 90 },
      },
    ]);
    assert.deepEqual(
      ordered.map((block) => block.kind),
      ["grammar_table", "vocabulary", "explanation"],
    );
  });
});

describe("a table panel keeps the shape it is printed in", () => {
  /** A page whose only panel is tall enough to be read as a table. */
  function tablePage(): Bitmap {
    const page: MutablePage = blankPage(1100, 1500);
    shadedBox(page, 121, 200, 400);
    return toBitmap(page);
  }

  /**
   * Answers by size: the margin strip by its whitelist, the enlarged panel crop
   * by being wider than the page, and the page itself by the rest.
   */
  function tableReader(panel: readonly OcrWord[]): OcrReader {
    return {
      async read(image: Bitmap, options) {
        if (options?.allowedCharacters !== undefined) {
          return [word("57", 10, 300)];
        }
        return image.width > 1500 ? panel : [word("text", 120, 700)];
      },
    };
  }

  test("its rows and columns survive, where they used to be welded into a line", () => {
    // Two rows of two columns, in the enlarged crop's coordinates: the column
    // gap is past 54px doubled, and the rows a whole word height apart.
    const panel: readonly OcrWord[] = [
      {
        text: "my",
        x: 20,
        y: 40,
        width: 60,
        height: 30,
        confidence: 80,
        symbols: [],
      },
      {
        text: "mine",
        x: 400,
        y: 40,
        width: 120,
        height: 30,
        confidence: 80,
        symbols: [],
      },
      {
        text: "your",
        x: 20,
        y: 120,
        width: 100,
        height: 30,
        confidence: 80,
        symbols: [],
      },
      {
        text: "yours",
        x: 400,
        y: 120,
        width: 140,
        height: 30,
        confidence: 80,
        symbols: [],
      },
    ];

    return extractPage("p105", 0, tablePage(), tableReader(panel)).then(
      (page) => {
        const table = page.blocks.find(
          (block) => block.kind === "grammar_table",
        );
        assert.notEqual(table, undefined, "the tall panel is read as a table");
        assert.equal(table?.content, "my | mine\nyour | yours");
      },
    );
  });

  /*
   * The one case that reaches the splitting rule through the pipeline itself.
   *
   * Everything above hands the reader words with no characters, so the rule
   * returns them untouched and none of it would notice the wiring being wrong.
   * Here the panel is drawn with real ink and the reader answers with the
   * characters over it, so the two arguments that decide the answer are pinned:
   * the enlarged crop, because the ink is only there, and the enlargement,
   * because the gap is judged in page pixels.
   *
   * Two words, and the second is the half that catches a missing scale: 4px
   * inside a word at page size is 8px in the crop, so a rule judging the crop's
   * own pixels would cut "she" in half.
   */
  const PANEL_LEFT = 121;
  const PANEL_TOP = 200;
  const CROP_SCALE = 2;
  /** Page pixels to the enlarged crop's, which is what the reader answers in. */
  const inCrop = (pageX: number) => (pageX - PANEL_LEFT) * CROP_SCALE;
  const downCrop = (pageY: number) => (pageY - PANEL_TOP) * CROP_SCALE;

  /** Ink as [left, right) in page pixels, per row. */
  const FUSED_INK: readonly (readonly [number, number])[] = [
    [141, 147],
    [149, 160],
    // A printed space of 10px: the engine welded this one.
    [170, 175],
    [178, 190],
  ];
  const WHOLE_INK: readonly (readonly [number, number])[] = [
    [141, 153],
    // 4px, the widest blank ever measured inside a word being 5px.
    [157, 169],
    [172, 184],
  ];
  const FUSED_TOP = 240;
  const WHOLE_TOP = 340;
  const ROW_HEIGHT = 60;

  function inkedTablePage(): Bitmap {
    const page: MutablePage = blankPage(1100, 1500);
    shadedBox(page, PANEL_LEFT, PANEL_TOP, 400);
    for (const [top, ink] of [
      [FUSED_TOP, FUSED_INK],
      [WHOLE_TOP, WHOLE_INK],
    ] as const) {
      for (const [left, right] of ink) {
        fillRect(page, left, top, right - left, ROW_HEIGHT, INK);
      }
    }
    return toBitmap(page);
  }

  function inked(
    text: string,
    letters: readonly string[],
    ink: readonly (readonly [number, number])[],
    top: number,
  ): OcrWord {
    return {
      text,
      x: inCrop(ink[0][0]),
      y: downCrop(top),
      width: inCrop(ink[ink.length - 1][1]) - inCrop(ink[0][0]),
      height: ROW_HEIGHT * CROP_SCALE,
      confidence: 90,
      symbols: letters.map((letter, at) => ({
        text: letter,
        x: inCrop(ink[at][0]),
        width: inCrop(ink[at][1]) - inCrop(ink[at][0]),
      })),
    };
  }

  test("a word the engine welded across a printed space arrives split", () => {
    const panel = [
      inked("itis", ["i", "t", "i", "s"], FUSED_INK, FUSED_TOP),
      inked("she", ["s", "h", "e"], WHOLE_INK, WHOLE_TOP),
    ];
    return extractPage("p8-9", 0, inkedTablePage(), tableReader(panel)).then(
      (page) => {
        const table = page.blocks.find(
          (block) => block.kind === "grammar_table",
        );
        assert.equal(table?.content, "it is\nshe");
      },
    );
  });
});
