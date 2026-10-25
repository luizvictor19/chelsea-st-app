"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { filterHref, type Selection } from "./filters";
import { sceneCreated, tell } from "./notice-texts";
import { createScene } from "./scene-actions";

/**
 * Nova cena (#64): a description, and nothing generated. The new scene opens
 * in the panel, where Gerar is its own button.
 *
 * A description already taken is not a second scene: the action answers with
 * the one that has it, and that one opens instead, with the reason in the
 * snackbar.
 */
export function NewScene({
  selection,
  term,
}: {
  readonly selection: Selection;
  readonly term: string;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    const text = description;
    let result: Awaited<ReturnType<typeof createScene>>;
    try {
      result = await createScene(text);
    } catch (cause) {
      // A call that never came back: nothing is known to have been written.
      console.error(cause);
      result = {
        ok: false,
        error: "A resposta não chegou. Recarregue a página.",
      };
    }
    setBusy(false);
    if (result.ok) {
      tell(sceneCreated(text.trim()));
      setDescription("");
      router.push(
        filterHref(selection, { kind: "scene", id: result.id }, term),
      );
      return;
    }
    tell({ kind: "error", text: result.error });
    if (result.cause !== undefined) console.error(result.cause);
    if (result.existingId !== undefined) {
      setDescription("");
      router.push(
        filterHref(selection, { kind: "scene", id: result.existingId }, term),
      );
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor="nova-cena" className="sr-only">
        Descrição da nova cena
      </label>
      <input
        id="nova-cena"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="nova cena, em inglês: a big box"
        className="border-rule bg-background min-w-0 flex-1 rounded-sm border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy || description.trim() === ""}
        className="border-rule hover:bg-surface rounded-sm border px-4 py-2 text-sm transition-colors disabled:opacity-50"
      >
        {busy ? "criando" : "Criar cena"}
      </button>
    </form>
  );
}
