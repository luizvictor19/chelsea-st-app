"use client";

import { useState } from "react";

/**
 * Copies a text to the clipboard and says so. When the browser refuses (no
 * permission, a page not served over https), it says that too, and the text
 * stays on the screen to copy by hand.
 */
export function CopyButton({
  text,
  label = "Copiar",
  className = "border-rule hover:border-foreground rounded-sm border px-3 py-1",
}: {
  readonly text: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [said, setSaid] = useState<"idle" | "copied" | "refused">("idle");
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setSaid("copied"),
          () => setSaid("refused"),
        );
      }}
      className={className}
    >
      {said === "copied"
        ? "Copiado"
        : said === "refused"
          ? "Não copiou: selecione e copie"
          : label}
    </button>
  );
}

/** The text in a box, beside its button. */
export function CopyLine({ text }: { readonly text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="bg-background min-w-0 rounded-sm px-2 py-1 font-mono break-all select-all">
        {text}
      </span>
      <CopyButton text={text} />
    </div>
  );
}
