"use client";

import { useState } from "react";

import { symbolTextOf } from "./symbol-text";

/**
 * The character a word decided symbol shows in place of a picture (0064,
 * #370), on the images panel.
 *
 * It saves when the field loses focus or on Enter, so an edit is never left
 * behind in silence by moving to another word; while it differs from what is
 * saved, the line under it says so. The parent keys it by the saved value,
 * so a save that comes back from the server opens it on the new one.
 */
export function SymbolField({
  saved,
  disabled,
  saving,
  onSave,
}: {
  readonly saved: string | null;
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(saved ?? "");
  const changed = symbolTextOf(draft) !== saved;

  function save() {
    if (changed && !disabled) onSave(draft);
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="caractere"
        className="text-faint font-mono text-xs tracking-[0.16em] uppercase"
      >
        Caractere
      </label>
      <div className="flex items-center gap-4">
        <input
          id="caractere"
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          placeholder="5, 12th, +"
          className="border-rule bg-background w-40 rounded-sm border px-3 py-2 text-sm disabled:opacity-50"
        />
        {saved !== null && (
          <span className="text-4xl leading-none font-extrabold tracking-tight">
            {saved}
          </span>
        )}
      </div>
      <p className="text-faint text-xs">
        {saving
          ? "salvando"
          : changed
            ? "Não salvo: sai do campo ou aperta Enter para salvar."
            : saved === null
              ? "Sem caractere: a aula mostra só a palavra."
              : "A aula mostra este caractere no lugar da imagem."}
      </p>
    </div>
  );
}
