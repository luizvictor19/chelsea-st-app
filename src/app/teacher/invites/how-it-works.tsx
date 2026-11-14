import { INVITE_KINDS, type InviteKind } from "./invite-kinds";

/**
 * "Como funciona" of one kind of invite (#366): its line and its steps, from
 * the invite to where the person ends up. Shown where each invite now lives:
 * Organizações, Fundadores, and Convites for the admin of a school.
 */
export function HowItWorks({ kind }: { readonly kind: InviteKind }) {
  const { line, steps, note } = INVITE_KINDS[kind];
  return (
    <div className="border-rule flex flex-col gap-2 rounded-sm border p-4 text-sm">
      <p className="font-semibold">Como funciona</p>
      <p className="text-muted">{line}</p>
      <ol className="text-muted flex list-decimal flex-col gap-1 pl-5">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {note !== undefined && <p className="text-muted">{note}</p>}
    </div>
  );
}
