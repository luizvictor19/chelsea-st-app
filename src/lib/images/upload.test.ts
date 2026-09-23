import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_UPLOAD_BYTES,
  refuseUpload,
  sniffImageType,
  tooBig,
  uploadExtension,
} from "./upload.ts";

/** The first bytes of each format, padded to the twelve the sniffer reads. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
// RIFF, a four byte size, then WEBP.
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
// RIFF too, but a WAVE: the size in between is why the tail is checked.
const WAVE = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0];
const SVG = [...new TextEncoder().encode("<svg xmlns=")];

function bytes(values: readonly number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffImageType", () => {
  test("reads PNG, JPEG and WebP from their first bytes", () => {
    assert.equal(sniffImageType(bytes(PNG)), "image/png");
    assert.equal(sniffImageType(bytes(JPEG)), "image/jpeg");
    assert.equal(sniffImageType(bytes(WEBP)), "image/webp");
  });

  test("refuses what is not one of the three", () => {
    assert.equal(sniffImageType(bytes(WAVE)), null);
    assert.equal(sniffImageType(bytes(GIF)), null);
    assert.equal(sniffImageType(bytes(SVG)), null);
  });

  test("refuses a file shorter than the signature it would need", () => {
    assert.equal(sniffImageType(bytes([])), null);
    assert.equal(sniffImageType(bytes(PNG.slice(0, 4))), null);
    assert.equal(sniffImageType(bytes(WEBP.slice(0, 10))), null);
  });
});

describe("refuseUpload", () => {
  const fine = { size: 900_000, type: "image/png", kind: "photo" };

  test("lets a finished PNG through on a word that takes a picture", () => {
    assert.equal(refuseUpload(fine), null);
    for (const kind of ["photo", "pose", "action", "figure"]) {
      assert.equal(refuseUpload({ ...fine, kind }), null, kind);
    }
  });

  test("refuses a word whose kind carries no picture, or no kind yet", () => {
    for (const kind of ["symbol", "usage", "metalanguage", "none"]) {
      assert.notEqual(refuseUpload({ ...fine, kind }), null, kind);
    }
    assert.notEqual(refuseUpload({ ...fine, kind: null }), null);
  });

  test("refuses an empty file", () => {
    assert.equal(refuseUpload({ ...fine, size: 0 }), "O arquivo está vazio.");
  });

  test("refuses a type the bucket should not serve, SVG above all", () => {
    for (const type of ["image/svg+xml", "image/gif", "application/pdf"]) {
      assert.notEqual(refuseUpload({ ...fine, type }), null, type);
    }
  });

  test("lets an empty declared type through, for the bytes to decide", () => {
    assert.equal(refuseUpload({ ...fine, type: "" }), null);
  });

  test("the limit is 2 MB, inclusive, and above it the file is too big", () => {
    assert.equal(MAX_UPLOAD_BYTES, 2 * 1024 * 1024);
    assert.equal(refuseUpload({ ...fine, size: MAX_UPLOAD_BYTES }), null);
    assert.equal(
      refuseUpload({ ...fine, size: MAX_UPLOAD_BYTES + 1 }),
      tooBig(MAX_UPLOAD_BYTES + 1),
    );
  });

  test("the size is checked before the kind, so the sentence is about the file", () => {
    assert.equal(
      refuseUpload({ ...fine, size: 5 * 1024 * 1024, kind: "symbol" }),
      tooBig(5 * 1024 * 1024),
    );
  });
});

describe("tooBig", () => {
  test("says the file is too big, how big, and the limit", () => {
    assert.equal(
      tooBig(3.4 * 1024 * 1024),
      "Arquivo grande demais (3,4 MB). O limite é 2 MB.",
    );
  });

  test("never rounds a file just over the limit down to the limit", () => {
    assert.equal(
      tooBig(MAX_UPLOAD_BYTES + 1),
      "Arquivo grande demais (2,1 MB). O limite é 2 MB.",
    );
  });
});

describe("uploadExtension", () => {
  test("names the file for its real type", () => {
    assert.equal(uploadExtension("image/png"), "png");
    assert.equal(uploadExtension("image/jpeg"), "jpg");
    assert.equal(uploadExtension("image/webp"), "webp");
  });
});
