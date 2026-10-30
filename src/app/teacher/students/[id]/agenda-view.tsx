"use client";

import {
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";

import { notices } from "../../notices";
import {
  addSchedule,
  cancelLesson,
  generateLessons,
  removeSchedule,
  rescheduleLesson,
  saveMeetUrl,
  type AgendaResult,
} from "../actions";
import { DEFAULT_DURATION_MINUTES, WEEKDAYS } from "../agenda";

type ScheduleItem = {
  readonly id: string;
  readonly label: string;
  /** Lessons ahead that leave with it, counted on the server. */
  readonly leaving: number;
};

type LessonItem = {
  readonly id: string;
  readonly label: string;
  readonly running: boolean;
  /** Its start as the date and time inputs hold it, in the teacher's zone. */
  readonly date: string;
  readonly time: string;
};

const buttonClass =
  "border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const quietClass =
  "text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const primaryClass =
  "border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
const fieldClass =
  "border-rule bg-surface text-foreground rounded-sm border px-2 py-1.5 text-sm";

/** Runs an action and says how it went, in the snackbar. */
function useAction() {
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<AgendaResult>) {
    startTransition(async () => {
      let result: AgendaResult;
      try {
        result = await action();
      } catch {
        result = {
          ok: false,
          error: "A resposta não chegou. Recarregue a página para conferir.",
        };
      }
      if (result.ok) {
        notices.push("success", result.message);
      } else {
        notices.push("error", result.error);
      }
    });
  }
  return { pending, run };
}

/** Esc or Voltar closes it; only the confirm button acts. */
function Confirm({
  id,
  title,
  children,
  confirm,
  onConfirm,
  dialog,
}: {
  readonly id: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly confirm: string;
  readonly onConfirm: () => void;
  readonly dialog: RefObject<HTMLDialogElement | null>;
}) {
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4">
        <h2 id={id} className="text-base font-extrabold tracking-tight">
          {title}
        </h2>
        {children}
        <div className="flex flex-wrap justify-end gap-2">
          <form method="dialog">
            <button type="submit" className={buttonClass}>
              Voltar
            </button>
          </form>
          <button type="button" onClick={onConfirm} className={primaryClass}>
            {confirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function AgendaView({
  studentId,
  meetUrl,
  schedules,
  lessons,
  horizon,
  warn,
  weeksAhead,
  zone,
}: {
  readonly studentId: string;
  readonly meetUrl: string | null;
  readonly schedules: readonly ScheduleItem[];
  readonly lessons: readonly LessonItem[];
  readonly horizon: string;
  readonly warn: boolean;
  readonly weeksAhead: number;
  readonly zone: string;
}) {
  return (
    <>
      <MeetSection studentId={studentId} meetUrl={meetUrl} />
      <ScheduleSection
        studentId={studentId}
        schedules={schedules}
        zone={zone}
      />
      <LessonSection
        studentId={studentId}
        lessons={lessons}
        horizon={horizon}
        warn={warn}
        weeksAhead={weeksAhead}
        zone={zone}
      />
    </>
  );
}

function MeetSection({
  studentId,
  meetUrl,
}: {
  readonly studentId: string;
  readonly meetUrl: string | null;
}) {
  const { pending, run } = useAction();
  const [value, setValue] = useState(meetUrl ?? "");

  return (
    <section aria-labelledby="meet" className="flex flex-col gap-3">
      <h2 id="meet" className="text-xl font-bold tracking-tight">
        Link do Meet
      </h2>
      <p className="text-muted max-w-prose text-sm">
        O mesmo link em todas as aulas. Crie no Google Agenda um evento
        recorrente com Meet, convide o e-mail do aluno e cole aqui o link do
        evento. Vazio apaga o link: o aluno vê que ele chega antes da aula.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => saveMeetUrl(studentId, value));
        }}
      >
        <input
          type="url"
          inputMode="url"
          aria-label="Link do Meet"
          placeholder="https://meet.google.com/..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${fieldClass} min-w-0 flex-1 font-mono`}
        />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "salvando" : "Salvar"}
        </button>
      </form>
    </section>
  );
}

