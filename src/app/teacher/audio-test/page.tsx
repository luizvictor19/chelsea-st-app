import type { Metadata } from "next";

import { requireTeacher } from "@/lib/content/queries";

import { AudioTestPanel } from "./audio-test-panel";
import { JudgePanel } from "./judge-panel";
import { SttCasesPanel } from "./stt-cases-panel";
import {
  readRecordingStatus,
  readSttCases,
  sttCasesEnabled,
} from "./stt-recordings";

export const metadata: Metadata = {
  title: "Teste de áudio",
};

/**
 * A scratch page for one question: what does recording actually produce on the
 * machine in front of you. The role check lives in the teacher layout.
 *
 * In development it also records the STT measurement cases to disk; see
 * scripts/measure-stt.ts. That part is absent from any other build.
 *
 * The platform admin also gets "Julgar uma resposta" (#249), the app's judge
 * on one spoken answer. Hidden from anyone else because each hold is a paid
 * call; its action checks the same on its own (judge-actions.ts).
 */
export default async function AudioTestPage() {
  const { access } = await requireTeacher();
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
      {access.platformAdmin && (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Julgar uma resposta
          </h2>
          <p className="text-muted max-w-prose">
            O juiz do app numa resposta falada, gravada aqui em WAV, como o
            tutor vai fazer. A gravação vai para o juiz e volta com o veredito;
            nada fica salvo.
          </p>
          <JudgePanel />
        </section>
      )}
      {cases !== null && (
        <SttCasesPanel cases={cases} initial={readRecordingStatus(cases)} />
      )}
    </section>
  );
}
