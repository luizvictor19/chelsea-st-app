/**
 * WAV, the format the audio judges take (wav or mp3, nothing else; see
 * src/lib/judge/openai-audio.ts) and the one no browser records through
 * MediaRecorder. The browser captures raw samples (wav-recorder.ts) and this
 * module turns them into a file; the server reads the header back before it
 * pays for a call. Pure, so every rule can be shown failing in a test.
 *
 * The target is the one measure-judge.ts measured with: mono, 24 kHz, 16 bit
 * PCM. On 2026-09-25, 16, 24 and 48 kHz gave the same answer and the same
 * audio tokens on c01, and 24 kHz is the models' own output rate.
 */

export const WAV_SAMPLE_RATE = 24_000;
export const WAV_CHANNELS = 1;
export const WAV_BITS = 16;

/** A canonical PCM header: RIFF, fmt and data, nothing between them. */
export const WAV_HEADER_BYTES = 44;

/**
 * The longest take, provisional (adjust in the beta). The recorder stops
 * keeping samples here, and the server refuses a take longer than this plus
 * TAKE_MARGIN_MS. Not the session screen's MAX_SPEAKING_MS, which is how long
 * the tutor's own voice may take.
 */
export const MAX_TAKE_MS = 15_000;

/** Slack for a take that ends a few blocks after the cap. */
export const TAKE_MARGIN_MS = 1_000;

const BYTES_PER_SECOND = (WAV_SAMPLE_RATE * WAV_CHANNELS * WAV_BITS) / 8;

/** The largest file the server takes: 768 044 bytes. */
export const MAX_TAKE_BYTES =
  WAV_HEADER_BYTES + ((MAX_TAKE_MS + TAKE_MARGIN_MS) / 1000) * BYTES_PER_SECOND;

/**
 * Mono samples in [-1, 1] as a 16 bit PCM WAV file. A sample outside the
 * range is clipped, not wrapped: wrapping turns a loud peak into a click of
 * the opposite sign.
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(at + i, text.charCodeAt(i));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    const value = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(value), true);
  }
  return bytes;
}

/**
 * Half the width of the filter, in taps of its own cutoff. 16 keeps the
 * stop band below a tenth (resample's tests) at a cost the browser does not
 * notice: 15 s at 48 kHz is about 26 million multiplications.
 */
const HALF_TAPS = 16;

/**
 * Where the filter cuts, as a share of the lower Nyquist frequency: 0.9 of
 * 12 kHz for 24 kHz out. Below 1 so the transition band ends before the
 * frequencies that would fold back.
 */
const CUTOFF = 0.9;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function blackman(x: number): number {
  // x in [-1, 1]; 0 outside.
  if (x <= -1 || x >= 1) return 0;
  const t = (x + 1) / 2;
  return (
    0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t)
  );
}

/**
 * The samples at another rate, through a windowed sinc low-pass.
 *
 * Why the filter. The microphone runs at the device's rate (44.1 or 48 kHz
 * on the phones and laptops of 2026), and 24 kHz holds nothing above 12 kHz.
 * Dropping every other sample would fold whatever is above it (a fan, a
 * hiss) back down into the band of speech. The weights of each output sample
 * are normalised to sum to one, so a constant stays the same constant and the
 * edges do not fade.
 *
 * Why here and not in the AudioContext. Firefox refuses to connect a
 * microphone to an AudioContext whose rate differs from the device's, so the
 * capture runs at the native rate in every browser and the change of rate is
 * this function's, the same everywhere.
 */
export function resample(
  samples: Float32Array,
  from: number,
  to: number,
): Float32Array {
  if (!(from > 0) || !(to > 0)) throw new Error("Rates must be positive");
  if (from === to) return samples.slice();

  const ratio = to / from;
  const outLength = Math.floor(samples.length * ratio);
  const out = new Float32Array(outLength);
  // The cutoff in cycles per input sample, times two: 1 is the input Nyquist.
  const cutoff = Math.min(1, ratio) * CUTOFF;
  const halfWidth = Math.ceil(HALF_TAPS / cutoff);

  for (let i = 0; i < outLength; i++) {
    const centre = i / ratio;
    const first = Math.max(0, Math.ceil(centre - halfWidth));
    const last = Math.min(samples.length - 1, Math.floor(centre + halfWidth));
    let sum = 0;
    let weights = 0;
    for (let k = first; k <= last; k++) {
      const distance = centre - k;
      const weight =
        sinc(cutoff * distance) * blackman(distance / (halfWidth + 1));
      sum += samples[k] * weight;
      weights += weight;
    }
    out[i] = weights === 0 ? 0 : sum / weights;
  }
  return out;
}

export type WavHeader = {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bits: number;
  /** The bytes of the data chunk as written in its header. */
  readonly dataBytes: number;
  readonly durationMs: number;
};

export type WavRefusal = "not-riff" | "not-pcm" | "no-data" | "truncated";

/**
 * What a WAV file says about itself, or why it is not one this module reads.
 * Walks the chunks, so a file with a LIST chunk before its data is still
 * read; checks that the data chunk fits in the bytes there are.
 */
export function readWavHeader(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly header: WavHeader }
  | { readonly ok: false; readonly reason: WavRefusal } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  if (bytes.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") {
    return { ok: false, reason: "not-riff" };
  }

  let format: { channels: number; sampleRate: number; bits: number } | null =
    null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(at);
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (id === "fmt ") {
      if (start + 16 > bytes.length) return { ok: false, reason: "truncated" };
      if (view.getUint16(start, true) !== 1) {
        return { ok: false, reason: "not-pcm" };
      }
      format = {
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === "data") {
      if (format === null) return { ok: false, reason: "not-pcm" };
      if (start + size > bytes.length) {
        return { ok: false, reason: "truncated" };
      }
      const perSecond = (format.sampleRate * format.channels * format.bits) / 8;
      return {
        ok: true,
        header: {
          ...format,
          dataBytes: size,
          durationMs: perSecond > 0 ? (size / perSecond) * 1000 : 0,
        },
      };
    }
    // Chunks are padded to an even size.
    at = start + size + (size % 2);
  }
  return { ok: false, reason: format === null ? "not-pcm" : "no-data" };
}
