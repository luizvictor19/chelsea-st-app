/**
 * The constraints the real store (supabase-store.ts) turns into a
 * StoreRefusal, so the screen can say them; any other error stays an error.
 * A plain module so a test reads the list without the server-only store.
 */
export const STORE_REFUSALS: readonly string[] = [
  "billing_customers_one_person_per_cpf",
  "billing_customers_one_cpf_per_person",
  "billing_one_trial_per_person",
  "billing_plan_active",
  "billing_plan_audience",
  "billing_value_matches",
  "billing_cycle_offered",
  "subscriptions_one_alive_per_person",
  "credits_not_negative",
  "credit_cost_known",
  "credit_debit_reference_used",
];
