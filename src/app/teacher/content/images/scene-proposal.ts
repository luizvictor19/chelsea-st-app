// Relative, with the extension: scene-proposal.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { EDIT_KEPT } from "./subject-store.ts";

/**
 * How a proposed Instrução lands in the scene panel's field (#187).
 *
 * The field is screen state: it is kept only on the attempt, when the
 * teacher generates, so a text typed there and not generated yet exists
 * nowhere else. Nothing here may lose it without a way back.
 *
 * - The field did not change while the model was thinking: the proposal
 *   fills it, and the text it replaced goes on the stack Desfazer pops.
 * - It changed: the edit stays, and the note carries the proposal, which was
 *   paid for and can still be copied.
 * - The proposal is the text already there: nothing moves.
 *
 * A stack and not one text, and typing does not clear it: with one text, a
 * second suggestion, or a letter changed in the first one, would drop the
 * teacher's own text without a word. Desfazer after typing throws the typing
 * away, but that is a tap she makes looking at it.
 */
export type SceneProposal = {
  /** The texts each suggestion replaced, oldest first. */
  readonly undo: readonly string[];
  /** The line under the field, or null for none. */
  readonly note: string | null;
};

export const NO_PROPOSAL: SceneProposal = { undo: [], note: null };

export const SUGGESTED = "Instrução sugerida.";
export const SAME_TEXT = "A sugestão é o texto que já estava no campo.";

export function landSceneProposal(
  atRequest: string,
  now: string,
  proposal: string,
  before: SceneProposal,
): {
  readonly field: string;
  /** True when the proposal went into the field. */
  readonly filled: boolean;
  readonly state: SceneProposal;
} {
  if (now !== atRequest) {
    return {
      field: now,
      filled: false,
      state: {
        undo: before.undo,
        note: `${EDIT_KEPT} A sugestão foi: ${proposal}`,
      },
    };
  }
  if (proposal === atRequest) {
    return {
      field: now,
      filled: false,
      state: { undo: before.undo, note: SAME_TEXT },
    };
  }
  return {
    field: proposal,
    filled: true,
    state: { undo: [...before.undo, atRequest], note: SUGGESTED },
  };
}

/** Desfazer: the text the last suggestion replaced, or null for none. */
export function undoProposal(
  state: SceneProposal,
): { readonly field: string; readonly state: SceneProposal } | null {
  const field = state.undo.at(-1);
  if (field === undefined) return null;
  const undo = state.undo.slice(0, -1);
  return { field, state: { undo, note: undo.length > 0 ? SUGGESTED : null } };
}
