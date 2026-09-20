/**
 * The style half of every prompt. The teacher writes the subject and nothing
 * else: the style is not editable on the screen, because the point of having
 * one is that a few hundred pictures read as one set instead of as a few
 * hundred separate decisions.
 *
 * Decided on 2026-09-18, style 1 of three proposed. The comparison that
 * settled it is not in this repository.
 *
 * 2026-09-20: two sets rather than one. A room and a ceiling have no shape to
 * cut out of a background, and flat vector gave them nothing to be. The
 * teacher chooses the set per word and still writes no style of their own:
 * what changed is that there are two answers to pick between, not that the
 * answer became theirs to type.
 */

/** Where the subject is substituted into a medium. */
const SUBJECT_SLOT = "{subject}";

/**
 * A style is a pair, and the two halves sit at opposite ends of the prompt.
 *
 * `medium` is the first words: what this picture is, and what it is of.
 * `rest` is everything that can wait until after the category rule.
 *
 * 2026-09-19: moving the subject to the front pushed the medium to the
 * seventh sentence. An image model weighs its opening, and the medium is the
 * part Seedream obeys and Mystic used to ignore, so it is worth the first
 * words. The subject rides with it, which is what the reordering was for.
 * That is why a style is a pair and not one string: nothing of the second
 * half may creep into the first, and the first is only ever one sentence.
 */
type Style = {
  readonly medium: string;
  readonly rest: string;
};

export const STYLES = {
  /**
   * The one that was already here, unchanged.
   *
   * The wording of `rest` is not a description of a drawing somebody wanted:
   * it used to ask for bold outlines and no shading, a real generation of
   * "sitting" ignored both and came back with no outlines at all, flat shapes
   * in solid colour, a narrow palette and a soft shadow under the figure, and
   * it was better than what had been asked for. The words are the picture we
   * want now.
   *
   * The point is not that one style beats the other. It is that while the
   * constant describes a drawing nobody wants, the result is a toss-up
   * between two of them, which is what had already happened: "book" came back
   * thickly outlined and cartoonish, "sitting" came back like this, and the
   * set stopped looking like a set. Having a style per word rather than a
   * style per generation is the whole reason these constants are not editable
   * on the screen.
   */
  flat: {
    medium: "Flat vector illustration of {subject}.",
    rest:
      "Simple shapes, solid flat colors, no outlines, a limited muted palette, " +
      "plain warm off-white background, a soft shadow under the subject only, " +
      "no text, no letters, no numbers, no watermark. Minimal, clean, friendly. " +
      // 2026-09-19: the first real figure came back inside a black frame. The
      // style asked for a plain background and never said the background was
      // the whole image, so a border was not forbidden.
      "No frame, no border, the background fills the entire image.",
  },
  /**
   * For the words flat vector cannot draw: a room, a ceiling, anything that
   * is a place rather than an object with an outline.
   *
   * Proposed on 2026-09-20 and not yet measured. Every sentence of `flat`
   * above carries the date and the picture that bought it; this one carries
   * none, and the first real generations are what will put them there. Read
   * it as a starting position, not as a finding.
   *
   * "the photograph fills the entire image" rather than "the image fills the
   * entire frame", which is how it was first written: the sentence already
   * forbids a frame, and using the same word for the thing forbidden and for
   * the picture itself asks the model to hold two senses at once. This is the
   * construction that worked in flat, with the noun changed.
   */
  realistic: {
    medium: "Photograph of {subject}.",
    rest:
      "Natural light, realistic materials and depth, a plain uncluttered " +
      "setting, sharp focus, no text, no letters, no numbers, no watermark, " +
      "no frame, no border, the photograph fills the entire image.",
  },
} as const satisfies Record<string, Style>;

/** The sets a word can be drawn in. */
export type ImageStyle = keyof typeof STYLES;

/*
 * The angle is part of what the word means, not a detail of the drawing.
 *
 * 2026-09-19: "sitting" took four attempts, and what fixed it was saying the
 * view. A seated person drawn from the front does not read as seated; the
 * bent knee in profile is what says it. The subject is where the teacher
 * names the angle, so the rule asks them to.
 */
const ANGLE =
  "The viewing angle is part of the meaning: show the view the subject " +
  "names, and if it names none, choose the one that makes the posture or " +
  "the movement unmistakable.";

/*
 * 2026-09-19: "Single subject" used to live in the style, applying to every
 * category. It is an instruction for photographing one object, and it argues
 * with pose, action and figure, which are a person plus a thing or two things.
 * Asked for a man sitting on a chair under it, the model drew the chair and
 * left the man out. How many things are in the frame is a question each
 * category answers differently, so each category answers it below.
 */

