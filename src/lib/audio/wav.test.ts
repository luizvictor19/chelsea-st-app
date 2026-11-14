import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BODY_SIZE_LIMIT_BYTES } from "../images/body-limit.ts";
import {
  MAX_TAKE_BYTES,
  MAX_TAKE_MS,
  TAKE_MARGIN_MS,
  WAV_HEADER_BYTES,
  encodeWav,
  readWavHeader,
  resample,
} from "./wav.ts";

function tone(hz: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return out;
}

/** The loudest sample away from the edges, where the filter has full support. */
function peak(samples: Float32Array): number {
  const margin = Math.floor(samples.length / 10);
  let max = 0;
  for (let i = margin; i < samples.length - margin; i++) {
    max = Math.max(max, Math.abs(samples[i]));
  }
  return max;
}

function ascii(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.slice(at, at + 4));
}

/** A header written by hand, to describe files encodeWav never makes. */
function header(options: {
  channels?: number;
  rate?: number;
  bits?: number;
  dataBytes: number;
  actualDataBytes?: number;
  format?: number;
}): Uint8Array {
  const channels = options.channels ?? 1;
  const rate = options.rate ?? 24_000;
  const bits = options.bits ?? 16;
  const actual = options.actualDataBytes ?? options.dataBytes;
  const bytes = new Uint8Array(44 + actual);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + options.dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, options.format ?? 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, (rate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, options.dataBytes, true);
  return bytes;
}

describe("encodeWav", () => {
  test("writes the 44 byte PCM header, little endian", () => {
    const bytes = encodeWav(new Float32Array([0, 0.5, -0.5]), 24_000);
    const view = new DataView(bytes.buffer);
    assert.equal(bytes.length, WAV_HEADER_BYTES + 6);
    assert.equal(ascii(bytes, 0), "RIFF");
    assert.equal(view.getUint32(4, true), 36 + 6);
    assert.equal(ascii(bytes, 8), "WAVE");
    assert.equal(ascii(bytes, 12), "fmt ");
    assert.equal(view.getUint32(16, true), 16);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 24_000);
    assert.equal(view.getUint32(28, true), 48_000);
    assert.equal(view.getUint16(32, true), 2);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(ascii(bytes, 36), "data");
    assert.equal(view.getUint32(40, true), 6);
    assert.deepEqual(
      [0, 1, 2].map((i) => view.getInt16(44 + i * 2, true)),
      [0, Math.round(0.5 * 0x7fff), -0x4000],
    );
  });

  test("clips at ±1 instead of wrapping", () => {
    const bytes = encodeWav(new Float32Array([1.5, -3, 1, -1]), 24_000);
    const view = new DataView(bytes.buffer);
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)),
      [32767, -32768, 32767, -32768],
    );
  });

  test("reads back through readWavHeader", () => {
    const result = readWavHeader(encodeWav(new Float32Array(24_000), 24_000));
    assert.deepEqual(result, {
      ok: true,
      header: {
        channels: 1,
        sampleRate: 24_000,
        bits: 16,
        dataBytes: 48_000,
        durationMs: 1000,
      },
    });
  });
});

describe("resample", () => {
  for (const from of [48_000, 44_100]) {
    test(`${from} Hz to 24 kHz has the length of the new rate`, () => {
      const out = resample(new Float32Array(from * 2), from, 24_000);
      assert.equal(out.length, 48_000);
    });

    test(`${from} Hz: a 1 kHz tone passes`, () => {
      const out = resample(tone(1000, from, 0.5), from, 24_000);
      assert.ok(Math.abs(peak(out) - 1) < 0.02, `peak ${peak(out)}`);
    });

    test(`${from} Hz: a 15 kHz tone is cut, not folded to 9 kHz`, () => {
      const out = resample(tone(15_000, from, 0.5), from, 24_000);
      assert.ok(peak(out) < 0.1, `peak ${peak(out)}`);
    });
  }

  test("keeps a constant a constant", () => {
    const out = resample(new Float32Array(4800).fill(0.25), 48_000, 24_000);
    for (const sample of out) assert.ok(Math.abs(sample - 0.25) < 1e-6);
  });

  test("the same rate is a copy", () => {
    const samples = new Float32Array([0.1, 0.2]);
    const out = resample(samples, 24_000, 24_000);
    assert.deepEqual([...out], [...samples]);
    assert.notEqual(out, samples);
  });
});

describe("readWavHeader refuses", () => {
  test("what is not RIFF", () => {
    const bytes = encodeWav(new Float32Array(10), 24_000);
    bytes[0] = "X".charCodeAt(0);
    assert.deepEqual(readWavHeader(bytes), { ok: false, reason: "not-riff" });
  });

  test("what is not PCM", () => {
    assert.deepEqual(readWavHeader(header({ dataBytes: 4, format: 3 })), {
      ok: false,
      reason: "not-pcm",
    });
  });

  test("a data chunk longer than the file", () => {
    assert.deepEqual(
      readWavHeader(header({ dataBytes: 4000, actualDataBytes: 100 })),
      { ok: false, reason: "truncated" },
    );
  });

  test("a file with no data chunk", () => {
    assert.deepEqual(readWavHeader(header({ dataBytes: 0 }).slice(0, 36)), {
      ok: false,
      reason: "no-data",
    });
  });
});

describe("readWavHeader reads what the server then refuses", () => {
  test("stereo", () => {
    const result = readWavHeader(header({ channels: 2, dataBytes: 8 }));
    assert.ok(result.ok && result.header.channels === 2);
  });

  test("48 kHz", () => {
    const result = readWavHeader(header({ rate: 48_000, dataBytes: 8 }));
    assert.ok(result.ok && result.header.sampleRate === 48_000);
  });

  test("8 bits", () => {
    const result = readWavHeader(header({ bits: 8, dataBytes: 8 }));
    assert.ok(result.ok && result.header.bits === 8);
  });

  test("the length of a long take", () => {
    const result = readWavHeader(header({ dataBytes: 48_000 * 20 }));
    assert.ok(result.ok && result.header.durationMs === 20_000);
  });
});

describe("the size of a take", () => {
  test("is 15 s of mono 24 kHz 16 bit, plus the margin and the header", () => {
    assert.equal(MAX_TAKE_MS, 15_000);
    assert.equal(
      MAX_TAKE_BYTES,
      44 + ((MAX_TAKE_MS + TAKE_MARGIN_MS) / 1000) * 48_000,
    );
    assert.equal(MAX_TAKE_BYTES, 768_044);
  });

  test("fits a server action's body with room for the form", () => {
    assert.ok(MAX_TAKE_BYTES + 64 * 1024 <= BODY_SIZE_LIMIT_BYTES);
  });
});
