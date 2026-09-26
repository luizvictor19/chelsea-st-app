import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SUCCESS_MS, createNotices, type Timer } from "./notices.ts";

/** A clock that only moves when told to. */
function manualTimer() {
  let now = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timer: Timer = {
    set(run, ms) {
      const handle = next++;
      pending.set(handle, { at: now + ms, run });
      return handle;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  function advance(ms: number) {
    now += ms;
    for (const [handle, entry] of [...pending]) {
      if (entry.at <= now) {
        pending.delete(handle);
        entry.run();
      }
    }
  }
  return { timer, advance };
}

describe("notices", () => {
  test("an error stays until it is closed", () => {
    const { timer, advance } = manualTimer();
    const notices = createNotices(timer);

    const id = notices.push("error", "A instrução de apple não foi salva.");
    advance(SUCCESS_MS * 100);
    assert.equal(notices.getSnapshot().length, 1);

    notices.dismiss(id);
    assert.deepEqual(notices.getSnapshot(), []);
  });

  test("a success leaves by itself", () => {
    const { timer, advance } = manualTimer();
    const notices = createNotices(timer);

    notices.push("success", "Salvo.");
    advance(SUCCESS_MS - 1);
    assert.equal(notices.getSnapshot().length, 1);
    advance(1);
    assert.deepEqual(notices.getSnapshot(), []);
  });

  test("a success pushed to stay waits to be closed, like an error", () => {
    const { timer, advance } = manualTimer();
    const notices = createNotices(timer);

    const id = notices.push("success", "Lição 3: 50 tipos sugeridos.", {
      stays: true,
    });
    notices.push("success", "Salvo.");
    advance(SUCCESS_MS * 100);
    assert.deepEqual(
      notices.getSnapshot().map(({ kind, text }) => ({ kind, text })),
      [{ kind: "success", text: "Lição 3: 50 tipos sugeridos." }],
    );

    notices.dismiss(id);
    assert.deepEqual(notices.getSnapshot(), []);
  });

  test("an error stays even when pushed with stays false", () => {
    const { timer, advance } = manualTimer();
    const notices = createNotices(timer);

    notices.push("error", "Falhou.", { stays: false });
    advance(SUCCESS_MS * 100);
    assert.equal(notices.getSnapshot().length, 1);
  });

  test("a success closed early does not take a later notice with it", () => {
    const { timer, advance } = manualTimer();
    const notices = createNotices(timer);

    const early = notices.push("success", "Salvo.");
    notices.dismiss(early);
    notices.push("error", "Falhou.");
    advance(SUCCESS_MS);

    assert.deepEqual(
      notices.getSnapshot().map((notice) => notice.text),
      ["Falhou."],
    );
  });

  test("notices stack in the order they came, and none replaces another", () => {
    const { timer } = manualTimer();
    const notices = createNotices(timer);

    notices.push("error", "A instrução de apple não foi salva.");
    notices.push("success", "Salvo.");
    notices.push("error", "A instrução de pear não foi salva.");

    assert.deepEqual(
      notices.getSnapshot().map((notice) => notice.text),
      [
        "A instrução de apple não foi salva.",
        "Salvo.",
        "A instrução de pear não foi salva.",
      ],
    );
  });

  test("the snapshot is the same array until something changes", () => {
    const { timer } = manualTimer();
    const notices = createNotices(timer);
    let calls = 0;
    notices.subscribe(() => calls++);

    const before = notices.getSnapshot();
    assert.equal(notices.getSnapshot(), before);
    notices.push("error", "x");
    assert.notEqual(notices.getSnapshot(), before);
    assert.equal(calls, 1);
    notices.dismiss(999);
    assert.equal(calls, 1);
  });
});
