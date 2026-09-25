"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { type Recorder, createRecorder } from "@/lib/audio/recorder";

export type Take = {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly seconds: number;
};

/** Whatever was thrown, said in a way the teacher can act on. */
export function describeRecordingError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError") {
    return "O navegador negou o acesso ao microfone. Libere o microfone para este site e tente de novo.";
  }
  if (name === "NotFoundError") {
    return "Nenhum microfone foi encontrado neste aparelho.";
  }
  return cause instanceof Error ? cause.message : "Falha ao gravar.";
}

/**
 * Press and hold to record, let go to stop, over the one Recorder in
 * lib/audio. Shared by the device test and the STT cases, so both record the
 * same way and the recordings measured are the ones the tutor would get.
 *
 * `onTake` receives every finished recording. It is read through a ref, so a
 * caller can pass a fresh closure on each render.
 */
export function useHoldRecorder(ready: boolean, onTake: (take: Take) => void) {
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const recorderRef = useRef<Recorder | null>(null);
  const phaseRef = useRef<"idle" | "starting" | "recording">("idle");
  const heldRef = useRef(false);
  const startedAtRef = useRef(0);
  const onTakeRef = useRef(onTake);

  useEffect(() => {
    onTakeRef.current = onTake;
  }, [onTake]);

  // A page that is left must not keep the microphone alive.
  useEffect(() => {
    return () => {
      if (phaseRef.current === "recording") void recorderRef.current?.stop();
    };
  }, []);

  const begin = useCallback(async () => {
    if (!ready || phaseRef.current !== "idle") return;
    phaseRef.current = "starting";
    heldRef.current = true;
    setNotice(null);

    const recorder = createRecorder();
    recorderRef.current = recorder;

    try {
      await recorder.start();
    } catch (cause) {
      phaseRef.current = "idle";
      heldRef.current = false;
      recorderRef.current = null;
      setNotice(describeRecordingError(cause));
      return;
    }

    // Let go while the permission prompt was up: there is no take to keep, and
    // the microphone has to be handed back.
    if (!heldRef.current) {
      phaseRef.current = "idle";
      void recorder.stop().catch(() => undefined);
      recorderRef.current = null;
      setNotice("Microfone liberado. Segure o botão de novo para gravar.");
      return;
    }

    startedAtRef.current = performance.now();
    phaseRef.current = "recording";
    setRecording(true);
  }, [ready]);

  const end = useCallback(async () => {
    heldRef.current = false;
    // Still inside getUserMedia: begin() sees the released flag and cleans up.
    if (phaseRef.current !== "recording") return;

    const recorder = recorderRef.current;
    if (recorder === null) return;

    phaseRef.current = "idle";
    recorderRef.current = null;
    const seconds = (performance.now() - startedAtRef.current) / 1000;
    setRecording(false);

    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (cause) {
      setNotice(describeRecordingError(cause));
      return;
    }

    onTakeRef.current({
      blob,
      mimeType: recorder.mimeType || blob.type,
      seconds,
    });
  }, []);

  /** Spread onto the button that is held. */
  const holdProps = {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      void begin();
    },
    onPointerUp: () => void end(),
    onPointerCancel: () => void end(),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " " && !event.repeat) void begin();
    },
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " ") void end();
    },
  };

  return { recording, notice, setNotice, holdProps };
}
