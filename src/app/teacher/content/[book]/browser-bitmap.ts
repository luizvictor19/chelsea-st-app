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
  const { ctx } = context(decoded.width, decoded.height);
  ctx.drawImage(decoded, 0, 0);
  decoded.close();
  const image = ctx.getImageData(0, 0, decoded.width, decoded.height);
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
