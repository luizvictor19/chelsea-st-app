import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pointFailed,
  pointLabel,
  questionAdded,
  questionDeleted,
  questionFailed,
  questionSaved,
} from "./notice-texts.ts";

describe("a notice about a question starts with its point", () => {
  test("every success", () => {
    assert.deepEqual(questionAdded(4, 3), {
      kind: "success",
      text: "Ponto 4: pergunta 3 acrescentada.",
    });
    assert.deepEqual(questionSaved(4, 2), {
      kind: "success",
      text: "Ponto 4: pergunta 2 salva.",
    });
    assert.deepEqual(questionDeleted(12, 1), {
      kind: "success",
      text: "Ponto 12: pergunta 1 apagada.",
    });
  });

  test("a failure names the question when it is about one", () => {
    assert.deepEqual(questionFailed(4, 2, "Esta pergunta não existe mais"), {
      kind: "error",
      text: "Ponto 4, pergunta 2: Esta pergunta não existe mais.",
    });
  });

  test("a failure about the point names only the point", () => {
    assert.deepEqual(pointFailed(4, "Recarregue a página."), {
      kind: "error",
      text: "Ponto 4: Recarregue a página.",
    });
  });

  test("a message that already ends a sentence gets no second stop", () => {
    assert.equal(
      pointFailed(4, "Tente de novo!").text,
      "Ponto 4: Tente de novo!",
    );
  });

  test("the header and the notices call a point the same thing", () => {
    assert.equal(pointLabel(7), "Ponto 7");
  });
});
