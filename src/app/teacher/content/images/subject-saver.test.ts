import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createNotices, type Timer } from "../../notices.ts";

import { createSubjectSaver, subjectNotSaved } from "./subject-saver.ts";

/** A clock that never fires: errors do not need one, and must not use one. */
const stopped: Timer = { set: () => 0, clear: () => {} };

/** A promise the test settles by hand, to hold a call in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A word's panel, wired to the snackbar the way word-panel.tsx wires it. */
function panel(
  term: string,
  initial: string | null,
  save: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>,
  notices = createNotices(stopped),
) {
  const saver = createSubjectSaver({
    initial,
    save,
    onFailure: () => notices.push("error", subjectNotSaved(term)),
  });
  return { saver, notices };
}

describe("a save that fails after the panel has closed", () => {
  test("still reaches the snackbar, naming the word", async () => {
    const notices = createNotices(stopped);
    const call = deferred<{ ok: true } | { ok: false; error: string }>();

    // The teacher edits apple and clicks pear: the field is left, the save
    // goes out, and apple's panel is dropped.
    let apple: ReturnType<typeof panel> | null = panel(
      "apple",
      null,
      () => call.promise,
      notices,
    );
    const saving = apple.saver.save("a red apple");
    apple = null;
    panel("pear", "a green pear", async () => ({ ok: true }), notices);

    // Only now does apple's save answer, and it failed.
    call.reject(
      new TypeError("NetworkError when attempting to fetch resource."),
    );
    assert.equal(await saving, false);

    assert.deepEqual(
      notices.getSnapshot().map(({ kind, text }) => ({ kind, text })),
      [{ kind: "error", text: "A instrução de apple não foi salva." }],
    );
  });

  test("a refusal from the server is said the same way", async () => {
    const { saver, notices } = panel("apple", null, async () => ({
      ok: false,
      error: "permission denied",
    }));

    assert.equal(await saver.save("a red apple"), false);
    assert.deepEqual(
      notices.getSnapshot().map((notice) => notice.text),
      ["A instrução de apple não foi salva."],
    );
  });

  test("a save that lands says nothing", async () => {
    const { saver, notices } = panel("apple", null, async () => ({
      ok: true,
    }));

    assert.equal(await saver.save("a red apple"), true);
    assert.deepEqual(notices.getSnapshot(), []);
  });

  test("after a failure the same text is written again", async () => {
    const texts: string[] = [];
    let fail = true;
    const { saver } = panel("apple", null, async (text) => {
      texts.push(text);
      return fail ? { ok: false, error: "x" } : { ok: true };
    });

    await saver.save("a red apple");
    fail = false;
    await saver.save("a red apple");

    assert.deepEqual(texts, ["a red apple", "a red apple"]);
  });
});

describe("a suggestion after a save that failed", () => {
  test("is not asked for, and the only thing said is the failed save", async () => {
    const { saver, notices } = panel("apple", "an apple", async () => ({
      ok: false,
      error: "NetworkError",
    }));
    let asked = 0;

    const outcome = await saver.suggest(
      "a bitten apple",
      () => "a bitten apple",
      async () => {
        asked++;
        return { ok: true, subject: "a red apple", stored: false };
      },
    );

    assert.equal(asked, 0);
    assert.deepEqual(outcome, {
      ok: true,
      field: "a bitten apple",
      note: null,
    });
    assert.deepEqual(
      notices.getSnapshot().map((notice) => notice.text),
      ["A instrução de apple não foi salva."],
    );
  });
});
