import type { ReactNode } from "react";

import { RangeForm } from "./book-workbench";

/**
 * One step of the sequence, with its number and the rail that joins it to the
 * next. A step that is still waiting is dimmed: what the teacher can do now has
 * to be the only thing that looks doable.
 */
function Step({
  number,
  title,
  active,
  last = false,
  children,
}: {
  number: number;
  title: string;
  active: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center pt-0.5">
        <span
          aria-hidden
          className={`flex h-[1.375rem] w-[1.375rem] shrink-0 items-center justify-center rounded-full font-mono text-[0.6875rem] ${
            active
              ? "bg-accent text-accent-foreground font-bold"
              : "border-rule text-faint border"
          }`}
        >
          {number}
        </span>
        {!last && <span aria-hidden className="bg-rule my-2 w-px grow" />}
      </div>
      <div
        className={`flex grow flex-col gap-3 ${last ? "" : "pb-7"} ${
          active ? "" : "opacity-45"
        }`}
      >
        <h2
          className={`text-[1.0625rem] font-bold tracking-tight ${
            active ? "" : "text-muted"
          }`}
        >
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}

function WaitingIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-faint"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

/**
 * A book with no range yet. Eleven of the twelve start here, so the screen is
 * only the one thing to do next, with the two that follow shown but out of
 * reach.
 */
export function SetupSteps() {
  return (
    <ol className="flex max-w-[45rem] flex-col">
      <Step number={1} title="Onde este livro começa e termina" active>
        <p className="text-muted max-w-[35rem] text-sm leading-relaxed">
          Abra o livro na primeira e na última página e copie os números da
          margem. Eles não vêm do lote que você vai subir, e não vêm do livro
          anterior: o livro 5 começa onde o livro 5 começa, mesmo que o 4 ainda
          não tenha subido.
        </p>
        <div className="border-rule bg-surface flex flex-col gap-3.5 rounded-sm border p-[1.125rem]">
          <RangeForm emphasis />
          <p className="text-faint text-xs leading-relaxed">
            Dá para corrigir depois. Estreitar a faixa só é recusado se algum
            ponto de fora já tiver conteúdo.
          </p>
        </div>
      </Step>

      <Step number={2} title="Subir as páginas" active={false}>
        <p className="text-faint max-w-[35rem] text-sm leading-relaxed">
          Fotografe ou digitalize as páginas do livro. Pode subir em qualquer
          ordem e em quantos lotes quiser.
        </p>
        <div className="border-rule flex flex-col items-center gap-2 rounded-sm border border-dashed px-5 py-6">
          <WaitingIcon />
          <p className="text-faint text-sm">
            Defina a faixa acima para liberar o envio
          </p>
        </div>
      </Step>

      <Step number={3} title="Revisar e gravar" active={false} last>
        <p className="text-faint max-w-[35rem] text-sm leading-relaxed">
          A leitura acontece neste computador e as páginas não saem daqui. Nada
          é gravado antes de você confirmar página por página.
        </p>
      </Step>
    </ol>
  );
}
