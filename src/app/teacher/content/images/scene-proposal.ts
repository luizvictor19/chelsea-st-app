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
 *   fills it, and the text it replaced is kept for Desfazer.
 * - It changed: the edit stays, and the note carries the proposal, which was
 *   paid for and can still be copied.
 * - The proposal is the text already there: nothing to undo.
 */
export type SceneProposal =
  /** Filled. Desfazer puts `previous` back. */
  | { readonly kind: "filled"; readonly previous: string }
  /** The edit was kept; this is what the model proposed. */
  | { readonly kind: "kept"; readonly proposal: string };

export const SUGGESTED = "Instrução sugerida.";

export function landSceneProposal(
  atRequest: string,
  now: string,
  proposal: string,
): { readonly field: string; readonly state: SceneProposal | null } {
  if (now !== atRequest) {
    return { field: now, state: { kind: "kept", proposal } };
  }
  return {
    field: proposal,
    state:
      proposal === atRequest ? null : { kind: "filled", previous: atRequest },
  };
}

/**
 * After the teacher types in the field. Desfazer goes: undoing after an edit
 * would throw the edit away. A kept proposal stays, so it can be copied.
 */
export function afterTyping(state: SceneProposal | null): SceneProposal | null {
  return state?.kind === "filled" ? null : state;
}

/** The line under the field, or null for none. */
export function proposalNote(state: SceneProposal | null): string | null {
  if (state === null) return null;
  return state.kind === "filled"
    ? SUGGESTED
    : `${EDIT_KEPT} A sugestão foi: ${state.proposal}`;
}
