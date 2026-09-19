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
    /**
     * The structure reference as base64, or null for none. Not optional: a
     * caller that has one and forgets to pass it would pay for a picture that
     * ignored it, and the attempt row would still say which file it used.
     */
    reference: string | null;
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
/**
 * `reference` says whether the model can be handed a picture to work from,
 * and in what form it wants it. Read off the Freepik documentation on
 * 2026-09-19:
 *
 *   Seedream 4 and 4.5 take no input image at all.
 *   Mystic takes structure_reference and style_reference, both base64.
 *   Flux Kontext Pro takes one, input_image, by URL.
 *   Flux 2 Pro takes up to four, base64.
 *
 * The form is a property of the model and not of the caller, which is why it
 * lives here: the same stored reference_path becomes base64 for one and a
 * public URL for the other, and only this table knows which.
 *
 * Mystic's style_reference is left out on purpose rather than for lack of
 * time. The style of these pictures comes from the style constant in the
 * prompt, the same one for all of them, which is the whole point of having
 * one: a few hundred images read as a set instead of as a few hundred
 * decisions. A style taken from whatever photo the teacher happened to upload
 * would undo that one image at a time.
 *
 * Flux 2 Pro is still out. What it costs is not documented and has not been
 * measured, and it brings nothing Kontext does not: Kontext takes its
 * reference by URL from a bucket that is already public, so it needed neither
 * base64 nor a new shape of request. It is the short road to having a second
 * way to generate from a reference at all, which is the point — on
 * 2026-09-19 Mystic was the only one, and two generations failed on it in a
 * row that evening, one with a 500 on the way in and one hanging past the 90
 * second window. Whether that was their service or the picture is not known,
 * which is exactly why one road was one too few.
 *
 * Kontext's own price is unknown too, and the screen says so rather than
 * showing a number nobody measured. That is the difference between a model
 * that is offered and one that is the default; see defaultReferenceModel.
 */
export const IMAGE_MODELS = [
  { id: "seedream-v4", label: "Seedream 4", credits: 50, reference: "none" },
  { id: "mystic", label: "Mystic", credits: 80, reference: "base64" },
  {
    id: "flux-kontext-pro",
    label: "Flux Kontext Pro",
    credits: null,
    reference: "url",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  credits: number | null;
  reference: "none" | "base64" | "url";
}[];

/** How a model wants its reference handed over, or that it takes none. */
export type ReferenceDelivery = (typeof IMAGE_MODELS)[number]["reference"];

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export function isImageModelId(value: string): value is ImageModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}

export function modelLabel(id: ImageModelId): string {
  return IMAGE_MODELS.find((model) => model.id === id)?.label ?? id;
}

/** Whether this model can be handed a picture to work from. */
export function takesReference(id: ImageModelId): boolean {
  return referenceDelivery(id) !== "none";
}

/** The form this model wants its reference in. */
export function referenceDelivery(id: ImageModelId): ReferenceDelivery {
  return IMAGE_MODELS.find((model) => model.id === id)?.reference ?? "none";
}

/**
 * The model attaching a reference moves to, or null when none will do.
 *
 * Two conditions and not one: it takes a reference, and what it costs has
 * been measured. The second is the whole rule. Attaching a reference is the
 * teacher saying "use this as the guide", and the program answering by
 * spending money on their behalf; what it spends cannot be a number nobody
 * has checked. Kontext is offered in the selector and is never the default
 * while its price is unknown.
 *
 * Read off the list rather than named, so the day Kontext's price is measured
 * this answers differently without being edited. Not "the first that takes
 * one" either: that would have been right by accident, on array order, and
 * would quietly stop being right the day somebody reordered the list for an
 * unrelated reason.
 */
export function defaultReferenceModel(): ImageModelId | null {
  return (
    IMAGE_MODELS.find(
      (model) => model.reference !== "none" && model.credits !== null,
    )?.id ?? null
  );
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
