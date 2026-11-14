/**
 * A Recorder that records WAV: the format the judge takes, and the one no
 * MediaRecorder produces (recorder.ts says why audio/wav is not on its list).
 *
 * The microphone feeds an AudioWorklet that hands every block of samples
 * back to the page. On stop the blocks are joined, brought to 24 kHz by
 * resample() and written by encodeWav(). The AudioContext runs at the
 * device's own rate, because Firefox refuses to connect a microphone to a
 * context of another rate; the change of rate is code, the same in every
 * browser (wav.ts).
 *
 * The take stops growing at MAX_TAKE_MS: samples past the cap are dropped,
 * so a held button can never make a file the server refuses for its size.
 *
 * recorder.ts (webm) stays for the measurement cases, which are recorded and
 * measured as webm.
 */

import type { Recorder } from "./recorder.ts";
import { MAX_TAKE_MS, WAV_SAMPLE_RATE, encodeWav, resample } from "./wav.ts";

export const WAV_MIME_TYPE = "audio/wav";

const PROCESSOR = "chelsea-wav-capture";

/**
 * The worklet, as text: loaded from a Blob URL, so the module needs no file
 * in public/ and no route of its own. It copies channel 0 of every block
 * (the node is mono, so that is the mix) and posts it to the page.
 */
const PROCESSOR_SOURCE = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor(${JSON.stringify(PROCESSOR)}, Capture);
`;

/**
 * Why this browser cannot record WAV, in words for the screen, or null when
 * it can. Same https advice as recorder.ts: iPhone Safari hides the
 * microphone outside a secure context.
 */
export function wavRecordingUnavailableReason(): string | null {
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices?.getUserMedia === undefined
  ) {
    return "Este navegador não expõe o microfone. Em iPhone, use o Safari e um endereço https.";
  }
  if (
    typeof AudioContext === "undefined" ||
    typeof AudioWorkletNode === "undefined"
  ) {
    return "Este navegador não grava áudio em WAV. Abra a página no Chrome ou no Firefox.";
  }
  return null;
}

/** Blocks of samples joined into one array, at most `limit` long. */
export function joinBlocks(
  blocks: readonly Float32Array[],
  limit: number,
): Float32Array {
  const total = Math.min(
    limit,
    blocks.reduce((sum, block) => sum + block.length, 0),
  );
  const out = new Float32Array(total);
  let at = 0;
  for (const block of blocks) {
    if (at >= total) break;
    const part = block.subarray(0, total - at);
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Each instance records once at a time and can be started again; the
 * microphone and the AudioContext are released on every stop, so the
 * browser's recording indicator goes out when the button is let go.
 */
export function createWavRecorder(): Recorder {
  let state: "idle" | "recording" = "idle";
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let blocks: Float32Array[] = [];
  let kept = 0;
  let limit = 0;

  async function release(): Promise<void> {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    const closing = context;
    context = null;
    await closing?.close().catch(() => undefined);
  }

  return {
    mimeType: WAV_MIME_TYPE,

    async start(): Promise<void> {
      if (state === "recording") throw new Error("Recorder is already running");
      const unavailable = wavRecordingUnavailableReason();
      if (unavailable !== null) throw new Error(unavailable);

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        context = new AudioContext();
        const url = URL.createObjectURL(
          new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, PROCESSOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        });
        // Silent, but connected: a node that reaches no destination is not
        // guaranteed to be processed.
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node).connect(mute).connect(context.destination);

        blocks = [];
        kept = 0;
        limit = Math.ceil((context.sampleRate * MAX_TAKE_MS) / 1000);
        node.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (kept >= limit) return;
          blocks.push(event.data);
          kept += event.data.length;
        };
        // Some browsers start a context suspended until a gesture resumes it.
        await context.resume();
      } catch (cause) {
        // Nothing is recording, so the microphone must not stay open.
        await release();
        throw cause;
      }
      state = "recording";
    },

    async stop(): Promise<Blob> {
      if (state !== "recording" || context === null) {
        throw new Error("Recorder was not started");
      }
      state = "idle";
      const rate = context.sampleRate;
      await release();
      const samples = resample(
        joinBlocks(blocks, limit),
        rate,
        WAV_SAMPLE_RATE,
      );
      blocks = [];
      return new Blob([encodeWav(samples, WAV_SAMPLE_RATE)], {
        type: WAV_MIME_TYPE,
      });
    },
  };
}
