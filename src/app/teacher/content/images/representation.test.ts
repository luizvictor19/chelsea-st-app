import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Constants } from "../../../../lib/supabase/types.ts";
import {
  FILTERS,
  REPRESENTATIONS,
  disagreement,
  matchesFilter,
} from "./representation.ts";

const ENUM = Constants.public.Enums.representation_kind;

describe("REPRESENTATIONS", () => {
  /*
   * The labels are Portuguese, so the list itself cannot come from the
   * database. What can be held is that it covers the database: a kind added
   * to the enum and forgotten here would otherwise be a button that never
   * appears and a filter that never matches, with nothing to say so.
   */
  test("labels every kind the database has", () => {
    const labelled = REPRESENTATIONS.map((item) => item.kind);
    for (const kind of ENUM) {
      assert.ok(labelled.includes(kind), `no label for ${kind}`);
    }
    assert.equal(labelled.length, ENUM.length);
  });

  test("labels nothing the database does not have", () => {
    for (const { kind } of REPRESENTATIONS) {
      assert.ok((ENUM as readonly string[]).includes(kind), `stale: ${kind}`);
    }
  });

  test("every label is filled in and distinct", () => {
    const labels = REPRESENTATIONS.map((item) => item.label);
    assert.ok(labels.every((label) => label.trim() !== ""));
    assert.equal(new Set(labels).size, labels.length);
  });
});

describe("FILTERS", () => {
  test("offers one filter per kind, plus Todas and Sem decidir", () => {
    assert.equal(FILTERS.length, ENUM.length + 2);
    for (const kind of ENUM) {
      assert.ok(
        FILTERS.some((filter) => filter.key === kind),
        kind,
      );
    }
  });

  /*
   * pose has to behave like any other kind here. It arrived last, and the
   * cost of it being special would be a filter that silently shows nothing.
   */
  test("matches each kind against itself and nothing else", () => {
    for (const kind of ENUM) {
      assert.ok(matchesFilter(kind, kind));
      for (const other of ENUM) {
        if (other !== kind) assert.ok(!matchesFilter(kind, other));
      }
      assert.ok(!matchesFilter(kind, null));
      assert.ok(matchesFilter("todas", kind));
      assert.ok(!matchesFilter("sem-decidir", kind));
    }
    assert.ok(matchesFilter("sem-decidir", null));
    assert.ok(matchesFilter("todas", null));
  });
});

describe("disagreement", () => {
  test("shows nothing while the word is undecided", () => {
    assert.equal(disagreement(null, "photo"), null);
    assert.equal(disagreement(null, null), null);
  });

  test("shows nothing when there is no suggestion to disagree with", () => {
    assert.equal(disagreement("photo", null), null);
  });

  test("shows nothing when the two agree", () => {
    for (const kind of ENUM) {
      assert.equal(disagreement(kind, kind), null);
    }
  });

  /*
   * The case the whole thing exists for: a decided lesson should read as the
   * list of places the model and the teacher differ.
   */
  test("shows the suggestion when it differs from the decision", () => {
    assert.equal(disagreement("figure", "action"), "action");
    assert.equal(disagreement("pose", "figure"), "figure");
    for (const kind of ENUM) {
      for (const other of ENUM) {
        if (other !== kind) assert.equal(disagreement(kind, other), other);
      }
    }
  });
});
