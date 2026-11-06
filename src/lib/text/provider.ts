/**
 * Text completion behind one interface, the same shape the image provider
 * uses and for the same reason: the code that asks a question should not know
 * which company answers it, so swapping the model touches one file.
 */

/**
 * The tokens one call was billed for, as the provider reported them.
 *
 * Three numbers because those are the three prices every provider measured
 * so far charges at: input read at the full rate, input served from the
 * provider's cache, and output. `inputTokens` never includes the cached part,
 * so a cost is the sum of each count times its own price and nothing is
 * counted twice. Output includes any reasoning the model did before
 * answering, which is billed as output.
 */
export type TextUsage = {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
};

export interface TextProvider {
  complete(input: { system: string; user: string; json: true }): Promise<{
    text: string;
    model: string;
    /** Null when the response carried no usage the provider could read. */
    usage: TextUsage | null;
  }>;
}
