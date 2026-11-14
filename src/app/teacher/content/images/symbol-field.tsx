"use client";

import { useState } from "react";

import { symbolTextOf } from "./symbol-text";

/**
 * The character a word decided symbol shows in place of a picture (0063,
 * #370), on the images panel.
 *
 * It saves when the field loses focus or on Enter, so an edit is never left
 * behind in silence by moving to another word; while it differs from what is
 * saved, the line under it says so. The parent keys it by the saved value,
 * so a save that comes back from the server opens it on the new one.
 *
 * The save keeps its own "salvando" and never takes the panel's busy state:
 * the click that blurs the field (a type, Aceitar sugestão) has to go
 * through as well, and with the panel busy it would be dropped without a
 * word.
 */
export function SymbolField({
  saved,
  onSave,
}: {
  readonly saved: string | null;
  readonly onSave: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(saved ?? "");
  const [saving, setSaving] = useState(false);
  const changed = symbolTextOf(draft) !== saved;

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    await onSave(draft);
    setSaving(false);
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
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder="5, 12th, +"
          className="border-rule bg-background w-40 rounded-sm border px-3 py-2 text-sm"
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
