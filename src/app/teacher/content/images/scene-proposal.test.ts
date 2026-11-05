import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SUGGESTED,
  afterTyping,
  landSceneProposal,
  proposalNote,
} from "./scene-proposal.ts";
import { EDIT_KEPT } from "./subject-store.ts";

const LINE = "No, the box isn’t small; it’s large";
const PROPOSAL = "one large cardboard box on the floor";

describe("landSceneProposal", () => {
  test("a field untouched during the wait takes the proposal, and keeps the old text to undo", () => {
    const landed = landSceneProposal(LINE, LINE, PROPOSAL);
    assert.deepEqual(landed, {
      field: PROPOSAL,
      state: { kind: "filled", previous: LINE },
    });
    assert.equal(proposalNote(landed.state), SUGGESTED);
  });

  test("a field edited during the wait keeps the edit, with no undo, and the proposal in the note", () => {
    const edited = "a big box";
    const landed = landSceneProposal(LINE, edited, PROPOSAL);
    assert.equal(landed.field, edited);
    assert.deepEqual(landed.state, { kind: "kept", proposal: PROPOSAL });
    assert.equal(
      proposalNote(landed.state),
      `${EDIT_KEPT} A sugestão foi: ${PROPOSAL}`,
    );
  });

  test("a proposal equal to the text already there leaves nothing to undo", () => {
    assert.deepEqual(landSceneProposal(PROPOSAL, PROPOSAL, PROPOSAL), {
      field: PROPOSAL,
      state: null,
    });
    assert.equal(proposalNote(null), null);
  });

  test("an empty field is still a text to go back to", () => {
    assert.deepEqual(landSceneProposal("", "", PROPOSAL).state, {
      kind: "filled",
      previous: "",
    });
  });
});

describe("afterTyping", () => {
  test("typing drops Desfazer, which would throw the typing away", () => {
    assert.equal(afterTyping({ kind: "filled", previous: LINE }), null);
  });

  test("typing keeps a proposal that was not used, so it can be copied", () => {
    const kept = { kind: "kept", proposal: PROPOSAL } as const;
    assert.equal(afterTyping(kept), kept);
    assert.equal(afterTyping(null), null);
  });
});
