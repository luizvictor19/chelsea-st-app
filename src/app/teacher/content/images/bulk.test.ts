import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  inPool,
  losingPicture,
  planWrite,
  setBlocker,
  subjectPlan,
  type BulkWord,
} from "./bulk.ts";
import { bulkError, bulkNotice, subjectsNotice } from "./notice-texts.ts";
import { reclassifyWarningMany } from "./panel-state.ts";

function word(over: Partial<BulkWord> & { id: string }): BulkWord {
  return {
    term: over.id,
    representation: null,
    suggestedRepresentation: null,
    wordClass: null,
    imageStyle: "flat",
    imageUrl: null,
    imageSubject: null,
    inSet: false,
    ...over,
  };
}

describe("planWrite, Aceitar sugestão", () => {
  test("writes the suggestion over a different kind, or over none", () => {
    assert.deepEqual(
      planWrite(
        { kind: "accept" },
        word({ id: "a", suggestedRepresentation: "symbol" }),
      ),
      { write: { kind: "representation", value: "symbol" } },
    );
    assert.deepEqual(
      planWrite(
        { kind: "accept" },
        word({
          id: "a",
          representation: "photo",
          suggestedRepresentation: "symbol",
        }),
      ),
      { write: { kind: "representation", value: "symbol" } },
    );
  });

  test("skips a word with no suggestion", () => {
    assert.deepEqual(
      planWrite({ kind: "accept" }, word({ id: "a", representation: "photo" })),
      { skip: "no-suggestion" },
    );
  });

  test("skips a word that already has the suggested kind", () => {
    assert.deepEqual(
      planWrite(
        { kind: "accept" },
        word({
          id: "a",
          representation: "symbol",
          suggestedRepresentation: "symbol",
        }),
      ),
      { skip: "same" },
    );
  });
});

describe("planWrite, a value for every word", () => {
  test("skips a word that already holds it, and writes the rest", () => {
    const kind = { kind: "representation", value: "photo" } as const;
    assert.deepEqual(
      planWrite(kind, word({ id: "a", representation: "photo" })),
      { skip: "same" },
    );
    assert.deepEqual(planWrite(kind, word({ id: "a" })), { write: kind });

    const noun = { kind: "wordClass", value: "noun" } as const;
    assert.deepEqual(planWrite(noun, word({ id: "a", wordClass: "noun" })), {
      skip: "same",
    });
    assert.deepEqual(planWrite(noun, word({ id: "a", wordClass: "verb" })), {
      write: noun,
    });

    const flat = { kind: "style", value: "flat" } as const;
    assert.deepEqual(planWrite(flat, word({ id: "a" })), { skip: "same" });
    assert.deepEqual(
      planWrite(flat, word({ id: "a", imageStyle: "realistic" })),
      { write: flat },
    );
  });
});

describe("losingPicture, the confirmation's list", () => {
  const withPicture = word({
    id: "chart",
    representation: "figure",
    suggestedRepresentation: "metalanguage",
    imageUrl: "https://x/chart.png",
  });
  const noPicture = word({
    id: "of",
    representation: "figure",
    suggestedRepresentation: "metalanguage",
  });
  const drawing = word({
    id: "apple",
    representation: "figure",
    suggestedRepresentation: "photo",
    imageUrl: "https://x/apple.png",
  });

  test("names only words with an approved picture moving to a kind that draws nothing", () => {
    const list = losingPicture({ kind: "representation", value: "none" }, [
      withPicture,
      noPicture,
      drawing,
    ]);
    assert.deepEqual(
      list.map((item) => [item.word.term, item.kind]),
      [
        ["chart", "none"],
        ["apple", "none"],
      ],
    );
  });

  test("a kind that draws asks about nobody", () => {
    assert.deepEqual(
      losingPicture({ kind: "representation", value: "photo" }, [
        withPicture,
        drawing,
      ]),
      [],
    );
  });

  test("accepting suggestions asks about each word with its own kind", () => {
    const list = losingPicture({ kind: "accept" }, [
      withPicture,
      noPicture,
      drawing,
    ]);
    assert.deepEqual(
      list.map((item) => [item.word.term, item.kind]),
      [["chart", "metalanguage"]],
    );
  });

  test("a word that already has the kind is not asked about", () => {
    assert.deepEqual(
      losingPicture({ kind: "representation", value: "none" }, [
        word({ id: "x", representation: "none", imageUrl: "https://x/x.png" }),
      ]),
      [],
    );
  });

  test("the warning is the single-word one, in the plural", () => {
    assert.equal(
      reclassifyWarningMany(["Metalinguagem"]),
      "A imagem sai destas palavras, porque metalinguagem não leva imagem. As imagens continuam na lista como candidatas, com os arquivos, e podem ser aprovadas de novo se você mudar o tipo outra vez.",
    );
    assert.match(
      reclassifyWarningMany(["Metalinguagem", "Nada", "Uso", "Nada"]),
      /porque metalinguagem, nada e uso não levam imagem\./u,
    );
  });
});

