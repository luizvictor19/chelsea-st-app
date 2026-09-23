import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addMember,
  askTwiceIfLost,
  cardsFrom,
  removeMember,
  type Card,
} from "./contrast-proposals.ts";

const LOST = { ok: false as const, error: "perdida", cause: new Error("x") };

describe("askTwiceIfLost", () => {
  test("asks once when the answer arrives", async () => {
    let calls = 0;
    const result = await askTwiceIfLost(async () => {
      calls += 1;
      return { ok: true as const };
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { answer: { ok: true }, attempts: 1 });
  });

  // Nothing is written by a suggestion, so asking again is safe; a refusal
  // is an answer, and asking again would only pay for the same refusal.
  test("asks again once when the answer is lost, and not when it is refused", async () => {
    let calls = 0;
    const recovered = await askTwiceIfLost(async () => {
      calls += 1;
      return calls === 1 ? LOST : { ok: true as const };
    });
    assert.equal(calls, 2);
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.answer.ok, true);

    calls = 0;
    const refused = await askTwiceIfLost(async () => {
      calls += 1;
      return { ok: false as const, error: "ilegível" };
    });
    assert.equal(calls, 1);
    assert.equal(refused.answer.ok, false);
  });

  test("stops after the second loss, and a thrown call counts as lost", async () => {
    let calls = 0;
    const result = await askTwiceIfLost(async (): Promise<{ ok: true }> => {
      calls += 1;
      throw new Error("fetch failed");
    });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.equal(result.answer.ok, false);
  });
});

const member = (id: string, term: string, point: number) => ({
  id,
  term,
  point,
});
const LARGE = member("l", "large", 3);
const SMALL = member("s", "small", 3);
const BOY = member("b", "boy", 4);

describe("cards", () => {
  test("one card per proposal, each with its own key, in the order given", () => {
    const cards = cardsFrom([
      { members: [LARGE, SMALL], reason: "size" },
      { members: [BOY, member("g", "girl", 4)], reason: "sex" },
    ]);
    assert.deepEqual(
      cards.map((c) => c.members.map((m) => m.term)),
      [
        ["large", "small"],
        ["boy", "girl"],
      ],
    );
    assert.equal(new Set(cards.map((c) => c.key)).size, 2);
    assert.ok(cards.every((c) => c.error === null));
  });

  test("a member is taken out, and put back at the end", () => {
    const [card] = cardsFrom([
      { members: [LARGE, SMALL, BOY], reason: "" },
    ]) as Card[];
    const without = removeMember(card, "s");
    assert.deepEqual(
      without.members.map((m) => m.id),
      ["l", "b"],
    );
    const back = addMember(without, SMALL);
    assert.deepEqual(
      back.members.map((m) => m.id),
      ["l", "b", "s"],
    );
    // Added twice is added once.
    assert.equal(addMember(back, SMALL).members.length, 3);
  });

  test("an edit clears the error the last save left on the card", () => {
    const [card] = cardsFrom([{ members: [LARGE, SMALL], reason: "" }]);
    const refused = { ...card, error: "Já está em outro conjunto: small." };
    assert.equal(removeMember(refused, "s").error, null);
    assert.equal(addMember(refused, BOY).error, null);
  });
});
