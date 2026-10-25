/**
 * Where a picture and a structure reference live in the vocabulary-images
 * bucket, for a word and for a scene.
 *
 * A word's are where they have always been: the picture under the word's id,
 * the reference under `references/` and the word's id (163 and 22 files on
 * 2026-10-24). A scene's sit under a `scenes/` folder of their own, decided by
 * Luiz on 2026-10-25 (#64), so whoever cleans the bucket can tell whose a file
 * is without asking the database. Both kinds of reference stay under
 * `references/`, which 0014 and scenes_reference_path_prefix (0030) hold, and
 * no picture goes there, which scenes_image_path_not_reference holds.
 *
 * The storage policy (0029) lets the platform admin write anywhere in the
 * bucket, so neither shape needs a policy of its own.
 */

/** The same shape as AttemptOwner, kept here so node can load this file. */
export type PathOwner = {
  readonly kind: "word" | "scene";
  readonly id: string;
};

export const REFERENCE_PREFIX = "references";

const SCENE_FOLDER = "scenes";

function ownerFolder(owner: PathOwner): string {
  return owner.kind === "word" ? owner.id : `${SCENE_FOLDER}/${owner.id}`;
}

/** An attempt's picture, generated or sent, named by the attempt's id. */
export function attemptPath(
  owner: PathOwner,
  attemptId: string,
  extension: string,
): string {
  return `${ownerFolder(owner)}/${attemptId}.${extension}`;
}

/** A structure reference, named by a fresh id so an old one is never lost. */
export function referencePath(
  owner: PathOwner,
  fileId: string,
  extension: string,
): string {
  return `${REFERENCE_PREFIX}/${ownerFolder(owner)}/${fileId}.${extension}`;
}
