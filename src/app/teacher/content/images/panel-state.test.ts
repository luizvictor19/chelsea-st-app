import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LOST_RESPONSE,
  attemptsToShow,
  discardWarning,
  settle,
  type LastAnswer,
} from "./panel-state.ts";

/** The defect of 19/09/2026, as Firefox reports it. */
function networkError(): TypeError {
  return new TypeError("NetworkError when attempting to fetch resource.");
}

describe("settle", () => {
  test("passes an answer through untouched", async () => {
    assert.deepEqual(await settle(async () => ({ ok: true as const })), {
      ok: true,
    });
    assert.deepEqual(
      await settle(async () => ({ ok: false as const, error: "sem crédito" })),
      { ok: false, error: "sem crédito" },
    );
  });

  /*
   * The whole point. A server action call is a fetch, and a fetch rejects; the
   * generation of 19/09/2026 rejected after the server had already written the
   * row. Awaited without a catch that rejection reached the window with no
   * owner, and the panel never heard that the call had ended.
   */
  test("turns a rejected call into an answer instead of a rejection", async () => {
    const settled = await settle(async () => {
      throw networkError();
    });
    assert.equal(settled.ok, false);
    assert.equal(settled.error, LOST_RESPONSE);
  });

  test("keeps the cause, so the next time is not diagnosed from scratch", async () => {
    const cause = networkError();
    const settled = await settle(async () => {
      throw cause;
    });
    assert.equal(settled.ok, false);
    assert.equal("cause" in settled ? settled.cause : null, cause);
  });

  /*
   * A message the teacher reads before deciding whether to press Gerar again,
   * which at these prices is the decision that costs money. It must not say
   * the generation failed, because the row is written before the answer is
   * sent and very probably exists.
   */
  test("says the work may have been saved, and never that it failed", () => {
    assert.ok(!/falhou|falha|erro/i.test(LOST_RESPONSE));
    assert.match(LOST_RESPONSE, /recarregue/i);
  });

  test("does not swallow a call that never rejected", async () => {
    let calls = 0;
    await settle(async () => {
      calls += 1;
      return { ok: true as const };
    });
    assert.equal(calls, 1);
  });
});

describe("attemptsToShow", () => {
  const served = [{ id: "a" }, { id: "b" }] as const;

  test("shows the server's list while no action has answered", () => {
    assert.equal(attemptsToShow(served, null), served);
  });

  /*
   * The second half of 19/09/2026: the action answered with the new attempt
   * and the re-render that was supposed to carry it never arrived. Until one
   * does, the answer is the only list known to have reached the browser.
   */
  test("shows the answer while the server has sent nothing newer", () => {
    const answered: LastAnswer<{ id: string }> = {
      list: [{ id: "c" }, ...served],
      served,
    };
    assert.equal(attemptsToShow(served, answered), answered.list);
  });

  test("goes back to the server the moment it sends any list", () => {
    const answered: LastAnswer<{ id: string }> = {
      list: [{ id: "c" }, ...served],
      served,
    };
    const rerendered = [{ id: "c" }, { id: "a" }, { id: "b" }];
    assert.equal(attemptsToShow(rerendered, answered), rerendered);
  });

  /*
   * Identity and not length: a re-render that happens to have as many rows as
   * the answer is still newer than the answer, and one that has fewer is too.
   * Only the array the answer was measured against counts as "not yet".
   */
  test("recognises a newer list by identity, not by what is in it", () => {
    const answered: LastAnswer<{ id: string }> = {
      list: [{ id: "c" }, ...served],
      served,
    };
    const sameRowsNewArray = [...served];
    assert.equal(attemptsToShow(sameRowsNewArray, answered), sameRowsNewArray);
  });

  test("an empty answer is an answer, not an absence", () => {
    const answered: LastAnswer<{ id: string }> = { list: [], served };
    assert.deepEqual(attemptsToShow(served, answered), []);
  });
});

describe("discardWarning", () => {
  /*
   * The number, not "are you sure". The bin removes the file from the bucket
   * and what stops a person is knowing what they are throwing away: a picture
   * that has already been paid for.
   */
  test("says what the picture cost and that the file is gone", () => {
    assert.equal(
      discardWarning(80),
      "Esta imagem custou 80 créditos. O arquivo não volta.",
    );
    assert.equal(
      discardWarning(150),
      "Esta imagem custou 150 créditos. O arquivo não volta.",
    );
  });

  /*
   * Null is a model whose price was never measured, and every attempt made
   * before the cost was written down at all. Filling the sentence with a
   * guess would put an unchecked number in front of the teacher at the exact
   * moment they are deciding with it.
   */
  test("says the cost was not recorded rather than inventing one", () => {
    const said = discardWarning(null);
    assert.match(said, /não foi registrado/u);
    assert.doesNotMatch(said, /\d/u);
    assert.match(said, /O arquivo não volta\./u);
  });

  test("never drops the warning that the file is gone", () => {
    for (const cost of [null, 0, 1, 50, 80, 150]) {
      assert.match(discardWarning(cost), /O arquivo não volta\./u, `${cost}`);
    }
  });

  /*
   * Zero is a cost, not an absence: it would mean a generation that really
   * was free, and saying "not recorded" there would be as wrong as inventing
   * a number in the other direction.
   */
  test("tells zero apart from unknown", () => {
    assert.match(discardWarning(0), /custou 0 créditos/u);
    assert.doesNotMatch(discardWarning(0), /não foi registrado/u);
  });

  test("counts one credit in the singular", () => {
    assert.match(discardWarning(1), /custou 1 crédito\./u);
  });
});
