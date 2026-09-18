/**
 * Audio recording, kept behind one module so nothing else in the app touches
 * MediaRecorder. What a browser will actually record in differs between desktop
 * Chrome, Android Chrome and iOS Safari, and this is the only place that has to
 * know about it.
 */

/**
 * Container and codec preference, best first. Inherited from the /spike/audio
 * experiment this module replaces, which is where the order was found.
 *
 * Opus in WebM is the target: it is what Chrome records natively and the
 * cheapest thing to send anywhere else. The two mp4 entries sit above Ogg
 * because Safari and the iOS WebView record AAC and nothing else, so for them
 * this is the difference between working and not; the explicit codec is asked
 * for first because Safari is the browser most likely to want it spelled out.
 *
 * audio/wav is deliberately absent. No MediaRecorder implementation produces
 * it, so listing it would only add a line that always reads "não" on screen.
 *
 * Measured with MediaRecorder.isTypeSupported on Chromium 152, Linux, on
 * 2026-09-18. The mp4 answers are the ones not to trust here: this build ships
 * without the proprietary codecs, so a real Chrome is expected to differ.
 *
 *   audio/webm;codecs=opus     true    <- chosen
 *   audio/webm                 true
 *   audio/mp4;codecs=mp4a.40.2 false
 *   audio/mp4                  true
 *   audio/ogg;codecs=opus      false
 *   audio/wav                  false   <- why it is not on the list
 *
 * Android and iOS are still unmeasured. The teacher page exists to fill that in.
 */
export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/**
 * Normalised for comparison only. Browsers are not consistent about the case or
 * about the space after the semicolon, and "AUDIO/WEBM; codecs=opus" names the
 * same type as "audio/webm;codecs=opus". Comparing raw strings would silently
 * reject a type the browser does support, which is the kind of mistake that
 * shows up as a worse recording rather than as an error.
 */
function normalise(mimeType: string): string {
  return mimeType
    .trim()
    .toLowerCase()
    .replace(/\s*;\s*/g, ";");
}

/**
 * The first of PREFERRED_MIME_TYPES that appears in `supported`, or null when
 * none of them does.
 *
 * The string handed back is the caller's own spelling, not ours: it came from
 * the browser, so it is the spelling to hand to MediaRecorder.
 *
 * Pure on purpose. The list arrives as an argument, so a test can describe a
 * browser without having to be one.
 */
export function chooseMimeType(supported: readonly string[]): string | null {
  const available = new Map<string, string>();
  for (const mimeType of supported) {
    const key = normalise(mimeType);
    // First spelling wins, so a duplicate later in the list cannot displace it.
    if (!available.has(key)) available.set(key, mimeType);
  }

  for (const preferred of PREFERRED_MIME_TYPES) {
    const match = available.get(normalise(preferred));
    if (match !== undefined) return match;
  }
  return null;
}

/**
 * Why this browser cannot record, in words for the teacher, or null when it
 * can. The reasons live here rather than on a screen because knowing which
 * browsers fail how is this module's job.
 *
 * The https line is the one thing /spike/audio actually taught us: iPhone
 * Safari hides navigator.mediaDevices entirely outside a secure context, so
 * the microphone looks absent when it is only unreachable.
 */
export function recordingUnavailableReason(): string | null {
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices?.getUserMedia === undefined
  ) {
    return "Este navegador não expõe o microfone. Em iPhone, use o Safari e um endereço https.";
  }
  if (typeof MediaRecorder === "undefined") {
    return "Este navegador não tem MediaRecorder, então não dá para gravar áudio aqui. Abra a página no Chrome do computador ou do Android.";
  }
  return null;
}

/** Whether this browser can record at all. False during server rendering. */
export function isRecordingSupported(): boolean {
  return recordingUnavailableReason() === null;
}

/** Which of the preferred types this browser admits to supporting. */
export function supportedMimeTypes(): readonly string[] {
  if (typeof MediaRecorder === "undefined") return [];
  return PREFERRED_MIME_TYPES.filter((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

export interface Recorder {
  start(): Promise<void>;
  stop(): Promise<Blob>;
  mimeType: string;
}

/**
 * A Recorder over MediaRecorder. Each instance records once and can then be
 * started again; the microphone is released on every stop, so the browser's
 * recording indicator goes out when the teacher lets go of the button.
 */
export function createRecorder(): Recorder {
  let state: "idle" | "recording" | "stopped" = "idle";
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let chosen: string | null = null;

  function releaseMicrophone(): void {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  return {
    get mimeType(): string {
      // What the browser settled on once it has one, our request before that.
      return recorder?.mimeType || chosen || "";
    },

    async start(): Promise<void> {
      if (state === "recording") throw new Error("Recorder is already running");
      const unavailable = recordingUnavailableReason();
      if (unavailable !== null) throw new Error(unavailable);

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chosen = chooseMimeType(supportedMimeTypes());
      chunks = [];

      try {
        recorder = new MediaRecorder(
          stream,
          chosen === null ? undefined : { mimeType: chosen },
        );
      } catch (cause) {
        // Nothing is recording, so the microphone must not stay open.
        releaseMicrophone();
        recorder = null;
        throw cause;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
      state = "recording";
    },

    stop(): Promise<Blob> {
      const active = recorder;
      if (state !== "recording" || active === null) {
        return Promise.reject(new Error("Recorder was not started"));
      }
      state = "stopped";

      return new Promise<Blob>((resolve, reject) => {
        active.onstop = () => {
          releaseMicrophone();
          resolve(new Blob(chunks, { type: active.mimeType || chosen || "" }));
        };
        active.onerror = () => {
          releaseMicrophone();
          reject(new Error("MediaRecorder failed while recording"));
        };
        active.stop();
      });
    },
  };
}