/**
 * What has to be in the frame for each kind to be readable, appended after
 * the medium and before the rest of the style.
 *
 * Its own constant with its own date, kept apart from the styles because the
 * two answer different questions and were decided at different times. A style
 * says how the picture is made; this says what the picture has to contain for
 * this kind of word, and it comes straight from the category rules in
 * docs/spec-imagens.md.
 *
 * Decided on 2026-09-19.
 *
 * THESE RULES NAME NO TECHNIQUE. The medium is said once, in the style's own
 * `medium` line, and never here: these describe the content of the picture,
 * never how it is made. A rule written here says show, never draw, shoot,
 * paint or render.
 *
 * 2026-09-20, which is what the paragraph above is made of: "Draw it as a
 * diagram" and "draw the view the subject names" were written when there was
 * one medium and it was a drawing. Shared with a photographic style they
 * contradict its first sentence, so both became "show". style.test.ts holds
 * the rule, so the next one cannot arrive with a verb of its own.
 *
 * It is a change of wording and not of meaning, and it reaches every prompt,
 * including the words already approved in flat. Nothing was regenerated to
 * check it: credits are not worth spending on a rewording. So the first
 * Figura generated after this is the one to look at closely, and if it comes
 * back unlike the ones before it, this change is the first suspect.
 */
/*
 * There is no fixed character here, and the absence is the decision.
 *
 * Tried on 2026-09-19: the rules described one man, in the same words every
 * time, and three real generations came back with a chair and nobody in it
 * and two people who matched neither the description nor each other. A text
 * to image model keeps no identity between calls, and Seedream 4 takes no
 * reference image to keep one with, so a description was the only lever and
 * it did not move anything. What it did do was lengthen every pose and
 * action prompt by two sentences.
 *
 * Character consistency waits for the tutor's scene, and for a model that
 * accepts a reference image.
 */

export const SUBJECT_RULES = {
  photo: "Single subject: show it on its own, with nothing around it.",
  // No posture may be named here. "standing still" read as the posture
  // standing, which is also a word in the vocabulary, and contradicted every
  // subject that was sitting or lying.
  pose:
    "Show the whole person, and the object they are using when the subject " +
    "names one. The posture clearly readable, and no movement. No arrow. " +
    ANGLE,
  /*
   * The arrow is a drawing device, not what makes something an action. Plenty
   * of action words have no direction for one to point at (speak, listen,
   * smile, read, write, wait, hold), and asked for an arrow unconditionally
   * the model draws one anyway, pointing at nothing.
   */
  action:
    "Show the whole person, and the object they are using when the subject " +
    "names one. The person is in the middle of the movement, the gesture at " +
    "its clearest moment. If the movement has a direction, add a simple " +
    "arrow showing it; if it does not, no arrow. " +
    ANGLE,
  figure:
    "Show it as a diagram, with no person in it. Only the objects the " +
    "subject names, and nothing else in the background.",
} as const;

/** The kinds an image is generated for. symbol and none are not among them. */
export type DrawableKind = keyof typeof SUBJECT_RULES;

export function isDrawableKind(kind: string): kind is DrawableKind {
  return kind in SUBJECT_RULES;
}

/**
 * The full prompt for one word: the medium and the subject, then what this
 * kind has to show, then the rest of the style.
 *
 * 2026-09-19: the order is the fix, not the wording. The character used to be
 * the last sentence of the prompt, after eleven style constraints, and a
 * generation of "sitting" came back as an empty chair. Who is in the picture
 * belongs next to the subject; how it is drawn can wait until the end, except
 * for the medium, which belongs in the first words and takes the subject with
 * it.
 *
 * `style` has no default, deliberately. A default would be a style chosen by
 * a call site that forgot to choose one, and the picture would come back in
 * it with nothing on the screen or in the row to say why.
 *
 * Refuses twice before anything is spent. A symbol is rendered by the screen
 * as the character itself and none has no picture at all, so neither has a
 * prompt to build; and an empty subject would generate from nothing. Every
 * call costs credits, so a request that was never going to produce anything
 * useful fails here rather than after it is paid for.
 */
export function buildPrompt(
  subject: string,
  kind: string,
  style: ImageStyle,
): string {
  if (!isDrawableKind(kind)) {
    throw new Error(`No image is generated for ${kind}`);
  }
  // A trailing stop would land next to the one this sentence ends with.
  const cleaned = subject.trim().replace(/[.\s]+$/u, "");
  if (cleaned === "") {
    throw new Error("A prompt needs a subject");
  }
  const { medium, rest } = STYLES[style];
  const opening = medium.replace(SUBJECT_SLOT, cleaned);
  return `${opening} ${SUBJECT_RULES[kind]} ${rest}`;
}
