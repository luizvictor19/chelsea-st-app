"use client";

import { useRef, useTransition, type FormEvent } from "react";

import { notices } from "../notices";
import { WEEKDAYS } from "../students/agenda";
import {
  addTimeOff,
  addWindow,
  cancelBookedLesson,
  removeTimeOff,
  removeWindow,
  saveTeacherProfile,
  type AgendaResult,
} from "./actions";
import type { TeacherProfile } from "./queries";

type WindowItem = {
  readonly id: string;
  readonly label: string;
  /** The window's zone when it is not hers any more. */
  readonly otherZone: string | null;
};

type TimeOffItem = { readonly id: string; readonly label: string };

type LessonItem = {
  readonly id: string;
  readonly label: string;
  readonly student: string;
  readonly running: boolean;
  readonly progress: string;
  readonly lastNote: string | null;
  /** What the cancel gives the student back, said in the confirmation. */
  readonly refund: string;
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
  function run(action: () => Promise<AgendaResult>, onDone?: () => void) {
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
        onDone?.();
      } else {
        notices.push("error", result.error);
      }
    });
  }
  return { pending, run };
}

/** The form's fields, for an action that reads FormData. */
function submitted(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export function TeacherAgendaView({
  organizationId,
  organizationName,
  profile,
  zone,
  windows,
  timeOff,
  lessons,
}: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly profile: TeacherProfile | null;
  readonly zone: string;
  readonly windows: readonly WindowItem[];
  readonly timeOff: readonly TimeOffItem[];
  readonly lessons: readonly LessonItem[];
}) {
  return (
    <>
      <ProfileSection
        organizationId={organizationId}
        organizationName={organizationName}
        profile={profile}
      />
      {profile === null ? (
        <p className="text-muted text-sm">
          Salve o perfil para publicar os seus horários.
        </p>
      ) : (
        <>
          <WindowSection teacherId={profile.id} windows={windows} zone={zone} />
          <TimeOffSection
            teacherId={profile.id}
            timeOff={timeOff}
            zone={zone}
          />
          <LessonSection lessons={lessons} />
        </>
      )}
    </>
  );
}

function ProfileSection({
  organizationId,
  organizationName,
  profile,
}: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly profile: TeacherProfile | null;
}) {
  const { pending, run } = useAction();

  return (
    <section aria-labelledby="profile" className="flex flex-col gap-3">
      <h2 id="profile" className="text-xl font-bold tracking-tight">
        Seu perfil em {organizationName}
      </h2>
      <p className="text-muted max-w-prose text-sm">
        O link do Meet é o mesmo em todas as aulas, e o aluno o vê na aula
        reservada. O e-mail da agenda é onde os convites vão chegar; pode ser
        outro que o do login.
      </p>
      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(event) => {
          const data = submitted(event);
          run(() => saveTeacherProfile(data));
        }}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <label className="flex flex-col gap-1 text-sm">
          Link do Meet
          <input
            name="meet_url"
            type="url"
            inputMode="url"
            placeholder="https://meet.google.com/..."
            defaultValue={profile?.meetUrl ?? ""}
            className={`${fieldClass} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          E-mail da agenda
          <input
            name="calendar_email"
            type="email"
            inputMode="email"
            defaultValue={profile?.calendarEmail ?? ""}
            className={fieldClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="is_active"
            type="checkbox"
            defaultChecked={profile?.isActive ?? false}
          />
          Aceito reservas
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${buttonClass} self-start`}
        >
          {pending ? "salvando" : "Salvar perfil"}
        </button>
      </form>
    </section>
  );
}

