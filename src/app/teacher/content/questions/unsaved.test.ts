import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createUnsavedRegistry } from "./unsaved.ts";

describe("createUnsavedRegistry", () => {
  test("a screen with nothing marked does not ask", () => {
    assert.equal(createUnsavedRegistry().any(), false);
  });

  test("forms that are open and clean do not ask", () => {
    const registry = createUnsavedRegistry();
    registry.mark("q1", false);
    registry.mark("novo:p1", false);
    assert.equal(registry.any(), false);
  });

  test("one dirty form asks", () => {
    const registry = createUnsavedRegistry();
    registry.mark("novo:p1", true);
    assert.equal(registry.any(), true);
  });

  test("the same form marked clean again no longer asks", () => {
    const registry = createUnsavedRegistry();
    registry.mark("q1", true);
    registry.mark("q1", false);
    assert.equal(registry.any(), false);
  });

  test("marking a dirty form dirty twice still takes one clean to clear", () => {
    const registry = createUnsavedRegistry();
    registry.mark("q1", true);
    registry.mark("q1", true);
    registry.mark("q1", false);
    assert.equal(registry.any(), false);
  });

  test("a clean form leaving does not clear another dirty one", () => {
    // A dirty draft in point 1 and an empty new form in point 2: the link in
    // point 2 still has to ask, since leaving drops the draft in point 1.
    const registry = createUnsavedRegistry();
    registry.mark("novo:p1", true);
    registry.mark("novo:p2", false);
    assert.equal(registry.any(), true);
  });

  test("two dirty and one back to clean still asks", () => {
    const registry = createUnsavedRegistry();
    registry.mark("q1", true);
    registry.mark("novo:p2", true);
    registry.mark("q1", false);
    assert.equal(registry.any(), true);
    registry.mark("novo:p2", false);
    assert.equal(registry.any(), false);
  });

  test("a form that closes while dirty no longer counts", () => {
    // What the hook's cleanup does when the form unmounts, or is discarded
    // with its button, still holding text.
    const registry = createUnsavedRegistry();
    registry.mark("q1", true);
    registry.mark("q1", false);
    registry.mark("novo:p1", true);
    registry.mark("novo:p1", false);
    assert.equal(registry.any(), false);
  });

  test("each registry is the screen's own", () => {
    const one = createUnsavedRegistry();
    const other = createUnsavedRegistry();
    one.mark("q1", true);
    assert.equal(other.any(), false);
  });
});
