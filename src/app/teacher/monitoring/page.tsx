import type { Metadata } from "next";

import { requirePlatformAdmin } from "@/lib/auth";

import { TestButtons } from "./test-buttons";

export const metadata: Metadata = {
  title: "Erros",
};

const KIND_LABEL: Record<string, string> = {
  server: "servidor",
  client: "navegador",
  job: "rotina",
  overflow: "excesso",
};

function inBrasilia(instant: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(instant));
}

/**
 * The error log of the last 30 days (#69, 0063), for the platform admin
 * alone: app_errors_recent gives nobody else a row. What is here was
 * scrubbed before it was stored. The two buttons make one test error each.
 */
export default async function MonitoringPage() {
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("app_errors_recent");
  if (error) throw new Error(`app_errors_recent: ${error.code}`);
  // The generator marks every column of a returned table as not null; these
  // three are null when the error had none.
  const rows = (data ?? []).map((row) => ({
    ...row,
    stack: (row.stack as string | null) ?? null,
    digest: (row.digest as string | null) ?? null,
    release: (row.release as string | null) ?? null,
  }));

  return (
    <section className="flex max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Erros
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Erros do app</h1>
        <p className="text-muted max-w-prose">
          Cada erro aparece uma vez por dia (UTC), com quantas vezes aconteceu.
          Um erro novo manda um e-mail, até 20 por dia. Ficam 30 dias. Nada aqui
          leva o nome, o e-mail ou o que a pessoa disse: a mensagem é limpa
          antes de ser guardada.
        </p>
      </div>

      <section aria-labelledby="test" className="flex flex-col gap-3">
        <h2 id="test" className="text-xl font-bold tracking-tight">
          Teste
        </h2>
        <p className="text-muted text-sm">
          Cada botão gera o erro &ldquo;erro de teste do monitoramento&rdquo;. O
          do servidor troca esta página pela tela de erro; o do navegador não
          muda nada na tela. Os dois aparecem abaixo ao recarregar, só em
          produção.
        </p>
        <TestButtons />
      </section>

      <section aria-labelledby="list" className="flex flex-col gap-3">
        <h2 id="list" className="text-xl font-bold tracking-tight">
          Últimos 30 dias
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted text-sm">Nenhum erro registrado.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={`${row.fingerprint}-${row.day}`}
                className="border-rule bg-surface flex flex-col gap-1 rounded-sm border p-4 text-sm"
              >
                <p className="font-mono text-xs">
                  {KIND_LABEL[row.kind] ?? row.kind} · {row.route}
                </p>
                <p className="font-semibold break-words">{row.message}</p>
                <p className="text-muted">
                  {row.count === 1 ? "1 vez" : `${row.count} vezes`} em{" "}
                  {row.day} · primeira {inBrasilia(row.first_at)} · última{" "}
                  {inBrasilia(row.last_at)}
                  {row.alerted ? " · e-mail enviado" : ""}
                </p>
                <p className="text-faint font-mono text-xs">
                  {row.release === null
                    ? "sem release"
                    : `release ${row.release}`}
                  {row.digest === null ? "" : ` · código ${row.digest}`}
                </p>
                {row.stack !== null && (
                  <details>
                    <summary className="text-muted cursor-pointer">
                      Stack
                    </summary>
                    <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre">
                      {row.stack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
