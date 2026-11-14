"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import type { JudgedTake } from "@/lib/judge/judge-take";
import { isAnswerLanguage } from "@/lib/judge/provider";
import { appJudge, judgeAnswer, type TakeRefusal } from "@/lib/judge/server";

/** Longer than any question or answer of the book, short of a paste. */
const MAX_TEXT = 500;

export type JudgePanelResult =
  | { readonly ok: true; readonly take: JudgedTake }
  | { readonly ok: false; readonly error: string };

const REFUSALS: Record<TakeRefusal, string> = {
  empty: "A gravação chegou vazia.",
  "too-large": "A gravação passa de 15 segundos.",
  "not-wav": "A gravação não chegou em WAV.",
  "not-mono": "A gravação não é mono.",
  "not-24khz": "A gravação não está em 24 kHz.",
  "not-16bit": "A gravação não está em 16 bits.",
};

function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > MAX_TEXT ? null : trimmed;
}

/**
 * Judges one spoken answer with the app's judge, the way the tutor will
 * (#249): the production test of the path, from the browser's WAV to the
 * verdict. Each call is paid, so only the platform admin reaches it, and the
 * check comes before the form is read. Nothing is stored: this is a probe,
 * not a turn of a session; the turn and its audio are #248's.
 */
export async function judgeSpokenAnswer(
  form: FormData,
): Promise<JudgePanelResult> {
  await requirePlatformAdmin();

  const question = text(form, "question");
  const expected = text(form, "expected");
  const language = form.get("language");
  const audio = form.get("audio");
  if (question === null || expected === null) {
    return {
      ok: false,
      error: "Escreva a pergunta e a resposta esperada.",
    };
  }
  if (!isAnswerLanguage(language)) {
    return { ok: false, error: "Escolha a língua da resposta." };
  }
  if (!(audio instanceof Blob)) {
    return { ok: false, error: "A gravação não chegou." };
  }

  const answer = await judgeAnswer(appJudge(), {
    audio: new Uint8Array(await audio.arrayBuffer()),
    question,
    expected,
    answerLanguage: language,
  });
  if (answer.kind === "refused") {
    return { ok: false, error: REFUSALS[answer.reason] };
  }
  if (answer.kind === "unconfigured") {
    return {
      ok: false,
      error: "O juiz não está configurado aqui: falta a OPENAI_API_KEY.",
    };
  }
  return { ok: true, take: answer.take };
}
