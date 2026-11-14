"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import type { ProposalItem } from "@/lib/lessons/proposals/view";
import { creditsLabel, type SlotDay } from "@/lib/lessons/slots";

import { ProposalForm } from "../../proposal-form";
import { ProposalList } from "../../proposal-list";
import { STUDENT_ACCEPT_NOTE } from "../proposal-card";
import {
  answerMyProposal,
  bookLesson,
  cancelMyLesson,
  proposeToTeacher,
  withdrawMyProposal,
  type LessonResult,
} from "./actions";

type MyLessonItem = {
  readonly id: string;
  readonly label: string;
  readonly teacher: string | null;
  readonly meetUrl: string | null;
  /** What her cancel would do now, said in the confirmation. */
  readonly refundNote: string;
  readonly started: boolean;
  /** Booked by her; a lesson of the fixed agenda is the teacher's to move. */
  readonly booked: boolean;
};

type Chosen = {
  readonly id: string;
  readonly name: string;
  /** What a lesson costs her; null while lessons are not on sale. */
  readonly credits: number | null;
};

type Picked = { readonly startsAt: string; readonly label: string };

const buttonClass =
  "border-rule hover:bg-background rounded-sm border px-3 py-1.5 text-sm transition-colors disabled:opacity-50";
const primaryClass =
  "border-foreground bg-foreground text-background rounded-sm border px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
const dialogClass =
  "border-rule bg-surface text-foreground m-auto max-w-sm rounded-sm border p-6 backdrop:bg-black/40";

/** Runs an action and keeps what it said, to show above the lists. */
function useAction() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LessonResult | null>(null);
  function run(action: () => Promise<LessonResult>) {
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({
          ok: false,
          error: "A resposta não chegou. Recarregue a página para conferir.",
        });
      }
    });
  }
  return { pending, result, run };
}

function weekHref(teacherId: string, week: number): string {
  return `/dashboard/lessons?professor=${teacherId}&semana=${week}`;
}

