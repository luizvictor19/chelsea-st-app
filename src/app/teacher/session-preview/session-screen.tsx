"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type Recorder,
  createRecorder,
  recordingUnavailableReason,
} from "@/lib/audio/recorder";
import {
  HOLD_WHILE_TALKING,
  type Microphone,
  type Phase,
  Session,
} from "@/lib/tutor/session";
import type { TurnEngine } from "@/lib/tutor/turn-engine";

import { Robin, type RobinState } from "./robin";

/** The ceiling on one session. Only shown for now; nothing ends at zero. */
const SESSION_CAP_MS = 15 * 60_000;

/**
 * A hold shorter than this is a stray touch, not an answer: it is dropped
 * without being sent. Chosen by hand, not measured; tune it on the phone.
 */
const MIN_HOLD_MS = 300;

/**
 * How long the tutor waits after a question, with the button untouched, before
 * giving the start of the sentence. Once per question. Chosen by hand.
 */
const NUDGE_AFTER_MS = 5000;

/**
 * The longest the screen stays in "speaking" before handing her turn back,
 * whether or not the voice has said it is done.
 *
 * Measured on Chrome for Android on 2026-09-25, the ten lines of the preview
 * script took 4.6 to 6.2 s from speak to end. 15 s is well over twice the
 * longest, so a real line is never cut short, and a voice that never reports
 * its end costs her 15 s instead of the session.
 */
const MAX_SPEAKING_MS = 15_000;

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

