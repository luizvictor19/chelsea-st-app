"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Recorder,
  createRecorder,
  recordingUnavailableReason,
} from "@/lib/audio/recorder";
import type { TurnEngine, TutorTurn } from "@/lib/tutor/turn-engine";

import { Robin, type RobinState } from "./robin";

/** The ceiling on one session. Only shown for now; nothing ends at zero. */
const SESSION_CAP_MS = 15 * 60_000;

/**
 * A hold shorter than this is a stray touch, not an answer: it is dropped
 * without being sent. Chosen by hand, not measured; tune it on the phone.
 */
const MIN_HOLD_MS = 300;

type Phase =
  "intro" | "speaking" | "waiting" | "listening" | "thinking" | "finished";

type Microphone = "ok" | "denied" | { readonly unavailable: string };

const ROBIN: Record<Phase, RobinState> = {
  intro: "idle",
  speaking: "speaking",
  waiting: "idle",
  listening: "listening",
  thinking: "thinking",
  finished: "idle",
};

function isDenied(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "NotAllowedError";
}

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whether a key event is aimed at something the student is typing into. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * The voice tutor's session screen. It knows a TurnEngine and nothing about
 * what is behind it: the student's recording goes in, the tutor's turn comes
 * out, and the screen shows it.
 */
export function SessionScreen({
  engine,
  preview = false,
}: {
  readonly engine: TurnEngine;
  /** Marks the screen as the teacher's prototype. */
  readonly preview?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [microphone, setMicrophone] = useState<Microphone>("ok");
  const [turn, setTurn] = useState<TutorTurn | null>(null);
  const [showQuestion, setShowQuestion] = useState(true);
  const [helpShown, setHelpShown] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const phaseRef = useRef<Phase>("intro");
  const turnRef = useRef<TutorTurn | null>(null);
  const beginningRef = useRef(false);
  const recorderRef = useRef<Recorder | null>(null);
  const heldRef = useRef(false);
  const startingRef = useRef(false);
  const pressedAtRef = useRef(0);

  const moveTo = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // The clock only ticks once the session has started.
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // A permission already refused shows the instructions before the first hold,
  // and lifting it in the browser settings brings the screen back by itself.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const follow = () => {
      if (status === null) return;
      if (status.state === "denied") setMicrophone("denied");
      else setMicrophone((current) => (current === "denied" ? "ok" : current));
    };
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((answer) => {
        status = answer;
        follow();
        status.addEventListener("change", follow);
      })
      // Firefox and older Safari do not know the name; getUserMedia still tells.
      .catch(() => undefined);
    return () => status?.removeEventListener("change", follow);
  }, []);

  // Leaving the page must not keep the microphone or the voice going.
  useEffect(() => {
    return () => {
      void recorderRef.current?.stop().catch(() => undefined);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const play = useCallback(
    async (next: TutorTurn) => {
      // Help is per word: a new word starts hidden, a retry keeps it shown.
      if (turnRef.current?.word?.term !== next.word?.term) setHelpShown(false);
      turnRef.current = next;
      setTurn(next);
      moveTo("speaking");
      await next.play();
      moveTo(next.finished ? "finished" : "waiting");
    },
    [moveTo],
  );

  /** Asks for the microphone once, so a refusal shows before the first hold. */
  const checkMicrophone = useCallback(async (): Promise<boolean> => {
    const unavailable = recordingUnavailableReason();
    if (unavailable !== null) {
      setMicrophone({ unavailable });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setMicrophone("ok");
      return true;
    } catch (cause) {
      if (isDenied(cause)) setMicrophone("denied");
      else setHint("Não foi possível abrir o microfone deste aparelho.");
      return false;
    }
  }, []);

  const begin = useCallback(async () => {
    // A double tap on Começar must not open the session twice.
    if (beginningRef.current) return;
    beginningRef.current = true;
    if (!(await checkMicrophone())) {
      beginningRef.current = false;
      return;
    }
    setStartedAt(Date.now());
    setNow(Date.now());
    await play(await engine.start());
  }, [checkMicrophone, engine, play]);

  const press = useCallback(async () => {
    if (phaseRef.current !== "waiting" || heldRef.current) return;
    heldRef.current = true;
    startingRef.current = true;
    pressedAtRef.current = performance.now();
    setHint(null);
    moveTo("listening");

    const recorder = createRecorder();
    try {
      await recorder.start();
    } catch (cause) {
      startingRef.current = false;
      heldRef.current = false;
      moveTo("waiting");
      if (isDenied(cause)) setMicrophone("denied");
      else setHint("Não foi possível gravar. Tente de novo.");
      return;
    }
    startingRef.current = false;

    // Let go before the microphone opened: nothing worth sending.
    if (!heldRef.current) {
      void recorder.stop().catch(() => undefined);
      moveTo("waiting");
      return;
    }
    recorderRef.current = recorder;
  }, [moveTo]);

  const release = useCallback(async () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    // Still opening the microphone: press() sees the flag and cleans up.
    if (startingRef.current) return;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder === null) return;

    const held = performance.now() - pressedAtRef.current;
    if (held < MIN_HOLD_MS) {
      void recorder.stop().catch(() => undefined);
      moveTo("waiting");
      setHint("Segure o botão enquanto fala e solte no fim.");
      return;
    }

    moveTo("thinking");
    let audio: Blob;
    try {
      audio = await recorder.stop();
    } catch {
      moveTo("waiting");
      setHint("A gravação falhou. Tente de novo.");
      return;
    }
    await play(await engine.respond(audio));
  }, [engine, moveTo, play]);

  // The space bar is the button on a computer, wherever the focus is. The
  // default is stopped on both edges: keydown would scroll the page, and keyup
  // would click whichever button happens to be focused.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      if (phaseRef.current === "intro") return;
      event.preventDefault();
      if (!event.repeat) void press();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      if (phaseRef.current === "intro") return;
      event.preventDefault();
      void release();
    };
    // Switching tabs mid-hold never delivers the keyup.
    const blur = () => void release();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [press, release]);

  const remaining =
    startedAt === null
      ? SESSION_CAP_MS
      : Math.max(0, SESSION_CAP_MS - (now - startedAt));
  const word = turn?.word ?? null;
  const canTalk = phase === "waiting" || phase === "listening";

  return (
    <div className="text-foreground fixed inset-0 z-20 flex flex-col bg-[#F2F2F0] dark:bg-[#0F1115]">
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-6">
        <Link
          href="/teacher"
          className="text-muted hover:text-foreground rounded-sm px-1 py-1 text-sm"
        >
          Sair
        </Link>
        {preview && (
          <span className="text-faint font-mono text-[0.625rem] tracking-[0.14em] uppercase">
            Prévia · volta falsa
          </span>
        )}
        <span
          aria-label={`Tempo restante: ${formatRemaining(remaining)}`}
          className={
            remaining === 0
              ? "text-accent font-mono text-sm font-semibold tabular-nums"
              : "text-muted font-mono text-sm tabular-nums"
          }
        >
          {formatRemaining(remaining)}
        </span>
      </header>

      {microphone !== "ok" ? (
        <MicrophoneBlocked
          microphone={microphone}
          onRetry={() => void checkMicrophone()}
        />
      ) : (
        <main className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col items-center gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-6 sm:px-6">
          <div className="pt-1 pb-5">
            <Robin state={ROBIN[phase]} />
          </div>

          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3">
            {phase === "intro" ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <p className="text-muted max-w-xs">
                  O Robin mostra uma imagem e pergunta. Segure o botão para
                  responder em inglês.
                </p>
                <button
                  type="button"
                  onClick={() => void begin()}
                  className="bg-foreground text-background rounded-full px-8 py-3.5 font-semibold"
                >
                  Começar
                </button>
                {hint !== null && <p className="text-faint text-sm">{hint}</p>}
              </div>
            ) : word !== null ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a public storage URL, shown as is */}
                <img
                  // Keyed so a new word mounts a new element: swapping src on
                  // the old one keeps the previous picture on screen, under
                  // the new word, until the next file has loaded.
                  key={word.imageUrl}
                  src={word.imageUrl}
                  alt=""
                  className="bg-surface aspect-square max-h-full min-h-0 w-full max-w-[min(20rem,80vw)] rounded-lg object-contain shadow-sm"
                />
                <p
                  aria-live="polite"
                  className={
                    helpShown
                      ? "text-2xl font-extrabold tracking-tight"
                      : "invisible text-2xl font-extrabold tracking-tight"
                  }
                >
                  {word.term}
                </p>
              </>
            ) : (
              <p className="text-muted text-center">
                Sessão encerrada. Até a próxima!
              </p>
            )}
          </div>

          {phase !== "intro" && (
            <div className="flex w-full flex-col items-center gap-2">
              <p
                className={
                  showQuestion && turn?.question
                    ? "min-h-7 text-center text-lg font-semibold"
                    : "invisible min-h-7 text-center text-lg font-semibold"
                }
              >
                {turn?.question ?? ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuestion((shown) => !shown)}
                  aria-pressed={showQuestion}
                  className="border-rule text-muted hover:text-foreground rounded-full border px-3.5 py-1.5 text-sm"
                >
                  {showQuestion ? "Esconder pergunta" : "Mostrar pergunta"}
                </button>
                <button
                  type="button"
                  onClick={() => setHelpShown(true)}
                  disabled={word === null || helpShown}
                  className="border-rule text-muted hover:text-foreground rounded-full border px-3.5 py-1.5 text-sm disabled:opacity-40"
                >
                  Ajuda
                </button>
              </div>
            </div>
          )}

          {phase !== "intro" && phase !== "finished" && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <button
                type="button"
                disabled={!canTalk}
                aria-label="Segurar para falar"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  void press();
                }}
                onPointerUp={() => void release()}
                onPointerCancel={() => void release()}
                onContextMenu={(event) => event.preventDefault()}
                // touch-none keeps Android from reading the hold as a scroll
                // and cancelling the pointer half a second in; select-none and
                // the context menu guard stop the long-press menu.
                className={
                  phase === "listening"
                    ? "bg-accent text-accent-foreground ring-accent/25 flex size-24 scale-105 touch-none items-center justify-center rounded-full shadow-lg ring-8 transition-transform select-none [-webkit-touch-callout:none]"
                    : "bg-foreground text-background flex size-24 touch-none items-center justify-center rounded-full shadow-md transition-transform select-none [-webkit-touch-callout:none] disabled:opacity-30"
                }
              >
                <MicIcon />
              </button>
              <p className="text-faint min-h-5 text-center text-sm">
                {hint ??
                  (phase === "listening"
                    ? "Ouvindo… solte para enviar"
                    : phase === "thinking"
                      ? "Robin está pensando"
                      : phase === "speaking"
                        ? "Robin está falando"
                        : "Segure para falar · espaço no computador")}
              </p>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function MicrophoneBlocked({
  microphone,
  onRetry,
}: {
  readonly microphone: Exclude<Microphone, "ok">;
  readonly onRetry: () => void;
}) {
  if (microphone !== "denied") {
    return (
      <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-3 px-4">
        <h1 className="text-xl font-extrabold">Sem microfone aqui</h1>
        <p className="text-muted">{microphone.unavailable}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-5 overflow-y-auto px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-extrabold">O microfone está bloqueado</h1>
        <p className="text-muted">
          Para conversar com o Robin, o navegador precisa deixar este site usar
          o microfone. Nada é gravado sem você segurar o botão.
        </p>
      </div>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">
          No Chrome do celular (Android)
        </h2>
        <ol className="text-muted list-decimal space-y-1 pl-5 text-sm">
          <li>Toque no ícone à esquerda do endereço, no alto da tela.</li>
          <li>Toque em Permissões e depois em Microfone.</li>
          <li>Escolha Permitir e volte para esta página.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">No iPhone (Safari)</h2>
        <ol className="text-muted list-decimal space-y-1 pl-5 text-sm">
          <li>Toque em aA, à esquerda do endereço.</li>
          <li>Toque em Ajustes do Site e depois em Microfone.</li>
          <li>Escolha Permitir e recarregue a página.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">No computador</h2>
        <ol className="text-muted list-decimal space-y-1 pl-5 text-sm">
          <li>Clique no ícone à esquerda do endereço.</li>
          <li>Ligue o Microfone para este site.</li>
          <li>Recarregue a página se ela não voltar sozinha.</li>
        </ol>
      </section>

      <button
        type="button"
        onClick={onRetry}
        className="bg-foreground text-background self-start rounded-full px-6 py-3 font-semibold"
      >
        Tentar de novo
      </button>
    </main>
  );
}
