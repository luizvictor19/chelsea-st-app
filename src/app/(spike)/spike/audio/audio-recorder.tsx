"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Ordered by preference. Safari only accepts the mp4 variants. */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const NO_TYPES: string[] = [];
let cachedSupportedTypes: string[] | null = null;

/** Computed once and cached, so the snapshot reference stays stable. */
function getSupportedTypes(): string[] {
  if (cachedSupportedTypes) return cachedSupportedTypes;
  if (typeof MediaRecorder === "undefined") return NO_TYPES;
  cachedSupportedTypes = CANDIDATE_MIME_TYPES.filter((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  return cachedSupportedTypes;
}

/** Support never changes while the page is open, so nothing to subscribe to. */
function subscribe(): () => void {
  return () => {};
}

type Status = "idle" | "recording" | "recorded" | "error";

export function AudioRecorder() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [blobSize, setBlobSize] = useState<number | null>(null);
  const [chosenType, setChosenType] = useState<string | null>(null);

  const supportedTypes = useSyncExternalStore(
    subscribe,
    getSupportedTypes,
    () => NO_TYPES,
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Release the microphone if the user leaves mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Revoke the previous object URL once it is replaced or the page unmounts.
  useEffect(() => {
    if (!audioUrl) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const start = useCallback(async () => {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setStatus("error");
      setError(
        "Este navegador não expõe o microfone. Em iPhone, use o Safari e um endereço https.",
      );
      return;
    }

    const mimeType = getSupportedTypes()[0];
    setChosenType(mimeType ?? null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        setBlobSize(blob.size);
        setAudioUrl(URL.createObjectURL(blob));
        setStatus("recorded");
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };

      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao abrir o microfone.",
      );
    }
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={status === "recording" ? stop : start}
          className="rounded bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {status === "recording" ? "Parar" : "Gravar"}
        </button>
        {status === "recording" && (
          <span className="self-center text-sm text-red-600">gravando…</span>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-600 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {audioUrl && (
        <audio controls src={audioUrl} className="w-full">
          <track kind="captions" />
        </audio>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
        <dt>MediaRecorder</dt>
        <dd>
          {typeof MediaRecorder === "undefined" ? "ausente" : "disponível"}
        </dd>
        <dt>Formatos aceitos</dt>
        <dd className="break-all">{supportedTypes.join(", ") || "nenhum"}</dd>
        <dt>Formato usado</dt>
        <dd className="break-all">{chosenType ?? "padrão do navegador"}</dd>
        <dt>Tamanho</dt>
        <dd>
          {blobSize === null ? "·" : `${(blobSize / 1024).toFixed(1)} KB`}
        </dd>
      </dl>
    </div>
  );
}
