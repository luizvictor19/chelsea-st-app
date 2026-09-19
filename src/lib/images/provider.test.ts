import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Constants } from "../supabase/types.ts";
import {
  IMAGE_MODELS,
  defaultModelFor,
  defaultReferenceModel,
  isImageModelId,
  modelCredits,
  referenceDelivery,
  takesReference,
} from "./provider.ts";

const KINDS = Constants.public.Enums.representation_kind;

describe("IMAGE_MODELS", () => {
  /*
   * Three since 2026-09-19, when Flux Kontext Pro went in to stop Mystic
   * being the only way to generate from a reference at all. Flux 2 Pro is
   * still out: its price is unmeasured too, and it brings nothing Kontext
   * does not.
   */
  test("has three models, each with a distinct id and label", () => {
    assert.equal(IMAGE_MODELS.length, 3);
    const ids = IMAGE_MODELS.map((model) => model.id);
    assert.equal(new Set(ids).size, 3);
    const labels = IMAGE_MODELS.map((model) => model.label);
    assert.equal(new Set(labels).size, 3);
  });

  /*
   * Both measured on the Freepik dashboard on 2026-09-19, each against "API
   * keys spent". The numbers are here as well as in the constant because the
   * comparison this phase exists for is read against them: Mystic costing 60%
   * more is the thing its results have to pay for, and a silent edit to
   * either number would move the bar without moving anything visible.
   */
  test("knows what the two measured models cost, and how they differ", () => {
    assert.equal(modelCredits("seedream-v4"), 50);
    assert.equal(modelCredits("mystic"), 80);
  });

  /*
   * Measured on the dashboard on 2026-09-19, 2830 to 2980 across one isolated
   * generation. One sample, and it makes Kontext the dearest of the three.
   */
  test("knows what Kontext costs, and that it is the dearest", () => {
    assert.equal(modelCredits("flux-kontext-pro"), 150);
    assert.equal(modelCredits("mystic"), 80);
    assert.equal(modelCredits("seedream-v4"), 50);
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

describe("takesReference", () => {
  /*
   * Read off the Freepik documentation on 2026-09-19. Seedream takes no input
   * image at all; Mystic takes structure_reference in base64; Kontext takes
   * input_image as a URL.
   */
  test("Mystic and Kontext take one, Seedream does not", () => {
    assert.equal(takesReference("mystic"), true);
    assert.equal(takesReference("flux-kontext-pro"), true);
    assert.equal(takesReference("seedream-v4"), false);
  });

  /*
   * The form is the model's and not the caller's: the same stored path
   * becomes bytes for one and an address for the other, and getting the two
   * the wrong way round is a request the API refuses.
   */
  test("each says which form it wants", () => {
    assert.equal(referenceDelivery("mystic"), "base64");
    assert.equal(referenceDelivery("flux-kontext-pro"), "url");
    assert.equal(referenceDelivery("seedream-v4"), "none");
  });

  test("takesReference and referenceDelivery never disagree", () => {
    for (const { id } of IMAGE_MODELS) {
      assert.equal(takesReference(id), referenceDelivery(id) !== "none", id);
    }
  });
});

describe("defaultReferenceModel", () => {
  /*
   * Kontext since 2026-09-19, on one word. Same reference and same
   * instruction on `pen`: it returned the only picture that was both legible
   * and in the flat style, where Mystic at 50 came back like a catalogue
   * photograph and at 25 lost the transparent barrel. The comment on the
   * function carries that, and says out loud that it is a sample of one.
   */
  test("is the model marked for it", () => {
    assert.equal(defaultReferenceModel(), "flux-kontext-pro");
  });

  /*
   * The three invariants the flag has to keep, here rather than as a chain of
   * conditions in the function: a failing test is louder than a silent
   * fallback, and the third of them is the one that spends money.
   */
  test("exactly one model is marked", () => {
    const marked = IMAGE_MODELS.filter((model) => model.preferredForReference);
    assert.equal(marked.length, 1);
  });

  test("the marked one takes a reference", () => {
    const chosen = defaultReferenceModel();
    assert.ok(chosen !== null && takesReference(chosen));
  });

  test("the marked one has a price somebody measured", () => {
    const chosen = defaultReferenceModel();
    assert.ok(chosen !== null);
    assert.notEqual(modelCredits(chosen), null);
  });

  /*
   * Not array order. Once Kontext's price was measured, the old rule — first
   * that takes a reference and has a measured price — was satisfied by both
   * and went back to deciding by position, which is exactly what this used to
   * warn about. The flag makes the choice survive a reorder.
   */
  test("does not change when the list is read in a different order", () => {
    const marked = [...IMAGE_MODELS]
      .reverse()
      .find((model) => model.preferredForReference);
    assert.equal(marked?.id, defaultReferenceModel());
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
