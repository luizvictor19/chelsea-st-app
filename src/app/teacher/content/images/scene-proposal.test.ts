import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_PROPOSAL,
  SAME_TEXT,
  SUGGESTED,
  landSceneProposal,
  undoProposal,
} from "./scene-proposal.ts";
import { EDIT_KEPT } from "./subject-store.ts";

const LINE = "No, the box isn’t small; it’s large";
const OWN = "a big brown box, alone, seen from the front";
const P1 = "one large cardboard box on the floor";
const P2 = "a large box beside a small chair";

describe("landSceneProposal", () => {
  test("a field untouched during the wait takes the proposal, and keeps the old text to undo", () => {
    assert.deepEqual(landSceneProposal(LINE, LINE, P1, NO_PROPOSAL), {
      field: P1,
      filled: true,
      state: { undo: [LINE], note: SUGGESTED },
    });
  });

  test("a field edited during the wait keeps the edit, and the proposal in the note", () => {
    const edited = "a big box";
    assert.deepEqual(landSceneProposal(LINE, edited, P1, NO_PROPOSAL), {
      field: edited,
      filled: false,
      state: { undo: [], note: `${EDIT_KEPT} A sugestão foi: ${P1}` },
    });
  });

  test("a proposal equal to the text already there moves nothing, and says so", () => {
    assert.deepEqual(landSceneProposal(P1, P1, P1, NO_PROPOSAL), {
      field: P1,
      filled: false,
      state: { undo: [], note: SAME_TEXT },
    });
  });

  test("an empty field is still a text to go back to", () => {
    assert.deepEqual(landSceneProposal("", "", P1, NO_PROPOSAL).state.undo, [
      "",
    ]);
  });
});

describe("Desfazer", () => {
  test("a second suggestion does not lose the teacher's own text", () => {
    const first = landSceneProposal(OWN, OWN, P1, NO_PROPOSAL);
    const second = landSceneProposal(P1, P1, P2, first.state);
    assert.equal(second.field, P2);
    const back = undoProposal(second.state);
    assert.equal(back?.field, P1);
    assert.equal(back?.state.note, SUGGESTED);
    const own = undoProposal(back!.state);
    assert.equal(own?.field, OWN);
    assert.deepEqual(own?.state, NO_PROPOSAL);
    assert.equal(undoProposal(own!.state), null);
  });

  test("a letter changed in the proposal still leaves the way back", () => {
    const landed = landSceneProposal(OWN, OWN, P1, NO_PROPOSAL);
    // Typing does not touch the state: the panel only sets the field.
    const tweaked = `${P1}s`;
    const again = landSceneProposal(tweaked, tweaked, P2, landed.state);
    assert.deepEqual(again.state.undo, [OWN, tweaked]);
  });

  test("an edit kept during the wait leaves earlier texts to undo to", () => {
    const landed = landSceneProposal(OWN, OWN, P1, NO_PROPOSAL);
    const kept = landSceneProposal(P1, "mine now", P2, landed.state);
    assert.deepEqual(kept.state.undo, [OWN]);
    assert.equal(undoProposal(kept.state)?.field, OWN);
  });
});
