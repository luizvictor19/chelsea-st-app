"use client";

import { useEffect, useState } from "react";

import {
  formatLessonDate,
  formatLessonTime,
  humanCountdown,
} from "@/lib/datetime";

/** Below this, the lesson stops being information and becomes the thing to do. */
const IMMINENT_MINUTES = 15;
const TICK_MS = 30_000;

type Props = {
  scheduledAt: string;
  durationMinutes: number;
  timeZone: string;
  meetUrl: string | null;
  /** The instant the server rendered with, so the first paint agrees with it. */
  serverNow: string;
};

export function NextLessonCard({
  scheduledAt,
  durationMinutes,
  timeZone,
  meetUrl,
  serverNow,
}: Props) {
  // Seeded with the server's instant so the first client render produces the
  // same HTML and hydration stays quiet. It starts following the real clock only
  // after mount, which is also what lets a page left open cross into the
  // highlighted state on its own instead of waiting for a reload.
  const [nowMs, setNowMs] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const start = new Date(scheduledAt);
  const startMs = start.getTime();
  const endMs = startMs + durationMinutes * 60_000;

  const hasStarted = nowMs >= startMs;
  const inProgress = hasStarted && nowMs < endMs;
  const isImminent = (startMs - nowMs) / 60_000 <= IMMINENT_MINUTES;

  return (
    <section
      aria-label="Próxima aula"
      className={
        isImminent
          ? "border-accent bg-surface flex flex-col gap-4 rounded-sm border-2 p-6"
          : "border-rule bg-surface flex flex-col gap-4 rounded-sm border p-6"
      }
    >
      <p
        className={
          isImminent
            ? "text-accent font-mono text-xs tracking-[0.16em] uppercase"
            : "text-faint font-mono text-xs tracking-[0.16em] uppercase"
        }
      >
        {inProgress ? "Aula em andamento" : "Próxima aula"}
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-2xl font-bold tracking-tight first-letter:uppercase">
          {formatLessonDate(start, timeZone)}
        </p>
        <p className="font-mono text-4xl font-medium">
          {formatLessonTime(start, timeZone)}
        </p>
        <p className="text-muted">
          {inProgress
            ? "Já começou. Pode entrar."
            : humanCountdown(new Date(nowMs), start, timeZone)}
        </p>
      </div>

      {meetUrl ? (
        <a
          href={meetUrl}
          target="_blank"
          rel="noreferrer"
          className={
            isImminent
              ? "bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold"
              : "border-rule self-start rounded-sm border px-5 py-3 font-semibold"
          }
        >
          Entrar na aula
        </a>
      ) : (
        // Never invent a link and never hide the lesson because of a missing one.
        <p className="text-muted border-rule border-t pt-4 text-sm">
          O link da sala ainda não foi configurado. Ele chega antes da aula.
        </p>
      )}
    </section>
  );
}
