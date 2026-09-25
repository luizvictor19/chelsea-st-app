import type { Metadata } from "next";

import { AudioTestPanel } from "./audio-test-panel";
import { SttCasesPanel } from "./stt-cases-panel";
import {
  readRecordingStatus,
  readSttCases,
  sttCasesEnabled,
} from "./stt-recordings";

export const metadata: Metadata = {
  title: "Teste de áudio · Chelsea St",
};

/**
 * A scratch page for one question: what does recording actually produce on the
 * machine in front of you. The role check lives in the teacher layout.
 *
 * In development it also records the STT measurement cases to disk; see
 * scripts/measure-stt.ts. That part is absent from any other build.
 */
export default function AudioTestPage() {
  const cases = sttCasesEnabled() ? readSttCases() : null;

  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col gap-4">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Teste de áudio
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Como este aparelho grava
        </h1>
        <p className="text-muted max-w-prose">
          Uma página de teste, para descobrir o que a gravação produz aqui antes
          de o tutor depender disso. O teste abaixo não envia nem salva nada: a
          gravação fica só na memória do navegador até a próxima.
        </p>
      </div>
      <AudioTestPanel />
      {cases !== null && (
        <SttCasesPanel cases={cases} initial={readRecordingStatus(cases)} />
      )}
    </section>
  );
}
