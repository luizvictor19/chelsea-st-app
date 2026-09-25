"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { SttCase, SttCategory } from "@/lib/stt/cases";

import { saveSttRecording } from "./actions";
import { readServerSupport, readSupport, subscribe } from "./audio-test-panel";
import type { RecordingStatus } from "./stt-recordings";
import { type Take, useHoldRecorder } from "./use-hold-recorder";

const CATEGORY_LABELS: Record<SttCategory, string> = {
  correct: "Frases corretas",
  grammar_error: "Erros de gramática",
  pronunciation: "Pronúncia",
  hesitation: "Hesitação",
  mixed_portuguese: "Mistura com português",
  silence_noise: "Silêncio e ruído",
};

/**
 * One case: what the tutor asked, what to say, and a button to hold.
 *
 * Recording again replaces the file on disk, and the button says so before it
 * is pressed: a take that was fine is otherwise lost without a word.
 */
function CaseRow({
  sttCase,
  status,
  onSaved,
  ready,
}: {
  sttCase: SttCase;
  status: RecordingStatus | undefined;
  onSaved: (id: string, status: RecordingStatus) => void;
  ready: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const save = useCallback(
    async (take: Take) => {
      setSaving(true);
      setError(null);
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(take.blob);
      setUrl(urlRef.current);

      const form = new FormData();
      form.set("id", sttCase.id);
      form.set("seconds", String(take.seconds));
      form.set(
        "audio",
        new Blob([take.blob], { type: take.mimeType || take.blob.type }),
      );
      try {
        const result = await saveSttRecording(form);
        if (result.ok) onSaved(sttCase.id, result.status);
        else setError(result.error);
      } catch {
        setError(
          "Não foi possível salvar. A gravação anterior, se havia, continua.",
        );
      } finally {
        setSaving(false);
      }
    },
    [sttCase.id, onSaved],
  );

  const { recording, notice, holdProps } = useHoldRecorder(
    ready && !saving,
    save,
  );

  const recorded = status !== undefined;
  const label = recording
    ? "Gravando, solte para parar"
    : saving
      ? "Salvando"
      : recorded
        ? "Segurar para regravar (substitui a atual)"
        : "Segurar para gravar";

  return (
    <li className="border-rule flex flex-col gap-3 border-t py-5 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-faint font-mono text-xs">{sttCase.id}</p>
        <p className="text-muted text-sm">Pergunta: {sttCase.question}</p>
        <p className="text-lg font-semibold">
          {sttCase.spoken === "" ? "(sem fala)" : sttCase.spoken}
        </p>
        {sttCase.direction !== undefined && (
          <p className="text-muted text-sm">{sttCase.direction}</p>
        )}
        {sttCase.errorSpan !== undefined && (
          <p className="text-faint font-mono text-xs">
            erro: {sttCase.errorSpan} · correção: {sttCase.correctedSpan}
          </p>
        )}
      </div>
      <div className="flex flex-col items-start gap-2 sm:w-72 sm:shrink-0">
        <button
          type="button"
          disabled={!ready || saving}
          {...holdProps}
          className={
            recording
              ? "border-foreground bg-foreground text-background touch-none rounded-sm border px-4 py-2.5 text-sm font-semibold select-none"
              : "border-rule hover:bg-surface touch-none rounded-sm border px-4 py-2.5 text-sm font-semibold transition-colors select-none disabled:opacity-50"
          }
        >
          {label}
        </button>
        <p className="text-faint font-mono text-xs">
          {recorded
            ? `gravado${status.seconds === null ? "" : ` · ${status.seconds.toFixed(1)} s`}`
            : "sem gravação"}
        </p>
        {(error ?? notice) !== null && (
          <p className="text-muted text-sm">{error ?? notice}</p>
        )}
        {url !== null && (
          <audio controls src={url} className="w-full max-w-xs" />
        )}
      </div>
    </li>
  );
}

/**
 * The STT measurement cases, for recording one by one. Development only; the
 * page decides whether to render it.
 */
export function SttCasesPanel({
  cases,
  initial,
}: {
  cases: readonly SttCase[];
  initial: Record<string, RecordingStatus>;
}) {
  const { browser, reason } = useSyncExternalStore(
    subscribe,
    readSupport,
    readServerSupport,
  );
  const [status, setStatus] = useState(initial);
  const onSaved = useCallback((id: string, saved: RecordingStatus) => {
    setStatus((current) => ({ ...current, [id]: saved }));
  }, []);
  const categories = [...new Set(cases.map((each) => each.category))];
  const recordedCount = cases.filter((each) => status[each.id]).length;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-extrabold tracking-tight">Casos de STT</h2>
        <p className="text-muted max-w-prose text-sm">
          Leia exatamente a frase em destaque, com o erro. Cada gravação é salva
          em fixtures/stt, fora do git. {recordedCount} de {cases.length}{" "}
          gravados.
        </p>
        {reason !== null && <p className="text-muted text-sm">{reason}</p>}
      </div>
      {categories.map((category) => (
        <div key={category} className="flex flex-col">
          <h3 className="text-faint pb-2 font-mono text-xs tracking-[0.16em] uppercase">
            {CATEGORY_LABELS[category]}
          </h3>
          <ul className="flex flex-col">
            {cases
              .filter((each) => each.category === category)
              .map((each) => (
                <CaseRow
                  key={each.id}
                  sttCase={each}
                  status={status[each.id]}
                  onSaved={onSaved}
                  ready={browser === "ready"}
                />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
