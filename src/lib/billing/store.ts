/**
 * What the billing writes and reads with no person signed in: the webhook
 * and the daily routine. Every call is one of the billing functions of 0049
 * or the credit functions of 0050 that only service_role executes; this
 * module never names a table (Q2 of the #72 plan, docs/context.md). A person
 * reads her own billing rows with her own client, through row level
 * security, elsewhere.
 *
 * An interface, so the webhook and the routine are tested against a store in
 * memory (fake-store.ts) with the same contract.
 */

import type { Cycle } from "./provider.ts";
import type { SubscriptionStatus } from "./state.ts";

export type StoredSubscription = {
  readonly id: string;
  readonly personId: string;
  readonly planId: string;
  readonly cycle: Cycle;
  readonly billingType: "card" | "pix";
  readonly valueCents: number;
  readonly withTrial: boolean;
  readonly firstDueOn: string;
  readonly status: SubscriptionStatus;
  readonly asaasCheckoutId: string | null;
  readonly asaasCustomerId: string | null;
  readonly asaasSubscriptionId: string | null;
  readonly paidThrough: string | null;
  readonly cancelReason: string | null;
};

export type CancelReason =
  | "person"
  | "overdue"
  | "replaced"
  | "checkout_expired"
  | "trial_used"
  | "provider";

export type OverduePayment = {
  readonly paymentId: string;
  readonly subscriptionId: string;
  readonly personId: string;
  readonly billingType: "card" | "pix";
  readonly dueOn: string;
  readonly invoiceUrl: string | null;
};

export type OverdueOutcome =
  "paid" | "refused" | "pix_reminder" | "canceled" | "already_paid" | "error";

/** The days of Q5 (Luiz, 12/11/2026): a new charge and an email on each. */
export const OVERDUE_DAYS = [1, 3, 5, 7] as const;
export type OverdueDay = (typeof OVERDUE_DAYS)[number];

/** What the daily step of the credits did (credit_daily, 0050), in lots. */
export type CreditDailyReport = {
  /** Months granted: an annual charge's next month, or a grant missed. */
  readonly granted: number;
  /** Lots past their day closed. */
  readonly closed: number;
  /** Carryovers opened from the months closed. */
  readonly carried: number;
};

/** A refusal of the database the app turns into a sentence, by its name. */
export class StoreRefusal extends Error {
  readonly constraint: string;
  constructor(constraint: string, message: string) {
    super(message);
    this.name = "StoreRefusal";
    this.constraint = constraint;
  }
}

/**
 * Any other failure of a billing function, with the SQLSTATE the database
 * gave. `passing` tells a failure the next try may not meet (no SQLSTATE: the
 * connection; a cancel, a lock, a lack of resources) from one it will meet
 * again (a check, a unique key, a raise, a type or a privilege refused).
 */
export class StoreError extends Error {
  readonly code: string;
  readonly passing: boolean;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    // 22 data, 23 integrity, 42 syntax and privilege, P0 a raise.
    this.passing = !/^(22|23|42|P0)/.test(code);
  }
}

export interface BillingStore {
  /** Makes or finds her billing row; when her trial started, or null. */
  customer(personId: string, cpfHmac: string): Promise<string | null>;
  openSubscription(input: {
    personId: string;
    planId: string;
    cycle: Cycle;
    billingType: "card" | "pix";
    valueCents: number;
    withTrial: boolean;
    firstDueOn: string;
    checkoutId: string | null;
    customerId: string | null;
    subscriptionId: string | null;
  }): Promise<string>;
  applySubscription(
    id: string,
    reading: {
      subscriptionId: string | null;
      customerId: string | null;
      status: Exclude<SubscriptionStatus, "pending">;
      paidThrough: string | null;
      pastDueSince: string | null;
      cancelReason: CancelReason | null;
    },
  ): Promise<void>;
  findSubscription(by: {
    subscriptionId?: string | null;
    checkoutId?: string | null;
  }): Promise<StoredSubscription | null>;
  savePayment(input: {
    paymentId: string;
    subscriptionId: string;
    valueCents: number;
    asaasStatus: string;
    deleted: boolean;
    dueOn: string;
    paidAt: string | null;
    refundedCents: number;
    invoiceUrl: string | null;
  }): Promise<void>;
  recordEvent(id: string, type: string, payload: unknown): Promise<boolean>;
  finishEvent(id: string, error: string | null): Promise<void>;
  overduePayments(): Promise<OverduePayment[]>;
  takeOverdueStep(paymentId: string, day: OverdueDay): Promise<boolean>;
  finishOverdueStep(
    paymentId: string,
    day: OverdueDay,
    outcome: OverdueOutcome,
    emailed: boolean,
  ): Promise<void>;
  /**
   * What a charge, as last written, means for the credits (0050): the
   * database grants the month a paid one is in, once, voids what is left of a
   * refunded or deleted one, and does nothing for the rest.
   */
  settleCredits(paymentId: string): Promise<void>;
  /** The daily step of the credits: grant, void, close and carry over. */
  creditDaily(): Promise<CreditDailyReport>;
}
