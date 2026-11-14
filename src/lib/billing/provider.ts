/**
 * The payment provider, behind an interface of our own (ADR 0006), the same
 * shape as the other providers and for the same reason: the app speaks of a
 * subscription, a charge and a checkout, and only asaas.ts knows how Asaas
 * spells them. fake.ts plays the provider in the tests.
 *
 * Money is in cents everywhere on this side. Dates are calendar days,
 * "YYYY-MM-DD", in São Paulo, which is how the provider counts them.
 */

export type Cycle = "monthly" | "annual";

/** A subscription as the provider holds it, read back after every event. */
export type ProviderSubscription = {
  readonly id: string;
  readonly customerId: string;
  /** The provider's own word: ACTIVE, INACTIVE or EXPIRED. */
  readonly status: string;
  readonly deleted: boolean;
  readonly nextDueOn: string;
  /** The hosted checkout that created it, when one did. */
  readonly checkoutId: string | null;
  readonly valueCents: number;
};

/**
 * One refund of a charge, as the provider holds it. The provider's status,
 * verbatim: PENDING, AWAITING_CRITICAL_ACTION_AUTHORIZATION,
 * AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION, CANCELLED or DONE. Only DONE is
 * money back (docs.asaas.com/docs/estornos, read on 14/11/2026).
 */
export type ProviderRefund = {
  readonly status: string;
  readonly valueCents: number;
};

/** A charge as the provider holds it. */
export type ProviderPayment = {
  readonly id: string;
  readonly subscriptionId: string | null;
  readonly customerId: string;
  /** PENDING, CONFIRMED, RECEIVED, OVERDUE, REFUNDED... verbatim. */
  readonly status: string;
  readonly deleted: boolean;
  readonly valueCents: number;
  readonly dueOn: string;
  /** The day it was paid, when it was. */
  readonly paidOn: string | null;
  readonly invoiceUrl: string | null;
  /** What was given back, counting only refunds the provider calls done. */
  readonly refundedCents: number;
  /** Every refund asked for it, done or not (#297). */
  readonly refunds: readonly ProviderRefund[];
  /** The saved card, when the charge was by card and tokenization is on. */
  readonly cardToken: string | null;
};

export type ProviderCustomer = {
  readonly id: string;
  readonly cpf: string | null;
  readonly name: string;
  readonly email: string | null;
};

export type PixCode = {
  /** The "copia e cola". */
  readonly payload: string;
  /** A PNG, base64, of the QR code. */
  readonly imageBase64: string;
};

export type Checkout = { readonly id: string; readonly url: string };

/** What the provider answered when it refused, in its own words. */
export class ProviderError extends Error {
  readonly status: number;
  readonly codes: readonly string[];
  constructor(message: string, status: number, codes: readonly string[]) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.codes = codes;
  }
}

export interface BillingProvider {
  createCustomer(input: {
    name: string;
    cpf: string;
    email: string;
    reference: string;
  }): Promise<{ id: string }>;

  getCustomer(id: string): Promise<ProviderCustomer>;

  /**
   * A Pix subscription, whose first charge falls on firstDueOn. The provider
   * makes that charge at once and the next ones ahead of their day.
   */
  createPixSubscription(input: {
    customerId: string;
    valueCents: number;
    cycle: Cycle;
    firstDueOn: string;
    description: string;
    reference: string;
  }): Promise<ProviderSubscription>;

  /**
   * A hosted checkout for a card subscription (Q1): the card is typed on the
   * provider's page, never here. The provider makes the subscription when the
   * person finishes, with its first charge on firstDueOn.
   */
  createCardCheckout(input: {
    itemName: string;
    valueCents: number;
    cycle: Cycle;
    firstDueOn: string;
    reference: string;
    returnUrl: string;
    minutesToExpire: number;
  }): Promise<Checkout>;

  getSubscription(id: string): Promise<ProviderSubscription>;
  listSubscriptionPayments(subscriptionId: string): Promise<ProviderPayment[]>;
  getPayment(id: string): Promise<ProviderPayment>;
  getPixCode(paymentId: string): Promise<PixCode>;

  /** Ends it; the provider deletes the charges not yet paid with it. */
  deleteSubscription(id: string): Promise<void>;

  /** Charges an existing charge again with the card saved for it. */
  payWithCardToken(
    paymentId: string,
    cardToken: string,
  ): Promise<ProviderPayment>;

  /**
   * Gives back part of a paid charge, or all of it when no value is given.
   * Answers the charge as the provider holds it after, its refunds included:
   * a refund taken is not one done until its status is DONE.
   */
  refund(
    paymentId: string,
    valueCents?: number,
    description?: string,
  ): Promise<ProviderPayment>;

  /** The value of the next charges; the ones already made keep theirs. */
  updateSubscriptionValue(id: string, valueCents: number): Promise<void>;
}

/** Statuses the app reads a charge as paid by. A refund is not one. */
export const PAID_STATUSES: ReadonlySet<string> = new Set([
  "CONFIRMED",
  "RECEIVED",
  "RECEIVED_IN_CASH",
]);
