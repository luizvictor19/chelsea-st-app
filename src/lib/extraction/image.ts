import {
  SHADE_BLUE_OVER_RED,
  SHADE_RED_MAX,
  SHADE_RED_MIN,
  TARGET_WIDTH,
} from "./constants.ts";
import type { Bitmap } from "./types.ts";

/** A per-pixel boolean plane, one byte each, row-major. */
export type Mask = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

const LANCZOS_RADIUS = 3;

function lanczos(x: number): number {
  if (x === 0) {
    return 1;
  }
  if (Math.abs(x) >= LANCZOS_RADIUS) {
    return 0;
  }
  const piX = Math.PI * x;
  return (
    (LANCZOS_RADIUS * Math.sin(piX) * Math.sin(piX / LANCZOS_RADIUS)) /
    (piX * piX)
  );
}

type Kernel = {
  readonly starts: Int32Array;
  readonly weights: Float32Array;
  readonly taps: number;
};

/**
 * Precomputes, for each output pixel, which input pixels feed it and by how
 * much. Weights are normalised per output pixel so a flat region keeps its
 * exact value instead of drifting.
 */
function buildKernel(sourceSize: number, targetSize: number): Kernel {
  const scale = targetSize / sourceSize;
  // Downscaling widens the filter, otherwise it samples between pixels and
  // aliases; upscaling leaves it at its natural width.
  const filterScale = scale < 1 ? scale : 1;
  const support = LANCZOS_RADIUS / filterScale;
  const taps = Math.min(sourceSize, Math.ceil(support * 2) + 2);

  const starts = new Int32Array(targetSize);
  const weights = new Float32Array(targetSize * taps);

  for (let i = 0; i < targetSize; i += 1) {
    const center = (i + 0.5) / scale - 0.5;
    let start = Math.ceil(center - support);
    if (start < 0) {
      start = 0;
    }
    if (start + taps > sourceSize) {
      start = Math.max(0, sourceSize - taps);
    }
    starts[i] = start;

    let total = 0;
    for (let tap = 0; tap < taps; tap += 1) {
      const source = start + tap;
      const weight =
        source < sourceSize ? lanczos((source - center) * filterScale) : 0;
      weights[i * taps + tap] = weight;
      total += weight;
    }
    if (total !== 0) {
      for (let tap = 0; tap < taps; tap += 1) {
        weights[i * taps + tap] /= total;
      }
    }
  }

  return { starts, weights, taps };
}

/**
 * Lanczos-3 resample, separable: horizontal first into a float buffer, then
 * vertical into bytes.
 *
 * Written out rather than delegated to a canvas on purpose. The teacher's
 * browser and the calibration script in node have to produce the same pixels,
 * or a threshold measured in one does not describe the other.
 */
export function resize(image: Bitmap, width: number, height: number): Bitmap {
  if (image.width === width && image.height === height) {
    return image;
  }

  const horizontalKernel = buildKernel(image.width, width);
  const horizontal = new Float32Array(image.height * width * 4);

  for (let y = 0; y < image.height; y += 1) {
    const sourceRow = y * image.width * 4;
    const targetRow = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const start = horizontalKernel.starts[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let tap = 0; tap < horizontalKernel.taps; tap += 1) {
        const weight =
          horizontalKernel.weights[x * horizontalKernel.taps + tap];
        if (weight === 0) {
          continue;
        }
        const offset = sourceRow + (start + tap) * 4;
        r += image.data[offset] * weight;
        g += image.data[offset + 1] * weight;
        b += image.data[offset + 2] * weight;
        a += image.data[offset + 3] * weight;
      }
      const target = targetRow + x * 4;
      horizontal[target] = r;
      horizontal[target + 1] = g;
      horizontal[target + 2] = b;
      horizontal[target + 3] = a;
    }
  }

  const verticalKernel = buildKernel(image.height, height);
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const start = verticalKernel.starts[y];
    const targetRow = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let tap = 0; tap < verticalKernel.taps; tap += 1) {
        const weight = verticalKernel.weights[y * verticalKernel.taps + tap];
        if (weight === 0) {
          continue;
        }
        const offset = ((start + tap) * width + x) * 4;
        r += horizontal[offset] * weight;
        g += horizontal[offset + 1] * weight;
        b += horizontal[offset + 2] * weight;
        a += horizontal[offset + 3] * weight;
      }
      const target = targetRow + x * 4;
      output[target] = r;
      output[target + 1] = g;
      output[target + 2] = b;
      output[target + 3] = a;
    }
  }

  return { width, height, data: output };
}

/**
 * Brings a page to the reference width, so the teacher's choice of zoom stops
 * mattering. Every threshold downstream is expressed in pixels at this width.
 */
export function normalise(image: Bitmap): Bitmap {
  if (image.width === TARGET_WIDTH) {
    return image;
  }
  const height = Math.round((image.height * TARGET_WIDTH) / image.width);
  return resize(image, TARGET_WIDTH, height);
}

/**
 * Marks the pixels of the shaded panel that holds vocabulary and grammar.
 *
 * Matched as a relation between channels rather than an exact colour, so a
 * screenshot that has been rescaled or recompressed still registers.
 */
export function shadedMask(image: Bitmap): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let i = 0, pixel = 0; i < data.length; i += 1, pixel += 4) {
    const red = image.data[pixel];
    const blue = image.data[pixel + 2];
    data[i] =
      blue > red + SHADE_BLUE_OVER_RED &&
      red < SHADE_RED_MAX &&
      red > SHADE_RED_MIN
        ? 1
        : 0;
  }
  return { width: image.width, height: image.height, data };
}

/**
 * The leftmost shaded column, which every other measurement is relative to: the
 * point numbers sit to its left, the text column starts on it.
 *
 * Falls back to a tenth of the width on a page with no panel at all, which is
 * what the prototype did and what keeps a dictation page readable.
 */
export function boxLeft(mask: Mask): number {
  for (let x = 0; x < mask.width; x += 1) {
    for (let y = 0; y < mask.height; y += 1) {
      if (mask.data[y * mask.width + x] === 1) {
        return x;
      }
    }
  }
  return Math.trunc(mask.width * 0.1);
}

/**
 * Rectangular crop. `right` and `bottom` are exclusive.
 *
 * Throws on a rectangle it cannot honour rather than returning an empty bitmap.
 * Silently handing back zero pixels moves the failure somewhere far away, where
 * it surfaces as a canvas complaining about a zero width and says nothing about
 * which crop asked for it.
 */
export function crop(
  image: Bitmap,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Bitmap {
  const width = right - left;
  const height = bottom - top;
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(top) ||
    !Number.isInteger(right) ||
    !Number.isInteger(bottom) ||
    width <= 0 ||
    height <= 0 ||
    left < 0 ||
    top < 0 ||
    right > image.width ||
    bottom > image.height
  ) {
    throw new Error(
      `crop asked for [${left}, ${top}, ${right}, ${bottom}] of a ${image.width}x${image.height} image`,
    );
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(source, source + width * 4), y * width * 4);
  }
  return { width, height, data };
}
