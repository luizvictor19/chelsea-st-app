import { PlanForm, type PlanFields } from "./plan-form";
import { planSummary } from "./summary";

/**
 * A saved plan as a card (#360): its summary, and "Editar" opens its form
 * right there. A native <details>: it opens and closes without JavaScript,
 * by the keyboard too, and closing only hides the form, so what was typed
 * and not saved is still there when it opens again.
 */
export function PlanCard({ plan }: { readonly plan: PlanFields }) {
  const { title, parts } = planSummary(plan);
  return (
    <details className="group border-rule bg-surface rounded-sm border">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">{title}</span>
          <span className="text-muted text-sm">{parts.join(" · ")}</span>
        </span>
        <span className="text-accent shrink-0 text-sm font-semibold underline">
          <span className="group-open:hidden">Editar</span>
          <span className="hidden group-open:inline">Fechar</span>
        </span>
      </summary>
      <div className="px-3 pb-3">
        <PlanForm plan={plan} />
      </div>
    </details>
  );
}
