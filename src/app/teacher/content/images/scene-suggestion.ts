// Relative, with the extension: scene-suggestion.test.ts runs under node,
// which resolves neither the @/ alias nor a missing extension.
import { buildSceneSubjectPrompt } from "../../../../lib/images/scene-subject.ts";
import type { ImageStyle } from "../../../../lib/images/style.ts";
import { parseSubject } from "../../../../lib/images/subject.ts";
import type { TextProvider } from "../../../../lib/text/provider.ts";

import { claudeFailure } from "./claude-failure.ts";

/**
 * Proposing a scene's Instrução (#187, phase 2), apart from Supabase and from
 * the SDK, so the order that matters is tested under node: nobody who cannot
 * write the scene reaches the paid call.
 *
 * Nothing is written. The proposal goes back to the panel, which puts it in
 * the field; the field is kept only on the attempt, when the teacher
 * generates.
 */

export type SceneRow = {
  readonly description: string;
  readonly imageStyle: ImageStyle;
  /** Null for common content. */
  readonly schoolId: string | null;
  readonly archived: boolean;
};

export type SceneSubjectResult =
  { ok: true; subject: string } | { ok: false; error: string; cause?: string };

export type SceneSuggestionDeps = {
  /** The scene's row, or null when there is none this account can read. */
  readonly scene: () => Promise<SceneRow | null>;
  /** can_write_content, the database's rule for writing content. */
  readonly canWrite: (school: string | null) => Promise<boolean>;
  /**
   * The prompt of the oldest question that shows the scene, if any, among
   * the questions of the scene's school (null: the common ones).
   */
  readonly question: (school: string | null) => Promise<string | null>;
  /** Built only once the checks pass, so a refusal never needs the key. */
  readonly provider: () => TextProvider;
};

export const SCENE_GONE = "Essa cena não existe mais. Recarregue a página.";
/** startSceneGeneration's sentence, for a tab opened before the exclusion. */
export const SCENE_ARCHIVED = "Essa cena foi excluída. Recarregue a página.";
export const COMMON_ONLY =
  "Só quem edita o conteúdo comum pode pedir uma instrução.";
export const SCHOOL_ONLY =
  "Só quem edita o conteúdo desta escola pode pedir uma instrução.";
/** suggestSubject's sentence, for the word. */
export const UNREADABLE = "O modelo não devolveu uma instrução legível.";

function causeOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function proposeSceneSubject(
  deps: SceneSuggestionDeps,
): Promise<SceneSubjectResult> {
  const scene = await deps.scene();
  if (scene === null) return { ok: false, error: SCENE_GONE };
  if (scene.archived) return { ok: false, error: SCENE_ARCHIVED };

  /*
   * Before anything is paid for. Nothing here writes, so no policy would
   * refuse afterwards: whoever may ask is decided here, by the rule that
   * decides who may write the scene, which lives in the database.
   */
  if (!(await deps.canWrite(scene.schoolId))) {
    return {
      ok: false,
      error: scene.schoolId === null ? COMMON_ONLY : SCHOOL_ONLY,
    };
  }

  const question = await deps.question(scene.schoolId);
  const prompt = buildSceneSubjectPrompt({
    sentence: scene.description,
    question,
    style: scene.imageStyle,
  });

  let text: string;
  try {
    ({ text } = await deps.provider().complete({ ...prompt, json: true }));
  } catch (cause) {
    return { ok: false, error: claudeFailure(cause), cause: causeOf(cause) };
  }

  const subject = parseSubject(text);
  if (subject === null) {
    return { ok: false, error: UNREADABLE, cause: text };
  }
  return { ok: true, subject };
}
