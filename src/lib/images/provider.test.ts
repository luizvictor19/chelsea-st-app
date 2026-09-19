import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Constants } from "../supabase/types.ts";
import {
  IMAGE_MODELS,
  defaultModelFor,
  isImageModelId,
  modelCredits,
} from "./provider.ts";

const KINDS = Constants.public.Enums.representation_kind;

describe("IMAGE_MODELS", () => {
  /*
   * Two, and deliberately so. Flux 2 Pro was here and came out again: today's
   * question is Seedream against Mystic, and a third API shape to handle buys
   * nothing towards answering it.
   */
  test("has two models, each with a distinct id and label", () => {
    assert.equal(IMAGE_MODELS.length, 2);
    const ids = IMAGE_MODELS.map((model) => model.id);
    assert.equal(new Set(ids).size, 2);
    const labels = IMAGE_MODELS.map((model) => model.label);
    assert.equal(new Set(labels).size, 2);
  });

  /*
   * Both measured on the Freepik dashboard on 2026-09-19, each against "API
   * keys spent". The numbers are here as well as in the constant because the
   * comparison this phase exists for is read against them: Mystic costing 60%
   * more is the thing its results have to pay for, and a silent edit to
   * either number would move the bar without moving anything visible.
   */
  test("knows what both models cost, and how they differ", () => {
    assert.equal(modelCredits("seedream-v4"), 50);
    assert.equal(modelCredits("mystic"), 80);
  });

  /*
   * Null means nobody knows, and it is the only way to say that. A model
   * added later arrives unmeasured, because measuring it takes one generation
   * on it first, and zero must never stand in for that: the screen would show
   * it as free, which is the one wrong answer that costs money.
   */
  test("says unknown with null, never with zero", () => {
    for (const { id, credits } of IMAGE_MODELS) {
      if (credits === null) continue;
      assert.ok(Number.isInteger(credits), id);
      assert.ok(credits > 0, id);
    }
  });
});

describe("defaultModelFor", () => {
  test("gives every drawable kind a model", () => {
    for (const kind of ["photo", "pose", "action", "figure"]) {
      const model = defaultModelFor(kind);
      assert.ok(model !== null, kind);
      assert.ok(isImageModelId(model), `${kind} -> ${model}`);
    }
  });

  /*
   * The hypothesis under test, written down so a change to it is visible in a
   * diff: photo starts on Mystic and everything else on Seedream. No photo
   * has been generated with Mystic under the current style, so this is a
   * starting point for the comparison and not a result of one.
   */
  test("starts photo on Mystic and the rest on Seedream", () => {
    assert.equal(defaultModelFor("photo"), "mystic");
    assert.equal(defaultModelFor("pose"), "seedream-v4");
    assert.equal(defaultModelFor("action"), "seedream-v4");
    assert.equal(defaultModelFor("figure"), "seedream-v4");
  });

  test("gives none to the kinds that generate nothing", () => {
    assert.equal(defaultModelFor("symbol"), null);
    assert.equal(defaultModelFor("none"), null);
    assert.equal(defaultModelFor(null), null);
    assert.equal(defaultModelFor("nonsense"), null);
  });

  /*
   * Every kind in the database is answered one way or the other, so a kind
   * added later cannot silently fall through to no model at all.
   */
  test("answers for every kind the database has", () => {
    for (const kind of KINDS) {
      const model = defaultModelFor(kind);
      const drawable = !["symbol", "none"].includes(kind);
      assert.equal(model !== null, drawable, kind);
    }
  });
});
