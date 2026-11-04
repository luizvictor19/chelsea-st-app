import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rangeRefusal } from "./range-refusal.ts";

const BOOK = "3c66c328-00c2-4b61-8b2f-878eff5f90f9";

/**
 * The refusal of materialize_points (0039), word for word. The same sentence
 * is asserted against the function itself by the block "A narrowing names a
 * point she stopped at (0039)" of scripts/verify-rls.sql: a change to it is
 * made in both places.
 */
function refusal(
  first: number,
  last: number,
  content: number,
  lessons: number,
  stopped: number,
) {
  return {
    code: "P0001",
    message:
      `cannot narrow book ${BOOK} to ${first}..${last}: ` +
      `${content} point(s) outside carry content, ` +
      `${lessons} lesson(s) reach outside, ` +
      `${stopped} point(s) outside are where a lesson stopped`,
  };
}

describe("rangeRefusal", () => {
  test("only a lesson that stopped there", () => {
    assert.equal(
      rangeRefusal(refusal(1, 127, 0, 0, 1)),
      "Não dá para mudar o livro para os pontos 1 a 127: 1 ponto fora desse intervalo é onde uma aula parou.",
    );
  });

  test("only content", () => {
    assert.equal(
      rangeRefusal(refusal(1, 50, 2, 0, 0)),
      "Não dá para mudar o livro para os pontos 1 a 50: 2 pontos fora desse intervalo têm conteúdo.",
    );
  });

  test("content and a lesson of the book", () => {
    assert.equal(
      rangeRefusal(refusal(10, 50, 1, 1, 0)),
      "Não dá para mudar o livro para os pontos 10 a 50: 1 ponto fora desse intervalo tem conteúdo e 1 lição vai além desse intervalo.",
    );
  });

  test("the three reasons, in the plural", () => {
    assert.equal(
      rangeRefusal(refusal(10, 50, 3, 2, 2)),
      "Não dá para mudar o livro para os pontos 10 a 50: 3 pontos fora desse intervalo têm conteúdo, 2 lições vão além desse intervalo e 2 pontos fora desse intervalo são onde aulas pararam.",
    );
  });

  test("the sentence before 0039, with two reasons, stays as it came", () => {
    assert.equal(
      rangeRefusal({
        code: "P0001",
        message: `cannot narrow book ${BOOK} to 1..50: 2 point(s) outside carry content, 0 lesson(s) reach outside`,
      }),
      null,
    );
  });

  test("another code or another sentence is not this refusal", () => {
    assert.equal(
      rangeRefusal({ ...refusal(1, 127, 0, 0, 1), code: "23503" }),
      null,
    );
    assert.equal(
      rangeRefusal({
        code: "P0001",
        message: "p_first_point must be at least 1, got 0",
      }),
      null,
    );
    assert.equal(
      rangeRefusal({
        code: "P0001",
        message: `${refusal(1, 127, 0, 0, 1).message} and more`,
      }),
      null,
    );
  });

  test("no reason above zero is not a refusal to translate", () => {
    assert.equal(rangeRefusal(refusal(1, 127, 0, 0, 0)), null);
  });
});