function WindowSection({
  teacherId,
  windows,
  zone,
}: {
  readonly teacherId: string;
  readonly windows: readonly WindowItem[];
  readonly zone: string;
}) {
  const { pending, run } = useAction();
  const form = useRef<HTMLFormElement>(null);

  return (
    <section aria-labelledby="windows" className="flex flex-col gap-3">
      <h2 id="windows" className="text-xl font-bold tracking-tight">
        Janelas da semana
      </h2>
      {windows.length === 0 ? (
        <p className="text-muted text-sm">
          Nenhuma janela ainda: o aluno não vê horário livre.
        </p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {windows.map((window) => (
            <RemovableRow
              key={window.id}
              label={
                window.otherZone === null
                  ? window.label
                  : `${window.label} (${window.otherZone})`
              }
              onRemove={() => removeWindow(window.id)}
            />
          ))}
        </ul>
      )}
      <form
        ref={form}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          const data = submitted(event);
          run(
            () => addWindow(data),
            () => form.current?.reset(),
          );
        }}
      >
        <input type="hidden" name="teacher_id" value={teacherId} />
        <label className="flex flex-col gap-1 text-sm">
          Dia
          <select name="weekday" defaultValue="1" className={fieldClass}>
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Das
          <input
            name="start_time"
            type="time"
            required
            defaultValue="09:00"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Até
          <input
            name="end_time"
            type="time"
            required
            defaultValue="12:00"
            className={fieldClass}
          />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "salvando" : "Adicionar janela"}
        </button>
      </form>
      <p className="text-faint text-xs">
        Hora no seu fuso ({zone}). Os horários começam na hora da janela, um a
        cada hora, e a aula inteira cabe dentro dela.
      </p>
    </section>
  );
}

function TimeOffSection({
  teacherId,
  timeOff,
  zone,
}: {
  readonly teacherId: string;
  readonly timeOff: readonly TimeOffItem[];
  readonly zone: string;
}) {
  const { pending, run } = useAction();
  const form = useRef<HTMLFormElement>(null);

  return (
    <section aria-labelledby="time-off" className="flex flex-col gap-3">
      <h2 id="time-off" className="text-xl font-bold tracking-tight">
        Folgas
      </h2>
      {timeOff.length === 0 ? (
        <p className="text-muted text-sm">Nenhuma folga marcada.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {timeOff.map((item) => (
            <RemovableRow
              key={item.id}
              label={item.label}
              onRemove={() => removeTimeOff(item.id)}
            />
          ))}
        </ul>
      )}
      <form
        ref={form}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          const data = submitted(event);
          run(
            () => addTimeOff(data),
            () => form.current?.reset(),
          );
        }}
      >
        <input type="hidden" name="teacher_id" value={teacherId} />
        <label className="flex flex-col gap-1 text-sm">
          Primeiro dia
          <input name="from" type="date" required className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Último dia
          <input name="to" type="date" className={fieldClass} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "salvando" : "Adicionar folga"}
        </button>
      </form>
      <p className="text-faint text-xs">
        Dias inteiros, no seu fuso ({zone}). Uma aula já reservada na folga
        continua: cancele-a abaixo se não for dar.
      </p>
    </section>
  );
}

function RemovableRow({
  label,
  onRemove,
}: {
  readonly label: string;
  readonly onRemove: () => Promise<AgendaResult>;
}) {
  const { pending, run } = useAction();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span>{label}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(onRemove)}
        className={quietClass}
      >
        {pending ? "removendo" : "Remover"}
      </button>
    </li>
  );
}

function LessonSection({
  lessons,
}: {
  readonly lessons: readonly LessonItem[];
}) {
  return (
    <section aria-labelledby="booked" className="flex flex-col gap-3">
      <h2 id="booked" className="text-xl font-bold tracking-tight">
        Aulas reservadas
      </h2>
      {lessons.length === 0 ? (
        <p className="text-muted text-sm">Nenhuma aula reservada.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LessonRow({ lesson }: { readonly lesson: LessonItem }) {
  const { pending, run } = useAction();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = `cancelar-${lesson.id}`;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="first-letter:uppercase">
          {lesson.label} · {lesson.student}
          {lesson.running ? (
            <span className="text-accent text-sm"> · em andamento</span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => dialog.current?.showModal()}
          className={buttonClass}
        >
          {pending ? "cancelando" : "Cancelar"}
        </button>
      </div>
      <p className="text-muted text-sm">Parou em: {lesson.progress}</p>
      {lesson.lastNote === null ? null : (
        <p className="text-muted text-sm">Última nota: {lesson.lastNote}</p>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-extrabold tracking-tight">
            Cancelar a aula de {lesson.label}?
          </h2>
          <p className="text-muted text-sm">{lesson.refund}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <form method="dialog">
              <button type="submit" className={buttonClass}>
                Voltar
              </button>
            </form>
            <button
              type="button"
              className={primaryClass}
              onClick={() => {
                dialog.current?.close();
                run(() => cancelBookedLesson(lesson.id));
              }}
            >
              Cancelar a aula
            </button>
          </div>
        </div>
      </dialog>
    </li>
  );
}
