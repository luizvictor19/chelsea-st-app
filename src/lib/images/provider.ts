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
 * `credits` is what one image costs, and null means nobody knows. Both models
 * here are measured, and the Freepik dashboard is the only source for either:
 * the API reports no charge and the documented pricing page is a 404.
 *
 *   Seedream 4, 50 credits. Read on 2026-09-19, where "API keys spent" went
 *   from 0 to 100 over two generations.
 *   Mystic, 80 credits. Read by Luiz on 2026-09-19, off the same "API keys
 *   spent", immediately before and immediately after one isolated generation
 *   of the word "pen".
 *
 * Mystic costing 60% more than Seedream is a fact the comparison now has to
 * carry: a model only earns that by needing fewer attempts, and attempts per
 * approval is exactly what image_attempts is kept for.
 *
 * Null stays in the type even with nothing using it today. A model added
 * later arrives unmeasured, because measuring it takes one generation on it
 * first, and the screen has to be able to say nobody knows rather than show a
 * number someone assumed.
 *
 * Mystic returns PNG where Seedream returns JPG, which is why a stored image
 * takes its extension from the response content type and never from the URL.
 *
 * Two models and not three. Flux 2 Pro was here and came out again: today's
 * question is Seedream against Mystic, and a third API shape to handle buys
 * nothing towards answering it. Flux comes back when accepting a reference
 * image is the criterion, which belongs to the tutor's scene, and then it is
 * compared against Flux Kontext Pro and Mystic on that, with the cost
 * measured rather than unknown.
 *
 * Mystic is back. It was dropped on 2026-09-19 after one sample, judged
 * against a style constant that demanded bold outlines and no shading. That
 * style was rewritten the same day into exactly the opposite: no outlines, a
 * soft shadow, a limited muted palette. The comparison that dropped Mystic
 * was run against a description of a picture we no longer want, so its
 * verdict does not carry, and it has to be measured again.
 */
export const IMAGE_MODELS = [
  { id: "seedream-v4", label: "Seedream 4", credits: 50 },
  { id: "mystic", label: "Mystic", credits: 80 },
] as const satisfies readonly {
  id: string;
  label: string;
  credits: number | null;
}[];

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function isImageModelId(value: string): value is ImageModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}

export function modelLabel(id: ImageModelId): string {
  return IMAGE_MODELS.find((model) => model.id === id)?.label ?? id;
}

/** What one image costs on this model, or null when it is not known. */
export function modelCredits(id: ImageModelId): number | null {
  return IMAGE_MODELS.find((model) => model.id === id)?.credits ?? null;
}

/**
 * Which model a kind starts on, before the teacher says otherwise.
 *
 * These are a HYPOTHESIS, not a measurement. No photo has been generated
 * with Mystic under the current style at all: the guess is that the model
 * praised for illustration suits a single object, and that the one already
 * producing good flat diagrams and figures should keep them. The moment
 * there are numbers per kind, these change, and the numbers come from
 * comparing attempts on the same word.
 *
 * symbol and none are absent because no image is generated for them.
 */
const DEFAULT_MODEL: Record<string, ImageModelId> = {
  photo: "mystic",
  figure: "seedream-v4",
  pose: "seedream-v4",
  action: "seedream-v4",
};

export function defaultModelFor(kind: string | null): ImageModelId | null {
  if (kind === null) return null;
  return DEFAULT_MODEL[kind] ?? null;
}