/** Stops the browser voice, the one thing about the tutor this screen owns. */
function silence(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * The voice tutor's session screen. It knows a TurnEngine and nothing about
 * what is behind it. The rules of the session live in Session; this screen
 * records, draws, and tells the session what the student and the browser did.
 */
export function SessionScreen({
  engine,
  preview = false,
}: {
  readonly engine: TurnEngine;
  /** Marks the screen as the teacher's prototype. */
  readonly preview?: boolean;
}) {
  const [session] = useState(
    () =>
      new Session({
        engine,
        nudgeAfterMs: NUDGE_AFTER_MS,
        maxSpeakingMs: MAX_SPEAKING_MS,
      }),
  );
  const {
    phase,
    turn,
    hint,
    nudgeAt,
    microphone,
    helpShown,
    practised,
    startedAt,
  } = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  const [showQuestion, setShowQuestion] = useState(true);
  /** A problem with the microphone check, before the session has a turn. */
  const [introHint, setIntroHint] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const beginningRef = useRef(false);
  const recorderRef = useRef<Recorder | null>(null);
  const heldRef = useRef(false);
  const startingRef = useRef(false);
  const pressedAtRef = useRef(0);

  // Leaving the page ends the session: whatever lands later is dropped, and
  // neither the microphone nor the voice may keep going.
  useEffect(() => {
    session.reopen();
    return () => {
      session.close();
      void recorderRef.current?.stop().catch(() => undefined);
      silence();
    };
  }, [session]);

  // One clock for the session timer and the nudge countdown. It runs only
  // while one of them is on screen.
  const ticking = startedAt !== null || nudgeAt !== null;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [ticking]);

  // A permission already refused shows the instructions before the first hold,
  // and lifting it in the browser settings brings the screen back by itself.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const follow = () => {
      if (status === null) return;
      if (status.state === "denied") session.setMicrophone("denied");
      else if (session.getState().microphone === "denied") {
        session.setMicrophone("ok");
      }
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
  }, [session]);

  /** Asks for the microphone once, so a refusal shows before the first hold. */
  const checkMicrophone = useCallback(async (): Promise<boolean> => {
    const unavailable = recordingUnavailableReason();
    if (unavailable !== null) {
      session.setMicrophone({ unavailable });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      session.setMicrophone("ok");
      setIntroHint(null);
      return true;
    } catch (cause) {
      if (isDenied(cause)) session.setMicrophone("denied");
      else setIntroHint("Não foi possível abrir o microfone deste aparelho.");
      return false;
    }
  }, [session]);

  const begin = useCallback(async () => {
    // A double tap on Começar must not ask for the microphone twice.
    if (beginningRef.current) return;
    beginningRef.current = true;
    const ready = await checkMicrophone();
    if (ready) setNow(Date.now());
    if (ready) await session.begin();
    beginningRef.current = false;
  }, [checkMicrophone, session]);

  const press = useCallback(async () => {
    // listen() is the one gate for the button and the space bar: her turn,
    // and a usable microphone.
    if (heldRef.current || !session.listen()) return;
    heldRef.current = true;
    startingRef.current = true;
    pressedAtRef.current = performance.now();

    const recorder = createRecorder();
    try {
      await recorder.start();
    } catch (cause) {
      startingRef.current = false;
      heldRef.current = false;
      if (isDenied(cause)) {
        session.setMicrophone("denied");
        session.cancel(null);
      } else {
        session.cancel("Não foi possível gravar. Tente de novo.");
      }
      return;
    }
    startingRef.current = false;

    // Let go before the microphone opened: nothing worth sending.
    if (!heldRef.current) {
      void recorder.stop().catch(() => undefined);
      session.cancel(null);
      return;
    }
    recorderRef.current = recorder;
  }, [session]);

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
      session.cancel(HOLD_WHILE_TALKING);
      return;
    }

    session.think();
    let audio: Blob;
    try {
      audio = await recorder.stop();
    } catch {
      session.cancel("A gravação falhou. Tente de novo.");
      return;
    }
    await session.answer({ audio, durationMs: held });
  }, [session]);

  // The space bar is the button on a computer, wherever the focus is. The
  // default is stopped on both edges: keydown would scroll the page, and keyup
  // would click whichever button happens to be focused.
  useEffect(() => {
    const inSession = () => {
      const state = session.getState();
      return state.phase !== "intro" && state.microphone === "ok";
    };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      if (!inSession()) return;
      event.preventDefault();
      if (!event.repeat) void press();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target)) return;
      if (!inSession()) return;
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
  }, [press, release, session]);

  const remaining =
    startedAt === null
      ? SESSION_CAP_MS
      : Math.max(0, SESSION_CAP_MS - (now - startedAt));
  const word = turn?.word ?? null;
  const canTalk = phase === "waiting" || phase === "listening";
  const nudgeLeft =
    nudgeAt === null || phase !== "waiting"
      ? null
      : Math.min(NUDGE_AFTER_MS, Math.max(0, nudgeAt - now));

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
          <div className="pt-1">
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
                {(introHint ?? hint) !== null && (
                  <p className="text-faint text-sm">{introHint ?? hint}</p>
                )}
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
              <SessionOver practised={practised} />
            )}
          </div>

          {phase !== "intro" && word !== null && (
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
              {turn?.lead != null && (
                <p className="text-accent text-center text-xl font-extrabold tracking-tight">
                  {turn.lead}
                </p>
              )}
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
                  onClick={() => session.showHelp()}
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
              {/* Always laid out, so the button does not jump when it starts. */}
              <div
                className={
                  nudgeLeft === null
                    ? "invisible flex items-center gap-2"
                    : "flex items-center gap-2"
                }
                aria-label={
                  nudgeLeft === null
                    ? undefined
                    : `Robin ajuda em ${Math.ceil(nudgeLeft / 1000)} segundos`
                }
              >
                <span className="bg-rule h-1 w-24 overflow-hidden rounded-full">
                  <span
                    className="bg-muted block h-full rounded-full"
                    style={{
                      width: `${((nudgeLeft ?? 0) / NUDGE_AFTER_MS) * 100}%`,
                    }}
                  />
                </span>
                <span className="text-faint w-6 font-mono text-xs tabular-nums">
                  {Math.ceil((nudgeLeft ?? 0) / 1000)} s
                </span>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

/**
 * The end of the script. Never an empty screen: it says the session is over,
 * what was done in it, and where to go next.
 */
function SessionOver({ practised }: { readonly practised: number }) {
  return (
    <section
      aria-live="polite"
      className="flex max-w-xs flex-col items-center gap-3 text-center"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">
        Sessão encerrada
      </h1>
      <p className="text-muted">
        {practised === 1
          ? "Você praticou 1 palavra com o Robin."
          : `Você praticou ${practised} palavras com o Robin.`}{" "}
        Até a próxima!
      </p>
      <Link
        href="/teacher"
        className="bg-foreground text-background mt-2 rounded-full px-8 py-3.5 font-semibold"
      >
        Voltar
      </Link>
    </section>
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
