// Relative, with the extension: claude-failure.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import Anthropic from "@anthropic-ai/sdk";

import {
  ClaudeKeyMissingError,
  ClaudeStopError,
} from "../../../../lib/text/claude.ts";

/**
 * What the teacher reads when a Claude call fails (#187). The reason in
 * English goes to the console through the action's `cause`; this is the
 * sentence that says what to do.
 *
 * Checked from the most specific to the most general, with the SDK's own
 * classes: an OverloadedError (529) is an InternalServerError, and both mean
 * the same thing to her.
 */

/** No key here, as in a preview by decision, or a key refused. */
export const CLAUDE_NOT_CONFIGURED =
  "A sugestão de instrução não está configurada aqui.";

/** Still failing after the SDK's own retries. */
export const CLAUDE_NO_ANSWER =
  "O Claude não respondeu agora. Tente de novo em instantes.";

/**
 * A request the API refused as such: most likely the Console account (no
 * credit left) or the model id, which a retry does not fix.
 */
export const CLAUDE_REFUSED_REQUEST =
  "O Claude recusou o pedido. Confira o crédito e o modelo no Claude Console.";

/** A refusal, or an answer cut at max_tokens. */
export const CLAUDE_STOPPED =
  "O modelo não devolveu uma instrução. Tente de novo ou escreva à mão.";

export const SCENE_SUGGESTION_FAILED = "Não consegui pedir a instrução.";

export function claudeFailure(cause: unknown): string {
  if (
    cause instanceof ClaudeKeyMissingError ||
    cause instanceof Anthropic.AuthenticationError ||
    cause instanceof Anthropic.PermissionDeniedError
  ) {
    return CLAUDE_NOT_CONFIGURED;
  }
  if (
    cause instanceof Anthropic.RateLimitError ||
    cause instanceof Anthropic.InternalServerError ||
    cause instanceof Anthropic.RequestTimeoutError ||
    // APIConnectionTimeoutError is one of these.
    cause instanceof Anthropic.APIConnectionError ||
    // The call's deadline (deadlineMs), which is the only abort there is.
    cause instanceof Anthropic.APIUserAbortError
  ) {
    return CLAUDE_NO_ANSWER;
  }
  if (
    cause instanceof Anthropic.BadRequestError ||
    cause instanceof Anthropic.NotFoundError
  ) {
    return CLAUDE_REFUSED_REQUEST;
  }
  if (cause instanceof ClaudeStopError) return CLAUDE_STOPPED;
  return SCENE_SUGGESTION_FAILED;
}
