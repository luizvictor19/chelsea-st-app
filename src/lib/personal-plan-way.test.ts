import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pendingPersonalPlan } from "./personal-plan-way.ts";

const PLAN = { id: "plan-1", isActive: true };

describe("pendingPersonalPlan", () => {
  test("a student with her personal plan and no subscription alive goes to its checkout", () => {
    assert.equal(
      pendingPersonalPlan({
        destination: "/dashboard",
        plans: [PLAN],
        subscriptionStatuses: [],
      }),
      "/dashboard/plano?plano=plan-1",
    );
    // A checkout left open, or one that ended, does not hold the door.
    assert.equal(
      pendingPersonalPlan({
        destination: "/dashboard",
        plans: [{ id: "off", isActive: false }, PLAN],
        subscriptionStatuses: ["pending", "canceled"],
      }),
      "/dashboard/plano?plano=plan-1",
    );
  });

  test("with a subscription alive she goes where she always goes", () => {
    for (const status of ["trialing", "awaiting", "active", "past_due"]) {
      assert.equal(
        pendingPersonalPlan({
          destination: "/dashboard",
          plans: [PLAN],
          subscriptionStatuses: [status],
        }),
        null,
        status,
      );
    }
  });

  test("a plan off sale, no plan, or someone who is not going to /dashboard: nothing", () => {
    assert.equal(
      pendingPersonalPlan({
        destination: "/dashboard",
        plans: [{ id: "off", isActive: false }],
        subscriptionStatuses: [],
      }),
      null,
    );
    assert.equal(
      pendingPersonalPlan({
        destination: "/dashboard",
        plans: [],
        subscriptionStatuses: [],
      }),
      null,
    );
    assert.equal(
      pendingPersonalPlan({
        destination: "/teacher",
        plans: [PLAN],
        subscriptionStatuses: [],
      }),
      null,
    );
  });
});
