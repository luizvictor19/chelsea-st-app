import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { cpfHmac } from "./cpf.ts";
import {
  createFakeProvider,
  createFakeStore,
  type FakeProvider,
  type FakeStore,
} from "./fake.ts";
import { SUBSCRIBE_REFUSALS } from "./messages.ts";
import { StoreRefusal } from "./store.ts";
import {
  cancelSubscription,
  pixToPay,
  priceOf,
  startSubscription,
  type PlanForSale,
} from "./subscribe.ts";
import type { SyncDeps } from "./sync.ts";

const KEY = "k".repeat(64);
const CPF = "529.982.247-25";
const PLAN: PlanForSale = {
  id: "plan-1",
  name: "Plano",
  monthlyPriceCents: 1000,
  annualPriceCents: 10000,
  trialDays: 14,
};

let provider: FakeProvider;
let store: FakeStore;

function deps(): SyncDeps {
  return { provider, store, cpfKey: KEY };
}

function start(over: Partial<Parameters<typeof startSubscription>[1]> = {}) {
  return startSubscription(deps(), {
    personId: "person-1",
    name: "Ana Souza",
    email: "ana@example.com",
    cpf: CPF,
    plan: PLAN,
    cycle: "monthly",
    billingType: "pix",
    today: "2026-11-12",
    returnUrl: "https://app.example/dashboard/plano",
    ...over,
  });
}

beforeEach(() => {
  provider = createFakeProvider();
  store = createFakeStore();
});

describe("startSubscription", () => {
  test("Pix with a trial: first charge on day 15, the row trialing, the trial used", async () => {
    const result = await start();
    assert.equal(result.kind, "pix");
    const row = [...store.rows.values()][0];
    assert.equal(row.status, "trialing");
    assert.equal(row.firstDueOn, "2026-11-26");
    assert.equal(row.withTrial, true);
    const charge = [...provider.payments.values()][0];
    assert.equal(charge.dueOn, "2026-11-26");
    assert.equal(store.payments.size, 1);
    assert.notEqual(store.customers.get("person-1")!.trialUsedAt, null);
    // The CPF goes to the provider as digits, and only as an HMAC here.
    assert.equal([...provider.customers.values()][0].cpf, "52998224725");
    assert.equal(store.customers.get("person-1")!.cpfHmac, cpfHmac(CPF, KEY));
  });

  test("card: the checkout, a pending row, the trial not used yet", async () => {
    const result = await start({ billingType: "card", cycle: "annual" });
    assert.equal(result.kind, "checkout");
    assert.match(
      (result as { url: string }).url,
      /^https:\/\/checkout\.example\//,
    );
    const row = [...store.rows.values()][0];
    assert.equal(row.status, "pending");
    assert.equal(row.valueCents, 10000);
    assert.equal(store.customers.get("person-1")!.trialUsedAt, null);
    assert.equal(provider.calls.includes("createCustomer"), false);
  });

  test("a second subscription has no trial: the first charge today", async () => {
    await start();
    const [row] = store.rows.values();
    await cancelSubscription({ provider, store }, row);
    await start();
    const second = [...store.rows.values()][1];
    assert.equal(second.withTrial, false);
    assert.equal(second.firstDueOn, "2026-11-12");
    assert.equal(second.status, "awaiting");
  });

  test("a plan with no trial days charges today", async () => {
    await start({ plan: { ...PLAN, trialDays: 0 } });
    assert.equal([...store.rows.values()][0].firstDueOn, "2026-11-12");
  });

  test("an invalid CPF or name is refused before anything is made", async () => {
    assert.deepEqual(await start({ cpf: "529.982.247-24" }), {
      kind: "refused",
      message: SUBSCRIBE_REFUSALS.invalid_cpf,
    });
    assert.deepEqual(await start({ name: " a " }), {
      kind: "refused",
      message: SUBSCRIBE_REFUSALS.invalid_name,
    });
    assert.equal(provider.calls.length, 0);
    assert.equal(store.customers.size, 0);
  });

  test("a CPF of another account is refused with its sentence", async () => {
    await start();
    const result = await start({ personId: "person-2" });
    assert.deepEqual(result, {
      kind: "refused",
      message: SUBSCRIBE_REFUSALS.billing_customers_one_person_per_cpf,
    });
  });

  test("a second subscription alive is refused, and the provider's is undone", async () => {
    await start();
    const before = provider.subscriptions.size;
    const result = await start();
    assert.deepEqual(result, {
      kind: "refused",
      message: SUBSCRIBE_REFUSALS.subscriptions_one_alive_per_person,
    });
    const made = [...provider.subscriptions.values()][before];
    assert.equal(made.deleted, true);
  });

  test("a refusal the screen does not name is thrown", async () => {
    store.failWith = new StoreRefusal("something_else", "x");
    await assert.rejects(start(), /x/);
  });

  test("the price follows the cycle", () => {
    assert.equal(priceOf(PLAN, "monthly"), 1000);
    assert.equal(priceOf(PLAN, "annual"), 10000);
  });
});

describe("cancelSubscription", () => {
  test("in the trial: deleted at the provider, its charge with it, canceled by her", async () => {
    await start();
    const [row] = store.rows.values();
    await cancelSubscription({ provider, store }, row);
    assert.equal(store.rows.get(row.id)!.status, "canceled");
    assert.equal(store.rows.get(row.id)!.cancelReason, "person");
    assert.ok(
      [...provider.payments.values()].every((payment) => payment.deleted),
    );
  });

  test("a pending checkout is canceled here only, and twice is once", async () => {
    await start({ billingType: "card" });
    const [row] = store.rows.values();
    await cancelSubscription({ provider, store }, row);
    await cancelSubscription({ provider, store }, store.rows.get(row.id)!);
    assert.equal(provider.calls.includes("deleteSubscription"), false);
    assert.equal(store.rows.get(row.id)!.status, "canceled");
  });
});

describe("pixToPay", () => {
  test("the open charge's Pix, and none for a card", async () => {
    await start();
    const [row] = store.rows.values();
    const pix = await pixToPay(provider, store.rows.get(row.id)!);
    assert.equal(pix?.dueOn, "2026-11-26");
    assert.match(pix?.payload ?? "", /^pix-/);
    await start({
      personId: "person-3",
      cpf: "111.444.777-35",
      billingType: "card",
    });
    const card = [...store.rows.values()].find(
      (r) => r.personId === "person-3",
    )!;
    assert.equal(await pixToPay(provider, card), null);
  });
});
