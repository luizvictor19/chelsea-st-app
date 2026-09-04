import type { Bitmap } from "@/lib/extraction/types";

function context(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Este navegador não expôs um canvas 2d.");
  }
  return { canvas, ctx };
}

/** Decodes an uploaded file into the pixels the pipeline works on. */
export async function fileToBitmap(file: File): Promise<Bitmap> {
  const decoded = await createImageBitmap(file);
  // Read the size before releasing it. close() sets width and height to zero,
  // so asking afterwards gets a zero-sized read that fails inside the canvas
  // with nothing to say where it came from.
  const { width, height } = decoded;
  if (width === 0 || height === 0) {
    decoded.close();
    throw new Error(`${file.name}: a imagem chegou sem dimensões.`);
  }
  try {
    const { ctx } = context(width, height);
    ctx.drawImage(decoded, 0, 0);
    return toBitmap(ctx.getImageData(0, 0, width, height));
  } finally {
    decoded.close();
  }
}

function toBitmap(image: ImageData): Bitmap {
  return { width: image.width, height: image.height, data: image.data };
}

/**
 * Hands pixels to the OCR engine as a canvas.
 *
 * The engine takes a canvas directly in the browser, so nothing is encoded to a
 * file on the way. It also means the page never leaves the machine.
 */
export function bitmapToCanvas(image: Bitmap): HTMLCanvasElement {
  const { canvas, ctx } = context(image.width, image.height);
  // Copied into a fresh array because ImageData insists on one backed by a
  // plain ArrayBuffer, and the pipeline makes no promise about which.
  const pixels = new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  return canvas;
}
