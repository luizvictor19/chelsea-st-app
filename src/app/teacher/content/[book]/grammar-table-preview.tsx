"use client";

import { columnCount, parseGrammarTable } from "@/lib/extraction/grammar-table";

/**
 * The table as the student will see it on the shared screen.
 *
 * Shown beside the field because the convention is easier to learn from its
 * result than from a rule: a pipe in the wrong place is obvious here and
 * invisible in the text. Retyping 150 of these is the largest piece of manual
 * work in the whole product, and the only thing that keeps them consistent is
 * seeing them.
 */
export function GrammarTablePreview({ content }: { content: string }) {
  const sections = parseGrammarTable(content);

  if (sections.length === 0) {
    return (
      <p className="text-faint text-sm">
        A tabela aparece aqui como a aluna vai vê-la.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <div key={index} className="flex flex-col gap-1">
          {section.heading !== null && (
            <p className="font-semibold tracking-tight">{section.heading}</p>
          )}
          {section.rows.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {section.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-rule border-b">
                    {Array.from({ length: columnCount(section) }, (_, cell) => (
                      <td
                        key={cell}
                        className={
                          cell === 0
                            ? "text-muted py-1 pr-4 align-top font-mono text-xs"
                            : "py-1 pr-4 align-top"
                        }
                      >
                        {row[cell] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
