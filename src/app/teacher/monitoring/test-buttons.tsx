"use client";

import { throwServerTestError } from "./actions";
import { TEST_MESSAGE } from "./test-message";

/**
 * The two test errors (#69). The server one is an action that throws: the
 * page gives way to "Algo deu errado", with the code, as any failure would.
 * The browser one throws in the click handler, which no boundary catches:
 * it reaches the window, and from there /api/errors.
 */
export function TestButtons() {
  return (
    <div className="flex flex-wrap gap-3">
      <form action={throwServerTestError}>
        <button
          type="submit"
          className="border-rule bg-surface rounded-sm border px-4 py-2 text-sm font-semibold"
        >
          Erro de teste no servidor
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          throw new Error(TEST_MESSAGE);
        }}
        className="border-rule bg-surface rounded-sm border px-4 py-2 text-sm font-semibold"
      >
        Erro de teste no navegador
      </button>
    </div>
  );
}
