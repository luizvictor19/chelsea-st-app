import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Constants } from "../../../../lib/supabase/types.ts";
import {
  SITUATIONS,
  matchesSelection,
  parseSelection,
  situationOf,
  toggled,
} from "./filters.ts";

const KINDS = Constants.public.Enums.representation_kind;
const EMPTY = { tipo: [], classe: [], situacao: [] } as const;

describe("situationOf", () => {
  /*
   * The four states have to partition the vocabulary: every word in exactly
   * one, so the counts add up and nothing can hide between filters.
   */
  test("puts every possible word in exactly one situation", () => {
    const seen = new Set<string>();
    for (const kind of [...KINDS, null]) {
      for (const image of ["/x.png", null]) {
        seen.add(situationOf(kind, image));
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      SITUATIONS.map((s) => s.value).toSorted(),
    );
  });

  test("undecided is undecided whether or not a file happens to exist", () => {
    assert.equal(situationOf(null, null), "sem-decidir");
    assert.equal(situationOf(null, "/x.png"), "sem-decidir");
  });

  test("none and symbol are decided, not waiting", () => {
    assert.equal(situationOf("none", null), "nao-leva");
    assert.equal(situationOf("symbol", null), "nao-leva");
  });

  test("a drawable kind is waiting until the image exists", () => {
    assert.equal(situationOf("photo", null), "sem-imagem");
    assert.equal(situationOf("photo", "/x.png"), "com-imagem");
    assert.equal(situationOf("pose", null), "sem-imagem");
    assert.equal(situationOf("figure", "/x.png"), "com-imagem");
  });
});

describe("parseSelection", () => {
  test("reads a comma separated axis and ignores the gaps", () => {
    assert.deepEqual(parseSelection("photo,pose"), ["photo", "pose"]);
    assert.deepEqual(parseSelection(" photo , , pose "), ["photo", "pose"]);
    assert.deepEqual(parseSelection(undefined), []);
    assert.deepEqual(parseSelection(""), []);
  });
});

describe("matchesSelection", () => {
  const word = {
    representation: "photo",
    wordClass: "noun",
    imageUrl: null,
  } as const;

  test("nothing selected constrains nothing", () => {
    assert.ok(matchesSelection(word, EMPTY));
  });

  test("values inside one axis are alternatives", () => {
    assert.ok(matchesSelection(word, { ...EMPTY, tipo: ["photo", "pose"] }));
    assert.ok(!matchesSelection(word, { ...EMPTY, tipo: ["pose", "figure"] }));
  });

  /*
   * The axes are ANDed. A word that matches the type but not the class has
   * to drop out, or a filter would widen the list instead of narrowing it.
   */
  test("the three axes are all required at once", () => {
    assert.ok(
      matchesSelection(word, {
        tipo: ["photo"],
        classe: ["noun"],
        situacao: ["sem-imagem"],
      }),
    );
    assert.ok(
      !matchesSelection(word, {
        tipo: ["photo"],
        classe: ["verb"],
        situacao: [],
      }),
    );
    assert.ok(
      !matchesSelection(word, {
        tipo: ["photo"],
        classe: [],
        situacao: ["com-imagem"],
      }),
    );
  });

  test("a word with no class is filtered out by any class filter", () => {
    const classless = { ...word, wordClass: null };
    assert.ok(matchesSelection(classless, EMPTY));
    assert.ok(!matchesSelection(classless, { ...EMPTY, classe: ["noun"] }));
  });
});

describe("toggled", () => {
  test("adds a value that is off and removes one that is on", () => {
    const once = toggled(EMPTY, "tipo", "photo");
    assert.deepEqual(once.tipo, ["photo"]);
    assert.deepEqual(toggled(once, "tipo", "photo").tipo, []);
  });

  test("leaves the other axes alone", () => {
    const start = { tipo: ["photo"], classe: ["noun"], situacao: [] } as const;
    const next = toggled(start, "situacao", "com-imagem");
    assert.deepEqual(next.tipo, ["photo"]);
    assert.deepEqual(next.classe, ["noun"]);
    assert.deepEqual(next.situacao, ["com-imagem"]);
  });
});
