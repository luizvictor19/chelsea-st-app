/**
 * What credits pay for (#273, ADR 0006): one unit of each action has a cost
 * per brand, written by the platform admin in credit_costs and read through
 * credit_cost. The list is the database's credit_costs_action_known (0050),
 * held equal by actions.test.ts: a new action is a migration and a code
 * change together, like a brand.
 */

export const CREDIT_ACTIONS = [
  "voice_minute",
  "video_minute",
  "teacher_lesson",
] as const;

export type CreditAction = (typeof CREDIT_ACTIONS)[number];

/** How the screen names one unit of each action. */
export const CREDIT_ACTION_LABEL: Readonly<Record<CreditAction, string>> = {
  voice_minute: "Minuto de voz",
  video_minute: "Minuto de vídeo",
  teacher_lesson: "Aula com professor",
};

export function isCreditAction(value: unknown): value is CreditAction {
  return (CREDIT_ACTIONS as readonly unknown[]).includes(value);
}
