/**
 * Image generation behind one interface, so the rest of the app never learns
 * which company is drawing the pictures. The measurement this phase exists for
 * compares models, and a comparison is only honest if swapping the provider
 * touches one file.
 */

export type PollResult = {
  readonly status: "pending" | "done" | "failed";
  readonly imageUrl?: string;
  readonly error?: string;
  readonly creditsSpent?: number;
};

export interface ImageProvider {
  generate(input: {
    prompt: string;
    model: string;
  }): Promise<{ requestId: string }>;
  poll(requestId: string): Promise<PollResult>;
}

/**
 * The models the screen offers, provider neutral so the screen can name them
 * without importing the provider.
 *
 * Seedream 4 is the only one, and so the default: chosen on 2026-09-19 after
 * a one-sample comparison against Mystic 2.5. Attempts already recorded with
 * model 'mystic' stay as
 * they are: model is a plain text column and what a past attempt was drawn
 * with is a fact about that attempt, not a setting to migrate.
 *
 * 50 credits per image. Measured on 2026-09-19 against the Freepik dashboard,
 * where "API keys spent" went from 0 to 100 over two generations. The API
 * does not report the charge, so this figure comes from the dashboard and
 * image_attempts.credits_spent stays null.
 */
export const IMAGE_MODELS = [
  { id: "seedream-v4", label: "Seedream 4" },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function isImageModelId(value: string): value is ImageModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}