describe("setBlocker", () => {
  test("two free words make a set", () => {
    assert.equal(setBlocker([word({ id: "a" }), word({ id: "b" })]), null);
  });

  test("fewer than two cannot", () => {
    assert.equal(
      setBlocker([word({ id: "a" })]),
      "Um conjunto precisa de pelo menos duas palavras.",
    );
  });

  test("a word already in a set blocks it, named", () => {
    assert.equal(
      setBlocker([word({ id: "large", inSet: true }), word({ id: "small" })]),
      "large já está em um conjunto.",
    );
    assert.equal(
      setBlocker([
        word({ id: "large", inSet: true }),
        word({ id: "small", inSet: true }),
      ]),
      "large, small já estão em conjuntos.",
    );
  });
});

describe("subjectPlan", () => {
  test("never asks over an instruction the word already has", () => {
    assert.equal(
      subjectPlan(
        word({ id: "a", representation: "photo", imageSubject: "a red apple" }),
      ),
      "has-one",
    );
  });

  test("asks for a word that draws and has none", () => {
    assert.equal(
      subjectPlan(word({ id: "a", representation: "photo" })),
      "ask",
    );
  });

  test("does not ask for a word that is undecided or draws nothing", () => {
    assert.equal(subjectPlan(word({ id: "a" })), "no-picture");
    assert.equal(
      subjectPlan(word({ id: "a", representation: "metalanguage" })),
      "no-picture",
    );
  });
});

describe("inPool", () => {
  test("never runs more than the limit at once, and keeps the order", async () => {
    let running = 0;
    let most = 0;
    const seen: number[] = [];
    const results = await inPool(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        running++;
        most = Math.max(most, running);
        await new Promise((wake) => setTimeout(wake, 8 - n));
        running--;
        return n * 10;
      },
      (finished) => seen.push(finished),
    );
    assert.equal(most, 3);
    assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70]);
    assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("bulk notices", () => {
  const termOf = (id: string) => id;

  test("a value written in every word", () => {
    assert.deepEqual(
      bulkNotice(
        { kind: "representation", value: "symbol" },
        [
          { id: "a", outcome: "written" },
          { id: "b", outcome: "written" },
          { id: "c", outcome: "written" },
        ],
        termOf,
      ),
      { kind: "success", text: "3 palavras: tipo alterado para símbolo." },
    );
    assert.deepEqual(
      bulkNotice(
        { kind: "wordClass", value: "noun" },
        [{ id: "a", outcome: "written" }],
        termOf,
      ),
      { kind: "success", text: "1 palavra: classe alterada para substantivo." },
    );
    assert.deepEqual(
      bulkNotice(
        { kind: "style", value: "realistic" },
        [
          { id: "a", outcome: "written" },
          { id: "b", outcome: "written" },
          { id: "c", outcome: "skipped", reason: "same" },
        ],
        termOf,
      ),
      {
        kind: "success",
        text: "2 palavras: estilo alterado para realista, 1 já estava.",
      },
    );
  });

  test("accepting suggestions counts the words without one", () => {
    assert.deepEqual(
      bulkNotice(
        { kind: "accept" },
        [
          { id: "a", outcome: "written" },
          { id: "b", outcome: "written" },
          { id: "c", outcome: "skipped", reason: "no-suggestion" },
        ],
        termOf,
      ),
      { kind: "success", text: "2 sugestões aceitas, 1 sem sugestão." },
    );
    assert.deepEqual(
      bulkNotice(
        { kind: "accept" },
        [
          { id: "a", outcome: "written" },
          { id: "b", outcome: "skipped", reason: "same" },
        ],
        termOf,
      ),
      { kind: "success", text: "1 sugestão aceita, 1 já aceita." },
    );
  });

  test("a failure names the words, gives the reason and says what went through", () => {
    assert.deepEqual(
      bulkNotice(
        { kind: "representation", value: "symbol" },
        [
          { id: "chart", outcome: "failed", error: "permission denied" },
          { id: "apple", outcome: "written" },
          { id: "of", outcome: "failed", error: "permission denied" },
        ],
        termOf,
      ),
      {
        kind: "error",
        text: "Tipo não gravado em 2 palavras: chart, of. permission denied. 1 foi gravada.",
      },
    );
    assert.deepEqual(
      bulkNotice(
        { kind: "accept" },
        [{ id: "chart", outcome: "failed", error: "x" }],
        termOf,
      ).text,
      "Sugestão não aceita em 1 palavra: chart. x. Nenhuma outra foi aceita.",
    );
  });

  test("Gerar instrução stays until closed, and never counts a zero", () => {
    assert.deepEqual(
      subjectsNotice({ generated: 4, had: 5, noPicture: 0, failed: [] }),
      {
        kind: "success",
        text: "4 instruções geradas, 5 já tinham.",
        stays: true,
      },
    );
    assert.equal(
      subjectsNotice({ generated: 1, had: 0, noPicture: 2, failed: [] }).text,
      "1 instrução gerada, 2 sem tipo que leve imagem.",
    );
    assert.deepEqual(
      subjectsNotice({
        generated: 3,
        had: 0,
        noPicture: 0,
        failed: [
          { term: "of", error: "O modelo não devolveu uma instrução legível." },
        ],
      }),
      {
        kind: "error",
        text: "Instrução não gerada em 1 palavra: of. O modelo não devolveu uma instrução legível. 3 foram geradas.",
      },
    );
  });

  test("a write that failed whole says how many words it was for", () => {
    assert.deepEqual(bulkError(12, "permission denied"), {
      kind: "error",
      text: "12 palavras: permission denied.",
    });
  });
});
