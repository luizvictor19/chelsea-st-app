"use server";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { requireTeacher } from "@/lib/content/queries";

import {
  STT_AUDIO_DIR,
  readSttCases,
  sttCasesEnabled,
  type RecordingStatus,
} from "./stt-recordings";

/** A few seconds of Opus is tens of kilobytes; this is far above any case. */
const MAX_BYTES = 900 * 1024;

export type SaveResult =
  | { readonly ok: true; readonly status: RecordingStatus }
  | { readonly ok: false; readonly error: string };

/**
 * Saves one STT case recording as fixtures/stt/<id>.webm, replacing any
 * earlier take, with a sidecar <id>.json holding its duration: a webm from
 * MediaRecorder carries no duration in its header, and the report estimates
 * cost from it.
 *
 * The answer carries the new status, so the panel does not have to trust
 * that a re-render arrived to know the file is there.
 */
export async function saveSttRecording(form: FormData): Promise<SaveResult> {
  if (!sttCasesEnabled()) {
    return { ok: false, error: "Disponível só em desenvolvimento." };
  }
  await requireTeacher();

  const id = form.get("id");
  const audio = form.get("audio");
  const seconds = Number(form.get("seconds"));

  // The id becomes a filename, so it is only accepted if it names a case.
  const cases = readSttCases();
  if (typeof id !== "string" || !cases.some((each) => each.id === id)) {
    return { ok: false, error: "Caso desconhecido." };
  }
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { ok: false, error: "A gravação chegou vazia." };
  }
  if (audio.size > MAX_BYTES) {
    return { ok: false, error: "A gravação é grande demais." };
  }
  // The files are named .webm and measured as webm; anything else would be
  // mislabelled on disk.
  if (!audio.type.toLowerCase().startsWith("audio/webm")) {
    return {
      ok: false,
      error: `Este navegador gravou ${audio.type || "um formato desconhecido"}, e os casos são gravados em webm. Use o Chrome do computador.`,
    };
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, error: "Duração da gravação inválida." };
  }

  const recordedAt = new Date().toISOString();
  await mkdir(STT_AUDIO_DIR, { recursive: true });
  await writeFile(
    join(STT_AUDIO_DIR, `${id}.webm`),
    new Uint8Array(await audio.arrayBuffer()),
  );
  await writeFile(
    join(STT_AUDIO_DIR, `${id}.json`),
    `${JSON.stringify({ seconds, mimeType: audio.type, bytes: audio.size, recordedAt }, null, 2)}\n`,
  );

  return { ok: true, status: { seconds, recordedAt } };
}
