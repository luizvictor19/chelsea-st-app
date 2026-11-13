/**
 * The BillingStore over the billing functions of 0049 and the credit
 * functions of 0050, called with the service role. Server only: the client
 * holds the key that passes every policy, and this file names no table, only
 * billing_* and credit_* functions.
 */

import { createClient } from "@supabase/supabase-js";

import { env, serviceRoleKey } from "../env.ts";
import type { Database } from "../supabase/types.ts";

import {
  StoreError,
  StoreRefusal,
  type BillingStore,
  type CreditDailyReport,
  type StoredSubscription,
} from "./store.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "billing/supabase-store.ts is server only and must not reach the browser",
  );
}

type Functions = Database["public"]["Functions"];
type Name = keyof Functions & (`billing_${string}` | `credit_${string}`);

/** The constraints the app turns into sentences; others stay errors. */
const NAMED = [
  "billing_customers_one_person_per_cpf",
  "billing_customers_one_cpf_per_person",
  "billing_one_trial_per_person",
  "billing_plan_active",
  "subscriptions_one_alive_per_person",
  "credits_not_negative",
  "credit_cost_known",
  "credit_debit_reference_used",
];

type Row = Database["public"]["Tables"]["subscriptions"]["Row"];

/** A subscriptions row, as the function or the person's own client read it. */
export function toStored(row: Row): StoredSubscription {
  return {
    id: row.id,
    personId: row.person_id,
    planId: row.plan_id,
    cycle: row.cycle as StoredSubscription["cycle"],
    billingType: row.billing_type as StoredSubscription["billingType"],
    valueCents: row.value_cents,
    withTrial: row.with_trial,
    firstDueOn: row.first_due_on,
    status: row.status as StoredSubscription["status"],
    asaasCheckoutId: row.asaas_checkout_id,
    asaasCustomerId: row.asaas_customer_id,
    asaasSubscriptionId: row.asaas_subscription_id,
    paidThrough: row.paid_through,
    cancelReason: row.cancel_reason,
  };
}

/** Also used by the routine to read a person's e-mail from auth. */
export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function createSupabaseBillingStore(
  client = createServiceClient(),
): BillingStore {
  async function call<N extends Name>(
    name: N,
    args: Record<string, unknown>,
  ): Promise<Functions[N]["Returns"]> {
    // The generated Args mark every parameter as required text, number or
    // boolean, also the ones the functions take as null (the generator
    // cannot read nullability of a parameter). The values are checked by the
    // functions themselves, so the record goes through as it is.
    const { data, error } = await client.rpc(name, args as never);
    if (error) {
      const named = NAMED.find(
        (constraint) =>
          error.message.includes(constraint) ||
          error.details?.includes(constraint),
      );
      if (named !== undefined) throw new StoreRefusal(named, error.message);
      throw new StoreError(
        error.code ?? "",
        `${name} failed: ${error.code} ${error.message}`,
      );
    }
    return data as Functions[N]["Returns"];
  }

  return {
    async customer(personId, cpfHmac) {
      return (await call("billing_customer", {
        p_person: personId,
        p_cpf_hmac: cpfHmac,
      })) as string | null;
    },

    async openSubscription(input) {
      return call("billing_open_subscription", {
        p_person: input.personId,
        p_plan: input.planId,
        p_cycle: input.cycle,
        p_billing_type: input.billingType,
        p_value_cents: input.valueCents,
        p_with_trial: input.withTrial,
        p_first_due_on: input.firstDueOn,
        p_checkout_id: input.checkoutId,
        p_customer_id: input.customerId,
        p_subscription_id: input.subscriptionId,
      });
    },

    async applySubscription(id, reading) {
      await call("billing_apply_subscription", {
        p_id: id,
        p_subscription_id: reading.subscriptionId,
        p_customer_id: reading.customerId,
        p_status: reading.status,
        p_paid_through: reading.paidThrough,
        p_past_due_since: reading.pastDueSince,
        p_cancel_reason: reading.cancelReason,
      });
    },

    async findSubscription({ subscriptionId = null, checkoutId = null }) {
      const rows = await call("billing_find_subscription", {
        p_subscription_id: subscriptionId,
        p_checkout_id: checkoutId,
      });
      return rows.length === 0 ? null : toStored(rows[0]);
    },

    async savePayment(input) {
      await call("billing_save_payment", {
        p_payment_id: input.paymentId,
        p_subscription: input.subscriptionId,
        p_kind: "cycle",
        p_value_cents: input.valueCents,
        p_asaas_status: input.asaasStatus,
        p_deleted: input.deleted,
        p_due_on: input.dueOn,
        p_paid_at: input.paidAt,
        p_refunded_cents: input.refundedCents,
        p_invoice_url: input.invoiceUrl,
      });
    },

    async recordEvent(id, type, payload) {
      return call("billing_record_event", {
        p_event_id: id,
        p_event_type: type,
        p_payload: payload,
      });
    },

    async finishEvent(id, error) {
      await call("billing_finish_event", { p_event_id: id, p_error: error });
    },

    async overduePayments() {
      const rows = await call("billing_overdue_payments", {});
      return rows.map((row) => ({
        paymentId: row.asaas_payment_id,
        subscriptionId: row.subscription_id,
        personId: row.person_id,
        billingType: row.billing_type as "card" | "pix",
        dueOn: row.due_on,
        invoiceUrl: row.invoice_url,
      }));
    },

    async takeOverdueStep(paymentId, day) {
      return call("billing_take_overdue_step", {
        p_payment_id: paymentId,
        p_day: day,
      });
    },

    async finishOverdueStep(paymentId, day, outcome, emailed) {
      await call("billing_finish_overdue_step", {
        p_payment_id: paymentId,
        p_day: day,
        p_outcome: outcome,
        p_emailed: emailed,
      });
    },

    async settleCredits(paymentId) {
      await call("credit_settle_payment", { p_payment_id: paymentId });
    },

    async creditDaily() {
      const data: unknown = await call("credit_daily", {});
      // One row of out parameters: PostgREST answers it as an object.
      const row = (Array.isArray(data) ? data[0] : data) as
        Partial<CreditDailyReport> | undefined;
      return {
        granted: row?.granted ?? 0,
        closed: row?.closed ?? 0,
      };
    },
  };
}
