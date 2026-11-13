import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pendingPersonalPlan,
  type HerSubscription,
} from "./personal-plan-way.ts";

const PLAN = { id: "plan-1", isActive: true };

function way(
  over: Partial<Parameters<typeof pendingPersonalPlan>[0]> = {},
): string | null {
  return pendingPersonalPlan({
    destination: "/dashboard",
    billingOpen: true,
    plans: [PLAN],
    subscriptions: [],
    ...over,
  });
}

const sub = (
  status: string,
  cancelReason: string | null = null,
  planId = "plan-1",
): HerSubscription => ({ planId, status, cancelReason });

describe("pendingPersonalPlan", () => {
  test("a student with her personal plan waiting goes to its checkout", () => {
    assert.equal(way(), "/dashboard/plano?plano=plan-1");
    // A checkout left open or one that never ran does not hold the door, nor
    // a plan of before that she cancelled.
    assert.equal(
      way({
        plans: [{ id: "off", isActive: false }, PLAN],
        subscriptions: [
          sub("pending"),
          sub("canceled", "checkout_expired"),
          sub("canceled", "replaced"),
          sub("canceled", "trial_used"),
          sub("canceled", "person", "an-older-plan"),
        ],
      }),
      "/dashboard/plano?plano=plan-1",
    );
  });

  test("with a subscription alive she goes where she always goes", () => {
    for (const status of ["trialing", "awaiting", "active", "past_due"]) {
      assert.equal(way({ subscriptions: [sub(status)] }), null, status);
    }
  });

  test("once that plan ran, cancelling it does not send her back to it", () => {
    for (const reason of ["person", "overdue", "provider", null]) {
      assert.equal(
        way({ subscriptions: [sub("canceled", reason)] }),
        null,
        String(reason),
      );
    }
  });

  test("billing closed, a plan off sale, no plan, or someone not going to /dashboard: nothing", () => {
    assert.equal(way({ billingOpen: false }), null);
    assert.equal(way({ plans: [{ id: "off", isActive: false }] }), null);
    assert.equal(way({ plans: [] }), null);
    assert.equal(way({ destination: "/teacher" }), null);
  });
});
