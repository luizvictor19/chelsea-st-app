"use client";

import { useRef, useTransition, type ReactNode, type RefObject } from "react";

import { notices } from "../../notices";
import { cancelLesson, type AgendaResult } from "../actions";

type LessonItem = {
  readonly id: string;
  readonly label: string;
  readonly running: boolean;
};

const buttonClass =
  "border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const quietClass =
  "text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const primaryClass =
  "border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

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
  lessons,
}: {
  readonly lessons: readonly LessonItem[];
}) {
  return (
    <section aria-labelledby="lessons" className="flex flex-col gap-3">
      <h2 id="lessons" className="text-xl font-bold tracking-tight">
        Próximas aulas
      </h2>
      <p className="text-faint text-xs">
        O aluno reserva cada aula na agenda dele. Remarcar é cancelar aqui e o
        aluno reservar outro horário.
      </p>
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
  const cancelDialog = useRef<HTMLDialogElement>(null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="first-letter:uppercase">
        {lesson.label}
        {lesson.running ? (
          <span className="text-accent text-sm"> · em andamento</span>
        ) : null}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => cancelDialog.current?.showModal()}
        className={quietClass}
      >
        {pending ? "cancelando" : "Cancelar aula"}
      </button>

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
          Ela sai da tela do aluno. Se ele pagou com créditos, os créditos
          voltam para ele.
        </p>
      </Confirm>
    </li>
  );
}
