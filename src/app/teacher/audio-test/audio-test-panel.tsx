"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  PREFERRED_MIME_TYPES,
  type Recorder,
  createRecorder,
  recordingUnavailableReason,
  supportedMimeTypes,
} from "@/lib/audio/recorder";

type TypeSupport = { readonly type: string; readonly supported: boolean };

type BrowserSupport = {
  readonly browser: "checking" | "ready" | "unsupported";
  readonly types: readonly TypeSupport[];
  /** Why recording is impossible here, in words, when it is. */
  readonly reason: string | null;
};

/*
 * What the browser can do is read through useSyncExternalStore rather than in
 * an effect, because MediaRecorder does not exist during server rendering and
 * the two passes have to be allowed to disagree. The answer never changes
 * within a page load, so it is computed once and kept: a snapshot has to be
 * the same object every time or React re-renders forever.
 */
const SERVER_SNAPSHOT: BrowserSupport = {
  browser: "checking",
  types: [],
  reason: null,
};
let clientSnapshot: BrowserSupport | null = null;

function subscribe(): () => void {
  return () => {};
}

function readSupport(): BrowserSupport {
  if (clientSnapshot === null) {
    const reason = recordingUnavailableReason();
    if (reason === null) {
      const supported = new Set(supportedMimeTypes());
      clientSnapshot = {
        browser: "ready",
        types: PREFERRED_MIME_TYPES.map((type) => ({
          type,
          supported: supported.has(type),
        })),
        reason: null,
      };
    } else {
      clientSnapshot = { browser: "unsupported", types: [], reason };
    }
  }
  return clientSnapshot;
}

function readServerSupport(): BrowserSupport {
  return SERVER_SNAPSHOT;
}

type Take = {
  readonly mimeType: string;
  readonly seconds: number;
  readonly kilobytes: number;
  readonly url: string;
};

/** Whatever was thrown, said in a way the teacher can act on. */
function describe(cause: unknown): string {
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
 * A page to find out what recording actually does on a given device, before
 * any of it is wired into the tutor. It writes nothing anywhere: the take lives
 * in memory until the next one replaces it.
 */
export function AudioTestPanel() {
  const { browser, types, reason } = useSyncExternalStore(
    subscribe,
    readSupport,
    readServerSupport,
  );
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [take, setTake] = useState<Take | null>(null);

  const recorderRef = useRef<Recorder | null>(null);
  const phaseRef = useRef<"idle" | "starting" | "recording">("idle");
  const heldRef = useRef(false);
  const startedAtRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  // A take that is replaced, or a page that is left, must not keep the blob or
  // the microphone alive behind the teacher's back.
  useEffect(() => {
    return () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
      if (phaseRef.current === "recording") void recorderRef.current?.stop();
    };
  }, []);

  const begin = useCallback(async () => {
    if (browser !== "ready" || phaseRef.current !== "idle") return;
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
      setNotice(describe(cause));
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
  }, [browser]);

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
      setNotice(describe(cause));
      return;
    }

    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setTake({
      mimeType: recorder.mimeType || blob.type || "não informado",
      seconds,
      kilobytes: blob.size / 1024,
      url: urlRef.current,
    });
  }, []);

  if (browser === "unsupported") {
    return (
      <p className="border-rule text-muted max-w-prose rounded-sm border border-dashed p-6">
        {reason}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          disabled={browser !== "ready"}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            void begin();
          }}
          onPointerUp={() => void end()}
          onPointerCancel={() => void end()}
          onKeyDown={(event) => {
            if (event.key === " " && !event.repeat) void begin();
          }}
          onKeyUp={(event) => {
            if (event.key === " ") void end();
          }}
          // touch-none keeps Android from reading the hold as a scroll and
          // cancelling the pointer half a second in.
          className={
            recording
              ? "border-foreground bg-foreground text-background touch-none rounded-sm border px-6 py-3.5 font-semibold select-none"
              : "border-rule hover:bg-surface touch-none rounded-sm border px-6 py-3.5 font-semibold transition-colors select-none disabled:opacity-50"
          }
        >
          {recording ? "Gravando, solte para parar" : "Segurar para gravar"}
        </button>
        <p className="text-faint text-sm">
          {browser === "checking"
            ? "Verificando o que este navegador suporta."
            : "Pressione e segure. A gravação para quando você solta."}
        </p>
      </div>

      {notice !== null && (
        <p className="text-muted max-w-prose text-sm">{notice}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Tipos suportados
        </h2>
        <ul className="flex flex-col gap-1.5">
          {types.map(({ type, supported }) => (
            <li key={type} className="flex items-baseline gap-3 font-mono">
              <span
                aria-hidden="true"
                className={supported ? "text-foreground" : "text-faint"}
              >
                {supported ? "sim" : "não"}
              </span>
              <span className={supported ? "text-sm" : "text-faint text-sm"}>
                {type}
              </span>
              <span className="sr-only">
                {supported ? "suportado" : "não suportado"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {take !== null && (
        <section className="border-rule flex flex-col gap-4 rounded-sm border p-6">
          <h2 className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Última gravação
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex gap-3">
              <dt className="text-muted w-28 shrink-0">Formato</dt>
              <dd className="font-mono">{take.mimeType}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-muted w-28 shrink-0">Duração</dt>
              <dd className="font-mono">{take.seconds.toFixed(1)} s</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-muted w-28 shrink-0">Tamanho</dt>
              <dd className="font-mono">{take.kilobytes.toFixed(1)} KB</dd>
            </div>
          </dl>
          <audio controls src={take.url} className="w-full max-w-md" />
        </section>
      )}
    </div>
  );
}
