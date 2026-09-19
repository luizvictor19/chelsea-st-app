"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { suggestRepresentations } from "./actions";

/**
 * Asks the model to sort one lesson's undecided words. What comes back is a
 * suggestion on each word, never a decision, so this button changes what the
 * list proposes and never what it records.
 */
export function SuggestButton({
  lessonContentId,
  undecided,
}: {
  readonly lessonContentId: string;
  readonly undecided: number;
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
        disabled={busy || undecided === 0}
        onClick={() => void run()}
        title={
          undecided === 0
            ? "Todas as palavras desta lição já têm decisão"
            : undefined
        }
        className="border-rule hover:bg-surface rounded-sm border px-2.5 py-1 text-xs font-semibold normal-case transition-colors disabled:opacity-40"
      >
        {busy ? "sugerindo" : "Sugerir tipos"}
      </button>
      {note !== null && (
        <span className="text-faint text-xs normal-case">{note}</span>
      )}
    </span>
  );
}