export function LessonsView({
  readError,
  mine,
  teachers,
  chosen,
  balance,
  week,
  lastWeek,
  days,
  zone,
}: {
  readonly readError: string | null;
  readonly mine: readonly MyLessonItem[];
  readonly teachers: readonly { id: string; name: string }[];
  readonly chosen: Chosen | null;
  readonly balance: number | null;
  readonly week: number;
  readonly lastWeek: number;
  readonly days: readonly SlotDay[];
  readonly zone: string;
}) {
  const { pending, result, run } = useAction();
  const bookDialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const short =
    chosen?.credits != null && balance !== null && balance < chosen.credits;

  return (
    <>
      {result === null ? null : result.ok ? (
        <p role="status" className="border-rule rounded-sm border p-3">
          {result.message}
        </p>
      ) : (
        <p
          role="alert"
          className="text-accent border-accent rounded-sm border p-3"
        >
          {result.error}
        </p>
      )}

      <section aria-labelledby="mine" className="flex flex-col gap-3">
        <h2 id="mine" className="text-xl font-bold tracking-tight">
          Suas próximas aulas
        </h2>
        {mine.length === 0 ? (
          <p className="text-muted text-sm">Nenhuma aula marcada.</p>
        ) : (
          <ul className="border-rule divide-rule divide-y rounded-sm border">
            {mine.map((lesson) => (
              <MyLessonRow
                key={lesson.id}
                lesson={lesson}
                pending={pending}
                onCancel={() => run(() => cancelMyLesson(lesson.id))}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="book" className="flex flex-col gap-3">
        <h2 id="book" className="text-xl font-bold tracking-tight">
          Reservar aula
        </h2>
        {readError !== null ? (
          <p role="alert" className="text-accent text-sm">
            {readError}
          </p>
        ) : chosen === null ? (
          <p className="text-muted text-sm">
            Nenhum professor com horários abertos agora.
          </p>
        ) : chosen.credits === null ? (
          <p className="text-muted text-sm">
            As aulas ainda não estão à venda.
          </p>
        ) : (
          <>
            {teachers.length > 1 ? (
              <nav aria-label="Professor" className="flex flex-wrap gap-2">
                {teachers.map((teacher) => (
                  <Link
                    key={teacher.id}
                    href={weekHref(teacher.id, week)}
                    aria-current={teacher.id === chosen.id ? "page" : undefined}
                    className={
                      teacher.id === chosen.id ? primaryClass : buttonClass
                    }
                  >
                    {teacher.name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <p className="text-muted text-sm">
              Com {chosen.name} · {creditsLabel(chosen.credits)} por aula ·
              horários no seu fuso ({zone}).
            </p>
            <div className="flex items-center justify-between gap-2">
              {week > 0 ? (
                <Link
                  href={weekHref(chosen.id, week - 1)}
                  className={buttonClass}
                >
                  Semana anterior
                </Link>
              ) : (
                <span />
              )}
              {week < lastWeek ? (
                <Link
                  href={weekHref(chosen.id, week + 1)}
                  className={buttonClass}
                >
                  Próxima semana
                </Link>
              ) : null}
            </div>
            {days.length === 0 ? (
              <p className="text-muted text-sm">
                Nenhum horário livre nesta semana.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {days.map((day) => (
                  <li key={day.key} className="flex flex-col gap-2">
                    <p className="font-semibold first-letter:uppercase">
                      {day.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {day.slots.map((slot) => (
                        <button
                          key={slot.startsAt}
                          type="button"
                          disabled={pending}
                          className={buttonClass}
                          onClick={() => {
                            setPicked({
                              startsAt: slot.startsAt,
                              label: `${slot.time} de ${day.label}`,
                            });
                            bookDialog.current?.showModal();
                          }}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <dialog
        ref={bookDialog}
        aria-labelledby="book-title"
        className={dialogClass}
      >
        <div className="flex flex-col gap-4">
          <h2
            id="book-title"
            className="text-base font-extrabold tracking-tight"
          >
            Reservar {picked?.label}?
          </h2>
          {chosen?.credits != null ? (
            <p className="text-muted text-sm">
              Com {chosen.name}. Custa {creditsLabel(chosen.credits)}
              {balance === null
                ? "."
                : `; seu saldo é ${creditsLabel(balance)}.`}{" "}
              Os créditos voltam se você cancelar dentro do prazo, que aparece
              na aula reservada.
            </p>
          ) : null}
          {short ? (
            <p className="text-accent text-sm">
              Seu saldo não cobre esta aula.{" "}
              <Link href="/dashboard/plano" className="underline">
                Ver plano e créditos
              </Link>
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <form method="dialog">
              <button type="submit" className={buttonClass}>
                Voltar
              </button>
            </form>
            <button
              type="button"
              disabled={pending || short || picked === null || chosen === null}
              className={primaryClass}
              onClick={() => {
                bookDialog.current?.close();
                if (picked !== null && chosen !== null) {
                  run(() => bookLesson(chosen.id, picked.startsAt));
                }
              }}
            >
              {chosen?.credits != null
                ? `Reservar por ${creditsLabel(chosen.credits)}`
                : "Reservar"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function MyLessonRow({
  lesson,
  pending,
  onCancel,
}: {
  readonly lesson: MyLessonItem;
  readonly pending: boolean;
  readonly onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = `cancelar-${lesson.id}`;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="flex flex-col">
        <span className="first-letter:uppercase">{lesson.label}</span>
        {lesson.teacher === null ? null : (
          <span className="text-muted text-sm">Com {lesson.teacher}</span>
        )}
      </span>
      {lesson.started ? (
        lesson.meetUrl === null ? null : (
          <a
            href={lesson.meetUrl}
            target="_blank"
            rel="noreferrer"
            className={primaryClass}
          >
            Entrar na aula
          </a>
        )
      ) : lesson.booked ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => dialog.current?.showModal()}
          className={buttonClass}
        >
          Cancelar
        </button>
      ) : (
        <span className="text-muted text-sm">
          Para mudar esta aula, fale com o professor.
        </span>
      )}
      <dialog ref={dialog} aria-labelledby={titleId} className={dialogClass}>
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-base font-extrabold tracking-tight">
            Cancelar a aula de {lesson.label}?
          </h2>
          <p className="text-muted text-sm">{lesson.refundNote}</p>
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
                onCancel();
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

/**
 * Her proposals, both ways, and the form to propose a time outside the free
 * slots (#319). The teacher's open ones are also the cards on /dashboard.
 */
export function ProposalsSection({
  items,
  teachers,
  zone,
}: {
  readonly items: readonly ProposalItem[];
  readonly teachers: readonly { id: string; name: string }[];
  readonly zone: string;
}) {
  return (
    <section aria-labelledby="proposals" className="flex flex-col gap-3">
      <h2 id="proposals" className="text-xl font-bold tracking-tight">
        Propostas
      </h2>
      {items.length === 0 ? (
        <p className="text-muted text-sm">Nenhuma proposta nos últimos dias.</p>
      ) : (
        <ProposalList
          items={items}
          answer={answerMyProposal}
          withdraw={withdrawMyProposal}
          acceptNote={STUDENT_ACCEPT_NOTE}
        />
      )}
      <h3 className="text-base font-bold tracking-tight">
        Propor outro horário
      </h3>
      {teachers.length === 0 ? (
        <p className="text-muted text-sm">
          Nenhum professor aceitando aulas agora.
        </p>
      ) : (
        <ProposalForm
          target={{
            field: "teacher_id",
            label: "Professor",
            options: teachers,
          }}
          zone={zone}
          action={proposeToTeacher}
          submitLabel="Enviar proposta"
          note={`Hora no seu fuso (${zone}). Para um horário fora dos livres: o professor aceita ou recusa, e os créditos saem só no aceite. Seu saldo precisa cobrir a proposta agora. Uma proposta aberta por professor; ela vale 3 dias, ou até 1 hora antes da primeira aula.`}
        />
      )}
    </section>
  );
}
