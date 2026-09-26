import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  IMAGE_STYLE_LABELS,
  classChanged,
  contrastSuggested,
  generationNotice,
  imageApproved,
  imageDiscarded,
  kindChanged,
  lessonFailed,
  lessonLabel,
  referenceAttached,
  referenceRemoved,
  setDissolved,
  setFailed,
  setSaved,
  styleChanged,
  subjectGenerated,
  subjectNotSaved,
  typesStalled,
  typesSuggested,
  uploadSent,
  wordFailed,
} from "./notice-texts.ts";

const ok = (text: string) => ({ kind: "success", text });
const bad = (text: string) => ({ kind: "error", text });

describe("a notice about a word starts with its term", () => {
  test("every success on a word", () => {
    assert.deepEqual(
      kindChanged("apple", "photo"),
      ok("apple: tipo alterado para foto."),
    );
    assert.deepEqual(
      classChanged("apple", "noun"),
      ok("apple: classe alterada para substantivo."),
    );
    assert.deepEqual(
      classChanged("apple", null),
      ok("apple: classe removida."),
    );
    assert.deepEqual(
      styleChanged("ceiling", "realistic"),
      ok("ceiling: estilo alterado para realista."),
    );
    assert.deepEqual(
      styleChanged("ceiling", "flat"),
      ok("ceiling: estilo alterado para vetor chapado."),
    );
    assert.deepEqual(
      referenceAttached("apple"),
      ok("apple: referência anexada."),
    );
    assert.deepEqual(
      referenceRemoved("apple"),
      ok("apple: referência removida."),
    );
    assert.deepEqual(
      uploadSent("apple"),
      ok("apple: imagem enviada, falta aprovar."),
    );
    assert.deepEqual(subjectGenerated("apple"), ok("apple: instrução gerada."));
    assert.deepEqual(imageApproved("apple"), ok("apple: imagem aprovada."));
    assert.deepEqual(imageDiscarded("apple"), ok("apple: imagem descartada."));
  });

  test("an error keeps the action's message, ending in one full stop", () => {
    assert.deepEqual(
      wordFailed("apple", "Escolha o tipo da palavra antes de gerar a imagem."),
      bad("apple: Escolha o tipo da palavra antes de gerar a imagem."),
    );
    assert.deepEqual(
      wordFailed("apple", "permission denied "),
      bad("apple: permission denied."),
    );
    assert.deepEqual(
      subjectNotSaved("apple"),
      bad("apple: a instrução não foi salva."),
    );
  });

  test("the style labels are the ones the screen shows", () => {
    assert.equal(IMAGE_STYLE_LABELS.realistic, "Realista");
  });
});

describe("generationNotice", () => {
  const rows = (status: string, error: string | null = null) => [
    { id: "other", status: "generated", error: null },
    { id: "a1", status, error },
  ];

  test("says nothing while the attempt is still running", () => {
    assert.equal(generationNotice("apple", "a1", rows("pending")), null);
  });

  test("a finished attempt is an image generated", () => {
    assert.deepEqual(
      generationNotice("apple", "a1", rows("generated")),
      ok("apple: imagem gerada."),
    );
    assert.deepEqual(
      generationNotice("apple", "a1", rows("approved")),
      ok("apple: imagem gerada."),
    );
  });

  test("a failed attempt is an error with the reason the row holds", () => {
    assert.deepEqual(
      generationNotice(
        "apple",
        "a1",
        rows("failed", "A geração passou de 180 segundos sem responder."),
      ),
      bad("apple: A geração passou de 180 segundos sem responder."),
    );
    assert.deepEqual(
      generationNotice("apple", "a1", rows("failed")),
      bad("apple: a geração falhou."),
    );
  });

  test("an attempt missing from the list says nothing", () => {
    assert.equal(generationNotice("apple", "gone", rows("generated")), null);
  });
});

describe("sets", () => {
  test("name their members in the set's order", () => {
    assert.deepEqual(
      setSaved(["large", "medium", "small"]),
      ok("Conjunto salvo: large, medium, small."),
    );
    assert.deepEqual(
      setDissolved(["large", "small"]),
      ok("Conjunto desfeito: large, small."),
    );
    assert.deepEqual(
      setFailed(["large", "small"], "Já está em outro conjunto: small."),
      bad("Conjunto large, small: Já está em outro conjunto: small."),
    );
  });
});

describe("Sugerir tipos", () => {
  test("a clean run is one success for the lesson", () => {
    assert.deepEqual(
      typesSuggested(3, 60, 0),
      ok("Lição 3: 60 tipos sugeridos."),
    );
    assert.deepEqual(typesSuggested(3, 1, 0), ok("Lição 3: 1 tipo sugerido."));
    assert.deepEqual(
      typesSuggested(3, 0, 0),
      ok("Lição 3: 0 tipos sugeridos."),
    );
  });

  /*
   * The words the model never answered for are written nowhere and counted
   * nowhere else, and they keep whatever suggestion they had before. That
   * makes the run an error, not a success with a footnote.
   */
  test("words without an answer make it an error, with the count", () => {
    assert.deepEqual(
      typesSuggested(3, 58, 2),
      bad("Lição 3: 58 sugeridos, 2 sem resposta. Rode de novo."),
    );
    assert.deepEqual(
      typesSuggested(3, 1, 1),
      bad("Lição 3: 1 sugerido, 1 sem resposta. Rode de novo."),
    );
  });

  test("a run that stopped says how many never passed, and why", () => {
    assert.deepEqual(
      typesStalled(3, 20, 60, "A resposta do servidor não chegou."),
      bad(
        "Lição 3: parou em 20 de 60, 40 não passaram. A resposta do servidor não chegou.",
      ),
    );
    assert.match(typesStalled(3, 0, 60, "sem chave").text, /60 não passaram/u);
    assert.match(typesStalled(3, 59, 60, "x").text, /1 não passou/u);
    // Never a negative.
    assert.match(typesStalled(3, 70, 60, "x").text, /0 não passaram/u);
  });

  test("a lesson-wide failure starts with the lesson", () => {
    assert.deepEqual(lessonFailed(3, "sem chave"), bad("Lição 3: sem chave."));
  });
});

describe("Sugerir conjuntos", () => {
  test("counts the proposals that reached the screen", () => {
    assert.deepEqual(
      contrastSuggested(3, 0),
      ok("Lição 3: nenhum conjunto novo."),
    );
    assert.deepEqual(
      contrastSuggested(3, 1),
      ok("Lição 3: 1 sugestão de conjunto."),
    );
    assert.deepEqual(
      contrastSuggested(3, 4),
      ok("Lição 3: 4 sugestões de conjunto."),
    );
  });
});

describe("lessonLabel", () => {
  test("names a lesson as its header does, the one outside a lesson too", () => {
    assert.equal(lessonLabel(3), "Lição 3");
    assert.equal(lessonLabel(null), "Fora de lição");
    assert.deepEqual(
      contrastSuggested(null, 0),
      ok("Fora de lição: nenhum conjunto novo."),
    );
  });
});
