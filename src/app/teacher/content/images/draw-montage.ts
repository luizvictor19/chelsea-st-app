/**
 * Draw approved pictures into one file, in the browser (#120).
 *
 * Canvas, as shrinkReference does, and for its reason: the browser already
 * does this, and it runs once per montage on one machine. Where each picture
 * goes is montageLayout's, in src/lib/images/montage.ts, tested without a
 * browser; what is left here is the part that needs one.
 */

import {
  MONTAGE_QUALITY,
  MONTAGE_SIDE,
  montageFilename,
  montageLayout,
} from "@/lib/images/montage";

/** Thrown when a picture could not be read or the canvas would not export. */
export class MontageFailed extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "MontageFailed";
  }
}

export type MontagePicture = {
  readonly label: string;
  readonly url: string;
};

/**
 * The approved pictures, joined on a white square, as a JPEG named after
 * them; see montageFilename.
 *
 * The bucket answers any origin (access-control-allow-origin: *, checked on
 * 2026-10-25), so the canvas can read the pictures. A picture the browser has
 * already cached without CORS would still taint it, which is why each one is
 * asked for under its own query string.
 */
export async function drawMontage(
  pictures: readonly MontagePicture[],
  purpose: "lado-a-lado" | "referencia",
): Promise<File> {
  const images = await Promise.all(pictures.map(({ url }) => load(url)));
  const placed = montageLayout(
    images.map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
    MONTAGE_SIDE,
  );

  const canvas = document.createElement("canvas");
  canvas.width = MONTAGE_SIDE;
  canvas.height = MONTAGE_SIDE;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new MontageFailed("O navegador não deixou desenhar a montagem.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, MONTAGE_SIDE, MONTAGE_SIDE);
  images.forEach((image, i) => {
    const { x, y, width, height } = placed[i];
    context.drawImage(image, x, y, width, height);
  });

  let blob: Blob | null;
  try {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", MONTAGE_QUALITY);
    });
  } catch (cause) {
    // toBlob throws SecurityError on a tainted canvas.
    throw new MontageFailed("O navegador recusou ler uma das imagens.", cause);
  }
  if (blob === null) {
    throw new MontageFailed("O navegador não conseguiu gerar a montagem.");
  }
  return new File(
    [blob],
    montageFilename(
      purpose,
      pictures.map(({ label }) => label),
    ),
    { type: "image/jpeg" },
  );
}

async function load(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = `${url}${url.includes("?") ? "&" : "?"}montagem=1`;
  try {
    await image.decode();
  } catch (cause) {
    throw new MontageFailed("Não consegui carregar uma das imagens.", cause);
  }
  return image;
}
