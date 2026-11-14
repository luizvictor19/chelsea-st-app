"use client";

import { useEffect } from "react";

import { digestOf, reportBoundaryError } from "@/lib/monitoring/client";

/**
 * What a screen shows when it fails (#69), under the root layout, so with
 * the brand's colours and no brand name. An error with a digest came from the
 * server, which recorded it already; one without was the tab's, and goes to
 * the error log from here.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest = digestOf(error);
  useEffect(() => {
    reportBoundaryError(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight">
        Algo deu errado
      </h1>
      <p className="text-muted">
        A página não carregou. Tente de novo; se continuar, avise a gente
        {digest === null ? "." : " com o código abaixo."}
      </p>
      {digest !== null && (
        <p className="text-faint font-mono text-sm">Código: {digest}</p>
      )}
      <button
        type="button"
        onClick={() => retry()}
        className="bg-accent text-on-accent self-start rounded-sm px-4 py-2 font-semibold"
      >
        Tentar de novo
      </button>
    </main>
  );
}
