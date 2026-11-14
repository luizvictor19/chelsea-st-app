"use client";

import { useEffect } from "react";

import { digestOf, reportBoundaryError } from "@/lib/monitoring/client";

/**
 * When the root layout itself fails (#69): it replaces the whole document,
 * without globals.css, so the few styles it needs are here and follow the
 * system's light or dark. No brand name: the Host is not read here. Reported
 * as error.tsx is, only without a digest.
 */
export default function GlobalError({
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
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <title>Algo deu errado</title>
        <main
          style={{
            maxWidth: "28rem",
            margin: "0 auto",
            padding: "3rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Algo deu errado</h1>
          <p style={{ margin: 0 }}>
            A página não carregou. Tente de novo; se continuar, avise a gente
            {digest === null ? "." : " com o código abaixo."}
          </p>
          {digest !== null && (
            <p style={{ margin: 0, fontFamily: "monospace" }}>
              Código: {digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              alignSelf: "flex-start",
              padding: "0.5rem 1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