function ScheduleSection({
  studentId,
  schedules,
  zone,
}: {
  readonly studentId: string;
  readonly schedules: readonly ScheduleItem[];
  readonly zone: string;
}) {
  const { pending, run } = useAction();
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("19:00");
  const [duration, setDuration] = useState(String(DEFAULT_DURATION_MINUTES));

  return (
    <section aria-labelledby="schedules" className="flex flex-col gap-3">
      <h2 id="schedules" className="text-xl font-bold tracking-tight">
        Horários da semana
      </h2>
      {schedules.length === 0 ? (
        <p className="text-muted text-sm">Nenhum horário ainda.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {schedules.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => addSchedule(studentId, weekday, time, Number(duration)));
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Dia
          <select
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
            className={fieldClass}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hora
          <input
            type="time"
            required
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Minutos
          <input
            type="number"
            min={1}
            required
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className={`${fieldClass} w-20`}
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "salvando" : "Adicionar horário"}
        </button>
      </form>
      <p className="text-faint text-xs">
        Hora no seu fuso ({zone}). Adicionar já gera as aulas.
      </p>
    </section>
  );
}

function ScheduleRow({ schedule }: { readonly schedule: ScheduleItem }) {
  const { pending, run } = useAction();
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span>{schedule.label}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => dialog.current?.showModal()}
        className={quietClass}
      >
        {pending ? "removendo" : "Remover"}
      </button>
      <Confirm
        id={`remover-${schedule.id}`}
        title={`Remover ${schedule.label}?`}
        confirm="Remover"
        dialog={dialog}
        onConfirm={() => {
          dialog.current?.close();
          run(() => removeSchedule(schedule.id));
        }}
      >
        <p className="text-muted text-sm">
          {schedule.leaving === 0
            ? "Nenhuma aula futura sai da agenda."
            : schedule.leaving === 1
              ? "1 aula futura sai da agenda."
              : `${schedule.leaving} aulas futuras saem da agenda.`}{" "}
          As aulas que já aconteceram ficam.
        </p>
      </Confirm>
    </li>
  );
}

function LessonSection({
  studentId,
  lessons,
  horizon,
  warn,
  weeksAhead,
  zone,
}: {
  readonly studentId: string;
  readonly lessons: readonly LessonItem[];
  readonly horizon: string;
  readonly warn: boolean;
  readonly weeksAhead: number;
  readonly zone: string;
}) {
  const { pending, run } = useAction();

  return (
    <section aria-labelledby="lessons" className="flex flex-col gap-3">
      <h2 id="lessons" className="text-xl font-bold tracking-tight">
        Próximas aulas
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => generateLessons(studentId))}
          className={buttonClass}
        >
          {pending ? "gerando" : "Gerar aulas"}
        </button>
        <span className={warn ? "text-accent text-sm" : "text-muted text-sm"}>
          {horizon}
          {warn ? " Faltam menos de 14 dias: gere mais." : ""}
        </span>
      </div>
      <p className="text-faint text-xs">
        Gera as aulas dos horários para as próximas {weeksAhead} semanas. Nunca
        duplica, e uma aula cancelada não volta.
      </p>
      {lessons.length === 0 ? (
        <p className="text-muted text-sm">Nenhuma aula agendada.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} zone={zone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LessonRow({
  lesson,
  zone,
}: {
  readonly lesson: LessonItem;
  readonly zone: string;
}) {
  const { pending, run } = useAction();
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(lesson.date);
  const [time, setTime] = useState(lesson.time);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="first-letter:uppercase">
        {lesson.label}
        {lesson.running ? (
          <span className="text-accent text-sm"> · em andamento</span>
        ) : null}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => moveDialog.current?.showModal()}
          className={buttonClass}
        >
          Remarcar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => cancelDialog.current?.showModal()}
          className={quietClass}
        >
          Cancelar aula
        </button>
      </div>

      <Confirm
        id={`cancelar-${lesson.id}`}
        title={`Cancelar a aula de ${lesson.label}?`}
        confirm="Cancelar aula"
        dialog={cancelDialog}
        onConfirm={() => {
          cancelDialog.current?.close();
          run(() => cancelLesson(lesson.id));
        }}
      >
        <p className="text-muted text-sm">
          Ela sai da tela do aluno e não volta ao gerar as aulas.
        </p>
      </Confirm>

      <Confirm
        id={`remarcar-${lesson.id}`}
        title={`Remarcar a aula de ${lesson.label}`}
        confirm="Remarcar"
        dialog={moveDialog}
        onConfirm={() => {
          moveDialog.current?.close();
          run(() => rescheduleLesson(lesson.id, date, time));
        }}
      >
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Data
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hora
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <p className="text-faint text-xs">
          No seu fuso ({zone}). A aula original fica cancelada.
        </p>
      </Confirm>
    </li>
  );
}
