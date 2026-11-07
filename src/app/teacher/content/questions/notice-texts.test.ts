import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pointFailed,
  pointLabel,
  questionAdded,
  questionDeleted,
  questionFailed,
  questionSaved,
  questionsSuggested,
  sceneCreated,
  sceneFound,
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

  test("a scene created from a form, or found there", () => {
    assert.deepEqual(sceneCreated(3), {
      kind: "success",
      text: "Ponto 3: cena criada e escolhida. Falta a imagem.",
    });
    assert.deepEqual(sceneFound(3), {
      kind: "success",
      text: "Ponto 3: essa cena já existia e foi escolhida.",
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

describe("questionsSuggested", () => {
  test("what was asked for, in the cards", () => {
    assert.deepEqual(
      questionsSuggested(5, { asked: 6, returned: 6, added: 6 }),
      {
        kind: "success",
        text: "Ponto 5: 6 perguntas sugeridas.",
      },
    );
    assert.equal(
      questionsSuggested(5, { asked: 1, returned: 1, added: 1 }).text,
      "Ponto 5: 1 pergunta sugerida.",
    );
  });

  test("fewer than asked says why", () => {
    assert.equal(
      questionsSuggested(7, { asked: 6, returned: 4, added: 4 }).text,
      "Ponto 7: 4 de 6 perguntas sugeridas: o modelo não achou mais perguntas naturais.",
    );
  });

  test("drafts already on a card are counted apart", () => {
    assert.equal(
      questionsSuggested(7, { asked: 6, returned: 6, added: 4 }).text,
      "Ponto 7: 6 perguntas sugeridas. 2 já estavam nos cartões.",
    );
    assert.equal(
      questionsSuggested(7, { asked: 6, returned: 6, added: 0 }).text,
      "Ponto 7: as perguntas sugeridas já estavam nos cartões.",
    );
  });

  test("none at all", () => {
    assert.equal(
      questionsSuggested(7, { asked: 6, returned: 0, added: 0 }).text,
      "Ponto 7: o modelo não sugeriu nenhuma pergunta.",
    );
  });
});
