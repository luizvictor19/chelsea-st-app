import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  batchProgress,
  initialFocus,
  isActionable,
  nextAfter,
  resolveFocus,
  type PageState,
  type ReviewPage,
} from "./review-navigation.ts";

const page = (id: string, state: PageState): ReviewPage => ({ id, state });

describe("initialFocus", () => {
  test("a page that cannot be written without an answer comes first", () => {
    // It is the only state that blocks: the batch could not settle its point,
    // so nothing about it can be written until someone says which point it is.
    const pages = [
      page("p116", "waiting"),
      page("nopoint-3", "needs-answer"),
      page("p121", "waiting"),
    ];
    assert.equal(initialFocus(pages), "nopoint-3");
  });

  test("otherwise the first page still waiting", () => {
    const pages = [
      page("p116", "saved"),
      page("p117", "waiting"),
      page("p121", "waiting"),
    ];
    assert.equal(initialFocus(pages), "p117");
  });

  test("with everything done it still shows something", () => {
    const pages = [page("p116", "saved"), page("dup", "duplicate")];
    assert.equal(initialFocus(pages), "p116");
  });

  test("an empty batch focuses nothing", () => {
    assert.equal(initialFocus([]), null);
  });
});

describe("nextAfter", () => {
  test("moves forward to the next page that can be worked on", () => {
    const pages = [
      page("a", "saved"),
      page("b", "saved"),
      page("c", "waiting"),
      page("d", "waiting"),
    ];
    assert.equal(nextAfter(pages, "c"), "d");
  });

  test("skips pages that are never going to be written", () => {
    const pages = [
      page("a", "waiting"),
      page("dup", "duplicate"),
      page("rev", "unsupported"),
      page("photo", "refused"),
      page("b", "waiting"),
    ];
    assert.equal(nextAfter(pages, "a"), "b");
  });

  test("wraps to the start rather than stopping at the end", () => {
    // Confirming the last page must still land on whatever was skipped
    // earlier, or the skipped page is quietly forgotten.
    const pages = [
      page("a", "waiting"),
      page("b", "saved"),
      page("c", "saved"),
    ];
    assert.equal(nextAfter(pages, "c"), "a");
  });

  test("returns nothing when the batch is finished", () => {
    const pages = [page("a", "saved"), page("b", "saved")];
    assert.equal(nextAfter(pages, "b"), null);
  });

  test("does not send you back to the page you just finished", () => {
    const pages = [page("a", "saved"), page("b", "waiting")];
    assert.equal(
      nextAfter(pages, "b"),
      null,
      "b is the only one left and it is done with",
    );
  });

  test("a page that vanished falls back to the first that needs work", () => {
    const pages = [page("a", "saved"), page("b", "needs-answer")];
    assert.equal(nextAfter(pages, "gone"), "b");
  });
});

describe("resolveFocus", () => {
  test("keeps the page in view when it still exists", () => {
    // The rail must not jump under the teacher after every save.
    const pages = [page("a", "saved"), page("b", "waiting")];
    assert.equal(resolveFocus(pages, "a"), "a");
  });

  test("falls back when the page is gone", () => {
    const pages = [page("b", "waiting")];
    assert.equal(resolveFocus(pages, "a"), "b");
  });

  test("with nothing in view it chooses the first that needs work", () => {
    const pages = [page("a", "saved"), page("b", "needs-answer")];
    assert.equal(resolveFocus(pages, null), "b");
  });
});

describe("batchProgress", () => {
  test("counts over pages that can be written", () => {
    // A re-upload or a refused image must not make the batch look permanently
    // unfinished.
    const pages = [
      page("a", "saved"),
      page("b", "waiting"),
      page("dup", "duplicate"),
      page("rev", "unsupported"),
      page("photo", "refused"),
    ];
    assert.deepEqual(batchProgress(pages), {
      total: 2,
      saved: 1,
      needingAnswer: 0,
      fraction: 0.5,
    });
  });

  test("reports how many still need an answer", () => {
    const pages = [page("a", "needs-answer"), page("b", "needs-answer")];
    assert.equal(batchProgress(pages).needingAnswer, 2);
  });

  test("a batch with nothing writable does not divide by zero", () => {
    assert.deepEqual(batchProgress([page("dup", "duplicate")]), {
      total: 0,
      saved: 0,
      needingAnswer: 0,
      fraction: 0,
    });
  });
});

describe("isActionable", () => {
  test("only a page waiting or needing an answer is somewhere to be sent", () => {
    assert.equal(isActionable("waiting"), true);
    assert.equal(isActionable("needs-answer"), true);
    for (const state of [
      "saved",
      "duplicate",
      "unsupported",
      "refused",
    ] as const) {
      assert.equal(isActionable(state), false, state);
    }
  });
});
