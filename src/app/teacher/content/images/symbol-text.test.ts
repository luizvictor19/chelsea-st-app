import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { symbolRefusal, symbolTextOf } from "./symbol-text.ts";

describe("symbolTextOf", () => {
  test("keeps the character the teacher typed, trimmed", () => {
    assert.equal(symbolTextOf("5"), "5");
    assert.equal(symbolTextOf("  12th "), "12th");
    assert.equal(symbolTextOf("2 + 2 = 4"), "2 + 2 = 4");
  });

  test("an empty or blank field is no character, never a blank one", () => {
    assert.equal(symbolTextOf(""), null);
    assert.equal(symbolTextOf("   "), null);
    // A tab and a no-break space: what the database's check refuses too.
    assert.equal(symbolTextOf("\t\u00a0"), null);
  });
});

describe("symbolRefusal", () => {
  test("says in Portuguese why the database refused the character", () => {
    assert.match(
      symbolRefusal(
        'new row for relation "vocabulary_items" violates check constraint "vocabulary_items_symbol_text_only_symbol"',
      ) ?? "",
      /não é mais Símbolo/u,
    );
    assert.match(
      symbolRefusal(
        'violates check constraint "vocabulary_items_symbol_text_not_blank"',
      ) ?? "",
      /só espaço/u,
    );
  });

  test("leaves any other refusal to the generic notice", () => {
    assert.equal(symbolRefusal("permission denied for table x"), null);
  });
});
