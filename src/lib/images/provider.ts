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
 * `preferredForReference` marks the one a new reference is generated on. It
 * is a judgement and it has to be, so see defaultReferenceModel for what it
 * was judged on and how thin the evidence is.
 */
export const IMAGE_MODELS = [
  {
    id: "seedream-v4",
    label: "Seedream 4",
    credits: 50,
    reference: "none",
    preferredForReference: false,
  },
  {
    id: "mystic",
    label: "Mystic",
    credits: 80,
    reference: "base64",
    preferredForReference: false,
  },
  {
    /**
     * 150 credits, measured on 2026-09-19 on the Freepik dashboard, read
     * immediately before and after one isolated generation: 2830 to 2980.
     * One sample. It makes Kontext the dearest of the three — 50, 80, 150 —
     * and it is still the one a reference is generated on; see
     * defaultReferenceModel, where that is argued rather than assumed.
     */
    id: "flux-kontext-pro",
    label: "Flux Kontext Pro",
    credits: 150,
    reference: "url",
    preferredForReference: true,
  },
] as const satisfies readonly {
  id: string;
  label: string;
  credits: number | null;
  reference: "none" | "base64" | "url";
  preferredForReference: boolean;
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
 * The model attaching a reference moves to, or null when none is marked.
 *
 * It used to be "the first that takes a reference and has a measured price".
 * Once Kontext's price was measured both models satisfied that, and it
 * quietly went back to deciding by array order, which is the thing its own
 * test called fragile. So the choice is a flag on the model now, and the flag
 * carries a reason.
 *
 * THE REASON, and it is one word of evidence. On 2026-09-19, same reference
 * and same instruction on `pen`: Kontext returned the only picture that was
 * both legible and in the flat style. Mystic at structure_strength 50 came
 * back rendered like a catalogue photograph, and at 25 it kept the style but
 * lost the transparent barrel that makes a pen read as a pen.
 *
 * ONE WORD. That is a sample of one, and it is written here so a second word
 * that disagrees can overturn it without anyone having to guess where the
 * choice came from. It is also the dearest of the three at 150 credits
 * against 80 and 50, so the disagreement is worth looking for.
 *
 * The invariants the flag has to keep — exactly one model marked, it takes a
 * reference, its price is measured — are in the test rather than in a chain
 * of conditions here. The default must never spend a price nobody checked,
 * and a failing test says so louder than a silent fallback would.
 */
export function defaultReferenceModel(): ImageModelId | null {
  return IMAGE_MODELS.find((model) => model.preferredForReference)?.id ?? null;
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
