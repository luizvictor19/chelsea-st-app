"use client";

import { useEffect, useRef } from "react";

import { crop } from "@/lib/extraction/image";
import type { Band, Bitmap } from "@/lib/extraction/types";

/**
 * The strip of the original page a block came from, drawn beside it.
 *
 * Painted straight onto a canvas rather than turned into a data URL and put in
 * an img. It avoids holding a second copy of every crop in state, and it keeps
 * the page where it belongs: nothing here is uploaded, and the review screen is
 * the only place the image is ever shown.
 */
export function CropCanvas({
  page,
  band,
  label,
}: {
  page: Bitmap;
  band: Band;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) {
      return;
    }
    const region = crop(page, 0, band.top, page.width, band.bottom);
    canvas.width = region.width;
    canvas.height = region.height;
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    const pixels = new Uint8ClampedArray(region.data);
    context.putImageData(
      new ImageData(pixels, region.width, region.height),
      0,
      0,
    );
  }, [page, band]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="border-rule mt-2 w-full rounded-sm border"
    />
  );
}
