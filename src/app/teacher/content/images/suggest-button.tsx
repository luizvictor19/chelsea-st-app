"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { suggestRepresentations } from "./actions";

/**
 * Asks the model to sort the whole lesson, decided words included. What comes
 * back is a suggestion on each word, never a decision, so this button changes
 * what the list proposes and never what it records.
 *
 * Re-running it is expected, not an accident: the suggestions on a decided
 * lesson are how a change to the prompt gets marked against answers that
 * already exist.
 */
export function SuggestButton({
  lessonContentId,
  words,
}: {
  readonly lessonContentId: string;
  readonly words: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    const result = await suggestRepresentations(lessonContentId);
    setBusy(false);
    if (result.ok) {
      setNote(
        result.rejected === 0
          ? `${result.suggested} sugeridas`
          : `${result.suggested} sugeridas, ${result.rejected} recusadas`,
      );
      router.refresh();
    } else {
      setNote(result.error);
    }
  }

  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy || words === 0}
        onClick={() => void run()}
        title={
          words === 0
            ? "Esta lição não tem palavras"
            : "Sugere de novo a lição inteira, inclusive as já decididas"
        }
        className="border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs font-semibold normal-case transition-colors disabled:opacity-40"
      >
        {busy ? "sugerindo" : "Sugerir a lição toda"}
      </button>
      {note !== null && (
        <span className="text-faint text-xs normal-case">{note}</span>
      )}
    </span>
  );
}
