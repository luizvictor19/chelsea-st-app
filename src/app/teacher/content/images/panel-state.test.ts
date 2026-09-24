import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LOST_RESPONSE,
  asksBeforeReclassifying,
  attemptCredits,
  attemptOrigin,
  attemptsToShow,
  discardWarning,
  reclassifyWarning,
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

/** An attempt as the bin sees it. */
function generated(creditsSpent: number | null) {
  return { provider: "freepik", creditsSpent };
}

function uploaded() {
  return { provider: "upload", creditsSpent: 0 };
}

describe("discardWarning", () => {
  /*
   * The number, not "are you sure". The bin removes the file from the bucket
   * and what stops a person is knowing what they are throwing away: a picture
   * that has already been paid for.
   */
  test("says what the picture cost and that the file is gone", () => {
    assert.equal(
      discardWarning(generated(80)),
      "Esta imagem custou 80 créditos. O arquivo não volta. A tentativa continua na lista, com o que ela custou.",
    );
    assert.equal(
      discardWarning(generated(150)),
      "Esta imagem custou 150 créditos. O arquivo não volta. A tentativa continua na lista, com o que ela custou.",
    );
  });

  /*
   * Null is a model whose price was never measured, and every attempt made
   * before the cost was written down at all. Filling the sentence with a
   * guess would put an unchecked number in front of the teacher at the exact
   * moment they are deciding with it.
   */
  test("says the cost was not recorded rather than inventing one", () => {
    const said = discardWarning(generated(null));
    assert.match(said, /não foi registrado/u);
    assert.doesNotMatch(said, /\d/u);
    assert.match(said, /O arquivo não volta\./u);
  });

  test("never drops the warning that the file is gone", () => {
    for (const cost of [null, 0, 1, 50, 80, 150]) {
      assert.match(
        discardWarning(generated(cost)),
        /O arquivo não volta\./u,
        `${cost}`,
      );
    }
    assert.match(discardWarning(uploaded()), /O arquivo não volta\./u);
  });

  /*
   * An upload cost nothing, and "custou 0 créditos" would read as nothing to
   * lose. It is the opposite: the bucket holds the only copy the platform
   * has of a picture finished by hand.
   */
  test("an upload says it is the only copy, and never a cost", () => {
    const said = discardWarning(uploaded());
    assert.doesNotMatch(said, /crédito/u);
    assert.match(said, /única cópia/u);
    assert.match(said, /envie o arquivo de novo/u);
  });

  /*
   * Zero is a cost, not an absence: it would mean a generation that really
   * was free, and saying "not recorded" there would be as wrong as inventing
   * a number in the other direction.
   */
  test("tells zero apart from unknown", () => {
    assert.match(discardWarning(generated(0)), /custou 0 créditos/u);
    assert.doesNotMatch(discardWarning(generated(0)), /não foi registrado/u);
  });

  test("counts one credit in the singular", () => {
    assert.match(discardWarning(generated(1)), /custou 1 crédito\./u);
  });
});

/*
 * The word-panel offers eight one-click type buttons, and since 0019 four of
 * them take an approved picture off the word. One of the twenty pictures on a
 * word today cost fifteen attempts, so what this sentence says is the
 * difference between a teacher cancelling, accepting, or accepting and then
 * regenerating something they still have.
 */
describe("reclassifyWarning", () => {
  test("says the picture comes off the word", () => {
    assert.match(reclassifyWarning("Símbolo"), /sai desta palavra/u);
  });

  /*
   * The half that saves the work. From 0021 the attempt goes back to being a
   * candidate with its file rather than being refused, and a warning that
   * mentioned only the loss would send the teacher off to generate a
   * replacement for a picture still sitting in the list.
   */
  test("says the picture is not lost", () => {
    const text = reclassifyWarning("Uso");
    assert.match(text, /candidata/u);
    assert.match(text, /aprovada\s+de novo/u);
  });

  test("names the kind being chosen, in lower case", () => {
    assert.match(reclassifyWarning("Metalinguagem"), /metalinguagem/u);
    assert.doesNotMatch(reclassifyWarning("Metalinguagem"), /Metalinguagem/u);
  });
});

/*
 * The rule that decides whether the teacher is asked at all. Since 0019 four
 * of the eight one-click type buttons take an approved picture off the word,
 * and before this they did it with no dialog and no visible undo.
 */
describe("asksBeforeReclassifying", () => {
  test("asks when a kind that carries no picture would take one off", () => {
    for (const kind of ["symbol", "usage", "metalanguage", "none"]) {
      assert.equal(
        asksBeforeReclassifying(kind, "https://x/y.jpg"),
        true,
        kind,
      );
    }
  });

  /* Nothing to warn about, so nothing is asked. */
  test("does not ask when the word has no approved picture", () => {
    for (const kind of ["symbol", "usage", "metalanguage", "none"]) {
      assert.equal(asksBeforeReclassifying(kind, null), false, kind);
    }
  });

  /*
   * Moving between kinds that draw keeps the picture, so asking would be a
   * dialog with nothing to say — which is the kind people learn to click
   * through, and then click through on the one that mattered.
   */
  test("does not ask between kinds that draw", () => {
    for (const kind of ["photo", "pose", "action", "figure"]) {
      assert.equal(
        asksBeforeReclassifying(kind, "https://x/y.jpg"),
        false,
        kind,
      );
    }
  });

  /*
   * The list comes from isDrawableKind and not from a copy here, so a kind
   * added to the enum and to nothing else falls on the asking side. That is
   * the safe way round: a needless dialog is a nuisance, a missing one is a
   * picture gone.
   */
  test("an unknown kind is treated as one that carries no picture", () => {
    assert.equal(asksBeforeReclassifying("sketch", "https://x/y.jpg"), true);
  });
});

describe("attemptOrigin", () => {
  test("a generated attempt is named by its model", () => {
    assert.equal(
      attemptOrigin({
        provider: "freepik",
        model: "mystic",
        sourceFilename: null,
      }),
      "mystic",
    );
  });

  test("an upload says it was sent, and the file it came from", () => {
    assert.equal(
      attemptOrigin({
        provider: "upload",
        model: null,
        sourceFilename: "anna-final.png",
      }),
      "enviada · anna-final.png",
    );
  });

  test("an upload with no file name still says it was sent", () => {
    assert.equal(
      attemptOrigin({ provider: "upload", model: null, sourceFilename: null }),
      "enviada",
    );
  });

  test("a generated attempt with no model says nothing", () => {
    assert.equal(
      attemptOrigin({ provider: "freepik", model: null, sourceFilename: null }),
      null,
    );
  });
});

describe("attemptCredits", () => {
  test("a generation says what it cost", () => {
    assert.equal(
      attemptCredits({ provider: "freepik", creditsSpent: 80 }),
      "80 créditos",
    );
    assert.equal(
      attemptCredits({ provider: "freepik", creditsSpent: 1 }),
      "1 crédito",
    );
  });

  test("an unknown cost says nothing", () => {
    assert.equal(
      attemptCredits({ provider: "freepik", creditsSpent: null }),
      null,
    );
  });

  // The zero is true, and kept in the row; on the line it would set a
  // provider's charge beside a file no provider was asked for.
  test("an upload says nothing about credits", () => {
    assert.equal(attemptCredits({ provider: "upload", creditsSpent: 0 }), null);
  });
});
