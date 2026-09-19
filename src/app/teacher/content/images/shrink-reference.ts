/**
 * Shrink a structure reference in the browser, before it is ever sent.
 *
 * A reference tells the model what shape to draw, not what detail to copy, so
 * the resolution a phone camera produces was never needed here. Reducing it
 * on this side means the teacher does not have to think about file size at
 * all, which is the point: the cap in generation.ts is a net under this, not
 * a rule anybody is meant to feel.
 *
 * Canvas and nothing else. A library to resize a picture would be a
 * dependency for something the browser already does, and this runs on one
 * machine, once per reference.
 *
 * The arithmetic lives in fitWithin, in generation.ts, where it can be tested
 * without a browser. What is left here is the part that needs one.
 */

import {
  REFERENCE_MAX_SIDE,
  REFERENCE_QUALITY,
  fitWithin,
} from "@/lib/images/generation";

/** Thrown when the file the teacher picked is not a picture this can read. */
export class NotAPicture extends Error {
  constructor(cause: unknown) {
    super("The file could not be decoded as an image", { cause });
    this.name = "NotAPicture";
  }
}

export async function shrinkReference(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    // accept="image/*" is a hint to the file picker and not a guarantee, and
    // a file that cannot be decoded has to come back as a sentence rather
    // than as whatever the browser threw.
    throw new NotAPicture(cause);
  }

  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    REFERENCE_MAX_SIDE,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    // No 2d context to draw into. Send what we were given and let the cap
    // decide: failing to shrink is not a reason to refuse the picture.
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", REFERENCE_QUALITY);
  });
  if (blob === null) return file;

  /*
   * The smaller of the two, because re-encoding does not always shrink. A
   * small flat PNG comes out larger as a JPEG, and sending the larger one to
   * save a step would be shrinking that grows the file.
   */
  if (blob.size >= file.size) return file;

  const stem = file.name.replace(/\.[^.]*$/u, "") || "referencia";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}
