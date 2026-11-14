"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import { formatLessonDate, formatLessonTime } from "@/lib/datetime";
import { proposalStarts, quarterHours } from "@/lib/lessons/proposal-form";

/** What a proposal action answers, on both screens. */
export type ProposalResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

/** Who the proposal goes to: chosen from a list, or one person already. */
export type ProposalTarget = {
  /** The form field the action reads: student_id or teacher_id. */
  readonly field: "student_id" | "teacher_id";
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly name: string }[];
};

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const buttonClass =
  "border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const fieldClass =
  "border-rule bg-surface text-foreground rounded-sm border px-2 py-1.5 text-sm";

/**
 * One lesson or a series, proposed to the other side (#319). The list of
 * lessons is shown before sending, computed by the same function the server
 * reads the form with, in the proposer's zone: what she sees is what the
 * other side will accept.
 */
export function ProposalForm({
  target,
  zone,
  action,
  submitLabel,
  note,
}: {
  readonly target: ProposalTarget;
  readonly zone: string;
  readonly action: (form: FormData) => Promise<ProposalResult>;
  readonly submitLabel: string;
  readonly note: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [mode, setMode] = useState<"single" | "series">("single");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [weekdays, setWeekdays] = useState<readonly number[]>([]);
  const [firstDate, setFirstDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const form = useRef<HTMLFormElement>(null);

  const preview = useMemo(
    () =>
      proposalStarts({ mode, date, time, weekdays, firstDate, lastDate }, zone),
    [mode, date, time, weekdays, firstDate, lastDate, zone],
  );

  function toggle(day: number) {
    setWeekdays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    );
  }

  return (
    <form
      ref={form}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          let answer: ProposalResult;
          try {
            answer = await action(data);
          } catch {
            answer = {
              ok: false,
              error:
                "A resposta não chegou. Recarregue a página para conferir.",
            };
          }
          setResult(answer);
          if (answer.ok) {
            setDate("");
            setWeekdays([]);
            setFirstDate("");
            setLastDate("");
          }
        });
      }}
    >
      {target.options.length === 1 ? (
        <p className="text-sm">
          {target.label}: {target.options[0].name}
          <input
            type="hidden"
            name={target.field}
            value={target.options[0].id}
          />
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          {target.label}
          <select name={target.field} required className={fieldClass}>
            {target.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Uma aula ou uma série</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="single"
            checked={mode === "single"}
            onChange={() => setMode("single")}
          />
          Uma aula
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="series"
            checked={mode === "series"}
            onChange={() => setMode("series")}
          />
          Uma série
        </label>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        {mode === "single" ? (
          <label className="flex flex-col gap-1 text-sm">
            Dia
            <input
              name="date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Primeira data
              <input
                name="first_date"
                type="date"
                required
                value={firstDate}
                onChange={(event) => setFirstDate(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Última data
              <input
                name="last_date"
                type="date"
                required
                value={lastDate}
                onChange={(event) => setLastDate(event.target.value)}
                className={fieldClass}
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Hora
          <select
            name="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={fieldClass}
          >
            {quarterHours().map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === "series" ? (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1">Dias da semana</legend>
          {WEEKDAY_SHORT.map((name, day) => (
            <label key={name} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="weekday"
                value={day}
                checked={weekdays.includes(day)}
                onChange={() => toggle(day)}
              />
              {name}
            </label>
          ))}
        </fieldset>
      ) : null}

      {preview.ok ? (
        <div className="text-sm">
          <p className="font-semibold">
            {preview.values.length === 1
              ? "A aula proposta:"
              : `As ${preview.values.length} aulas propostas:`}
          </p>
          <ul className="text-muted list-disc pl-5">
            {preview.values.map((start) => (
              <li key={start.toISOString()} className="first-letter:uppercase">
                {formatLessonDate(start, zone)}, {formatLessonTime(start, zone)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-faint text-sm">{preview.message}</p>
      )}

      <p className="text-faint text-xs">{note}</p>

      <button
        type="submit"
        disabled={pending || !preview.ok}
        className={`${buttonClass} self-start`}
      >
        {pending ? "enviando" : submitLabel}
      </button>

      {result === null ? null : result.ok ? (
        <p role="status" className="border-rule rounded-sm border p-3 text-sm">
          {result.message}
        </p>
      ) : (
        <p
          role="alert"
          className="text-accent border-accent rounded-sm border p-3 text-sm"
        >
          {result.error}
        </p>
      )}
    </form>
  );
}
