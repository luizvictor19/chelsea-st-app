import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  extractPage,
  isRefused,
  resolveBatch,
  reviewOrder,
} from "./pipeline.ts";
import {
  blankPage,
  inkLine,
  shadedBox,
  toBitmap,
  type MutablePage,
} from "./testing/synthetic-page.ts";
import type { Bitmap, OcrReader, OcrWord } from "./types.ts";

const CEILING = 128;

function word(text: string, x: number, y: number, agreement = 1): OcrWord {
  void agreement;
  return { text, x, y, height: 12, confidence: 50 };
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

    const resolved = resolveBatch(pages, CEILING);
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
    const resolved = resolveBatch(pages, CEILING);
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
