"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { readWavHeader } from "@/lib/audio/wav";
import {
  createWavRecorder,
  wavRecordingUnavailableReason,
} from "@/lib/audio/wav-recorder";
import type { JudgedTake } from "@/lib/judge/judge-take";
import { type TakeOutcome, replyFor } from "@/lib/judge/outcome";
import type { Difference } from "@/lib/judge/provider";

import { judgeSpokenAnswer } from "./judge-actions";
import { type Take, useHoldRecorder } from "./use-hold-recorder";

type Support = "checking" | "ready" | "unsupported";

function subscribe(): () => void {
  return () => {};
}

function readSupport(): Support {
  return wavRecordingUnavailableReason() === null ? "ready" : "unsupported";
}

function readServerSupport(): Support {
  return "checking";
}

/** What the browser recorded, read back from the file it made. */
type Recorded = {
  readonly sampleRate: number;
  readonly channels: number;
  readonly seconds: number;
  readonly kilobytes: number;
};

const VERDICT_LABEL = {
  match: "Bate",
  mismatch: "Não bate",
  uncertain: "Incerto",
} as const;

function outcomeLabel(outcome: TakeOutcome): string {
  switch (outcome.kind) {
    case "verdict":
      return VERDICT_LABEL[outcome.verdict];
    case "retry":
      return outcome.reason === "silence" ? "Silêncio" : "Ruído";
    case "other-language":
      return "Outra língua";
    case "failure":
      return `Falha do juiz (${outcome.failure})`;
  }
}

function describeDifference(d: Difference): string {
  if (d.kind === "missing") return `faltou "${d.expected}"`;
  if (d.kind === "extra") return `sobrou "${d.said}"`;
  return `trocou "${d.expected}" por "${d.said}"`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-muted w-32 shrink-0">{label}</dt>
      <dd className="font-mono break-words">{value}</dd>
    </div>
  );
}

/**
 * "Julgar uma resposta": the judge of the app, on one answer, from the
 * browser's WAV to the verdict (#249). Only the platform admin sees it: every
 * hold is a paid call. Nothing is stored.
 */
export function JudgePanel() {
  const support = useSyncExternalStore(
    subscribe,
    readSupport,
    readServerSupport,
  );
  const [question, setQuestion] = useState("");
  const [expected, setExpected] = useState("");
  const [language, setLanguage] = useState<"en" | "pt">("en");
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [take, setTake] = useState<JudgedTake | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filled = question.trim() !== "" && expected.trim() !== "";

  const send = useCallback(
    async (recording: Take) => {
      setBusy(true);
      setTake(null);
      setError(null);
      try {
        const bytes = new Uint8Array(await recording.blob.arrayBuffer());
        const read = readWavHeader(bytes);
        setRecorded(
          read.ok
            ? {
                sampleRate: read.header.sampleRate,
                channels: read.header.channels,
                seconds: read.header.durationMs / 1000,
                kilobytes: bytes.length / 1024,
              }
            : null,
        );
        const form = new FormData();
        form.set("question", question);
        form.set("expected", expected);
        form.set("language", language);
        form.set("audio", recording.blob, "take.wav");
        const result = await judgeSpokenAnswer(form);
        if (result.ok) setTake(result.take);
        else setError(result.error);
      } catch {
        setError("Não consegui enviar a gravação. Tente de novo.");
      } finally {
        setBusy(false);
      }
    },
    [question, expected, language],
  );

  const { recording, notice, holdProps } = useHoldRecorder(
    support === "ready" && filled && !busy,
    send,
    createWavRecorder,
  );

  if (support === "unsupported") {
    return (
      <p className="border-rule text-muted max-w-prose rounded-sm border border-dashed p-6">
        {wavRecordingUnavailableReason()}
      </p>
    );
  }

  const reply = take === null ? null : replyFor(take.outcome);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Pergunta</span>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={500}
          className="border-rule bg-background rounded-sm border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Resposta esperada</span>
        <input
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
          maxLength={500}
          className="border-rule bg-background rounded-sm border px-3 py-2"
        />
      </label>
      <fieldset className="flex flex-wrap gap-5 text-sm">
        <legend className="text-muted mb-1.5">Língua da resposta</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="judge-language"
            checked={language === "en"}
            onChange={() => setLanguage("en")}
          />
          Inglês
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="judge-language"
            checked={language === "pt"}
            onChange={() => setLanguage("pt")}
          />
          Português (pergunta de tradução)
        </label>
      </fieldset>

      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          disabled={support !== "ready" || !filled || busy}
          {...holdProps}
          className={
            recording
              ? "border-foreground bg-foreground text-background touch-none rounded-sm border px-6 py-3.5 font-semibold select-none"
              : "border-rule hover:bg-surface touch-none rounded-sm border px-6 py-3.5 font-semibold transition-colors select-none disabled:opacity-50"
          }
        >
          {recording
            ? "Gravando, solte para julgar"
            : busy
              ? "Julgando..."
              : "Segurar para responder"}
        </button>
        <p className="text-faint text-sm">
          Cada vez é uma chamada paga ao juiz. Nada é gravado.
        </p>
      </div>

      {notice !== null && <p className="text-muted text-sm">{notice}</p>}
      {error !== null && <p className="text-sm">{error}</p>}

      {(recorded !== null || take !== null) && (
        <section className="border-rule flex flex-col gap-4 rounded-sm border p-6">
          <h3 className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Resultado
          </h3>
          <dl className="flex flex-col gap-2 text-sm">
            {recorded !== null && (
              <Row
                label="Gravação"
                value={`${recorded.sampleRate} Hz · ${recorded.channels === 1 ? "mono" : `${recorded.channels} canais`} · ${recorded.seconds.toFixed(1)} s · ${recorded.kilobytes.toFixed(0)} KB`}
              />
            )}
            {take !== null && (
              <>
                <Row label="Veredito" value={outcomeLabel(take.outcome)} />
                {reply !== null && <Row label="O tutor diz" value={reply} />}
                <Row label="Ouviu" value={take.heard ?? "·"} />
                <Row
                  label="Diferenças"
                  value={
                    take.differences.length === 0
                      ? "nenhuma"
                      : take.differences.map(describeDifference).join("; ")
                  }
                />
                <Row label="Tempo" value={`${take.ms} ms`} />
                <Row
                  label="Custo"
                  value={
                    take.costMicroUsd === null
                      ? "·"
                      : `US$ ${(take.costMicroUsd / 1_000_000).toFixed(6)}`
                  }
                />
                <Row label="Modelo" value={`${take.model} · ${take.prompt}`} />
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
