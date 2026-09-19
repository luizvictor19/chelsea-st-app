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
 * The spec asked for Mystic and Imagen 3. Imagen 3 is not in this API, so
 * Seedream 4 takes the second slot: same 50 credit band, and the point of the
 * measurement is two models of comparable price, not two particular names.
 */
export const IMAGE_MODELS = [
  { id: "mystic", label: "Mystic" },
  { id: "seedream-v4", label: "Seedream 4" },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function isImageModelId(value: string): value is ImageModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}
