import { AudioRecorder } from "./audio-recorder";

/**
 * Throwaway page used to validate browser audio recording on real devices,
 * iPhone Safari in particular, before the daily challenge is built on top of it.
 */
export default function AudioSpikePage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Teste de gravação</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Grave uma frase curta e ouça de volta. Se funcionar aqui, funciona no
          desafio do dia.
        </p>
      </header>
      <AudioRecorder />
    </main>
  );
}
