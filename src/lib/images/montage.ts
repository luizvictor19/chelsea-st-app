/**
 * Approved pictures joined into one (#120): side by side as a scene's own
 * picture, or as the reference a scene is generated from.
 *
 * The arithmetic lives here, where it can be tested without a browser; the
 * drawing is in draw-montage.ts, on a canvas, as shrinkReference does.
 */

/** Below two it is the plain upload or reference; see MONTAGE_MAX. */
export const MONTAGE_MIN = 2;

/**
 * Above four, on a 1536px square, each picture drops under a third of the
 * side, too small to read on the lesson card the scene is shown on.
 */
export const MONTAGE_MAX = 4;

/** The square's side: the size a generated picture comes back at, near it. */
export const MONTAGE_SIDE = 1536;

/** JPEG, as a reference is: a flat picture on white loses nothing at this. */
export const MONTAGE_QUALITY = 0.9;

export type Size = { readonly width: number; readonly height: number };
export type Placement = Size & { readonly x: number; readonly y: number };

/**
 * Where each picture goes on a white square of `side`: one row for two and
 * three, a 2×2 grid for four. Each picture is whole, never cropped, scaled to
 * fit its cell and centred in it, so a tall pen beside a wide book keeps both
 * shapes. The margin round the edge and between cells is the same.
 */
export function montageLayout(
  sizes: readonly Size[],
  side: number,
): readonly Placement[] {
  if (sizes.length < MONTAGE_MIN || sizes.length > MONTAGE_MAX) {
    throw new Error(
      `A montage takes ${MONTAGE_MIN} to ${MONTAGE_MAX} pictures, not ${sizes.length}`,
    );
  }
  const columns = sizes.length === 4 ? 2 : sizes.length;
  const rows = sizes.length === 4 ? 2 : 1;
  const margin = Math.round(side * 0.04);
  const cellWidth = (side - margin * (columns + 1)) / columns;
  const cellHeight = (side - margin * (rows + 1)) / rows;

  return sizes.map((size, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const scale = Math.min(cellWidth / size.width, cellHeight / size.height);
    const width = Math.max(1, Math.floor(size.width * scale));
    const height = Math.max(1, Math.floor(size.height * scale));
    const cellX = margin + column * (cellWidth + margin);
    const cellY = margin + row * (cellHeight + margin);
    return {
      x: Math.round(cellX + (cellWidth - width) / 2),
      y: Math.round(cellY + (cellHeight - height) / 2),
      width,
      height,
    };
  });
}

/**
 * The file name a montage is sent under, which is what records the pictures
 * it was made of: source_filename keeps it on the attempt, so there is no
 * column for it. "lado-a-lado-pen-book.jpg".
 */
export function montageFilename(labels: readonly string[]): string {
  const parts = labels.map(slug).filter((part) => part !== "");
  return `${["lado-a-lado", ...parts].join("-")}.jpg`;
}

/** Lower case, no accents, one hyphen between words, at most 30 characters. */
function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/^-+|-+$/g, "");
}
