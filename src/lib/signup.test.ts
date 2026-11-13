import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { resolveSite, sitesFromEnv, type Site } from "./brand.ts";
import type { LinkLog, LinkTask, SendOutcome } from "./link-request.ts";
import {
  MAX_NAME_LENGTH,
  requestSignup,
  signupDoor,
  signupName,
  SIGNUP_ORIGINS,
  signupFounderView,
  signupOptions,
  signupOrigin,
  signupSend,
  type SignupCalls,
} from "./signup.ts";

const PRODUCTION = sitesFromEnv({
  GRIFOAI_HOST: "app.grifo.example",
  VERCEL: "1",
});
const LOCAL = sitesFromEnv({});

const CHELSEA = resolveSite("app.chelsea-st.com", PRODUCTION) as Site;
const GRIFOAI = resolveSite("app.grifo.example", PRODUCTION) as Site;
const DEV = resolveSite("127.0.0.1:3100", LOCAL) as Site;
const PREVIEW = resolveSite("chelsea-st-git-x-acct.vercel.app", PRODUCTION);

const EMAIL = "aluna@exemplo.com";

describe("signupName", () => {
  test("trimmed, spaces made one", () => {
    assert.equal(signupName("  Ana   Maria \n Souza  "), "Ana Maria Souza");
  });

  test("nothing, or only spaces, is empty", () => {
    for (const raw of [null, undefined, "", "   \t "]) {
      assert.equal(signupName(raw), "");
    }
  });

  test("cut to the maximum, with no space left at the end", () => {
    const long = `${"a".repeat(MAX_NAME_LENGTH - 1)} bcd`;
    const name = signupName(long);
    assert.equal(name, "a".repeat(MAX_NAME_LENGTH - 1));
    assert.ok(name.length <= MAX_NAME_LENGTH);
  });
});

describe("signupDoor: only Chelsea St has /cadastro", () => {
  const ALL = { billing: true, siteKey: "site", secretKey: "secret" };

  test("Chelsea St, in production and on a dev server, is open with everything set", () => {
    assert.equal(signupDoor(CHELSEA, ALL), "open");
    assert.equal(signupDoor(DEV, ALL), "open");
  });

  test("GrifoAI and a host outside the list have no page", () => {
    assert.equal(signupDoor(GRIFOAI, ALL), "absent");
    assert.equal(signupDoor(PREVIEW, ALL), "absent");
    assert.equal(signupDoor(null, ALL), "absent");
  });

  test("closed while billing is not open or a Turnstile key is missing", () => {
    assert.equal(signupDoor(CHELSEA, { ...ALL, billing: false }), "closed");
    assert.equal(signupDoor(CHELSEA, { ...ALL, siteKey: "" }), "closed");
    assert.equal(
      signupDoor(CHELSEA, { ...ALL, secretKey: undefined }),
      "closed",
    );
  });
});

describe("signupOptions", () => {
  test("the metadata says signup and carries the name", () => {
    assert.deepEqual(signupOptions(CHELSEA, "Ana").data, {
      signup: true,
      full_name: "Ana",
    });
  });

  test("Chelsea St in production leads back to its https origin", () => {
    assert.equal(
      signupOptions(CHELSEA, "Ana").redirectTo,
      "https://app.chelsea-st.com",
    );
  });

  test("a dev server leads back to itself: she opens the email there", () => {
    assert.equal(signupOptions(DEV, "Ana").redirectTo, "http://127.0.0.1:3100");
  });

  test("any other site sends no redirect, so the Site URL", () => {
    for (const site of [GRIFOAI, PREVIEW, null]) {
      const options = signupOptions(site, "Ana");
      assert.equal("redirectTo" in options, false);
      assert.equal(options.data.signup, true);
    }
  });
});

type Recorded = { invite: unknown[][]; magicLink: unknown[][] };

function calls(
  invite: SignupCalls["invite"],
  magicLink: SignupCalls["magicLink"] = async () => ({ error: null }),
): { calls: SignupCalls; recorded: Recorded } {
  const recorded: Recorded = { invite: [], magicLink: [] };
  return {
    recorded,
    calls: {
      invite: async (...args) => {
        recorded.invite.push(args);
        return invite(...args);
      },
      magicLink: async (...args) => {
        recorded.magicLink.push(args);
        return magicLink(...args);
      },
    },
  };
}

describe("signupSend: what each kind of address gets", () => {
  test("a new address: the invite with the metadata, nothing more", async () => {
    const c = calls(async () => ({ error: null }));
    assert.equal(await signupSend(EMAIL, "Ana", CHELSEA, c.calls), null);
    assert.deepEqual(c.recorded.invite, [
      [
        EMAIL,
        {
          data: { signup: true, full_name: "Ana" },
          redirectTo: "https://app.chelsea-st.com",
        },
      ],
    ]);
    assert.equal(c.recorded.magicLink.length, 0);
  });

  test("a confirmed account (email_exists): the link to sign in instead", async () => {
    const c = calls(async () => ({
      error: { code: "email_exists", status: 422, message: "registered" },
    }));
    assert.equal(await signupSend(EMAIL, "Ana", CHELSEA, c.calls), null);
    assert.deepEqual(c.recorded.magicLink, [
      [
        EMAIL,
        {
          shouldCreateUser: false,
          emailRedirectTo: "https://app.chelsea-st.com",
        },
      ],
    ]);
  });

  test("the link to sign in failing is returned for the log", async () => {
    const failure = { code: "unexpected_failure", status: 500 };
    const c = calls(
      async () => ({ error: { code: "email_exists" } }),
      async () => ({ error: failure }),
    );
    assert.deepEqual(await signupSend(EMAIL, "Ana", CHELSEA, c.calls), failure);
  });

  test("any other failure of the invite is returned for the log, and no link goes", async () => {
    const failure = {
      code: "over_email_send_rate_limit",
      status: 429,
      message: "email rate limit exceeded",
    };
    const c = calls(async () => ({ error: failure }));
    assert.deepEqual(await signupSend(EMAIL, "Ana", CHELSEA, c.calls), failure);
    assert.equal(c.recorded.magicLink.length, 0);
  });
});

function harness() {
  const tasks: LinkTask[] = [];
  const warned: unknown[][] = [];
  const log: LinkLog = {
    error: () => {},
    warn: (...args) => warned.push(args),
  };
  return {
    tasks,
    warned,
    log,
    schedule: (task: LinkTask) => {
      tasks.push(task);
    },
  };
}

const PASSED = async () => ({ passed: true }) as const;

describe("requestSignup: the answer of /cadastro", () => {
  test("a refused challenge is said, and nothing is scheduled", async () => {
    const h = harness();
    let sent = false;
    const state = await requestSignup({
      name: "Ana",
      email: EMAIL,
      challenge: async () => ({
        passed: false,
        reason: "invalid-input-response",
      }),
      send: async () => {
        sent = true;
        return null;
      },
      schedule: h.schedule,
      log: h.log,
    });
    assert.equal(state.status, "error");
    assert.equal(h.tasks.length, 0);
    assert.equal(sent, false);
    assert.equal(h.warned.length, 1);
    assert.equal(JSON.stringify(h.warned).includes(EMAIL), false);
  });

  test("an empty name or a bad address is said before the challenge is spent", async () => {
    for (const [name, email, message] of [
      ["", EMAIL, "Digite o seu nome."],
      ["Ana", "aluna@exemplo", "Digite um e-mail válido."],
    ] as const) {
      const h = harness();
      let challenged = false;
      const state = await requestSignup({
        name,
        email,
        challenge: async () => {
          challenged = true;
          return { passed: true };
        },
        send: async () => null,
        schedule: h.schedule,
        log: h.log,
      });
      assert.deepEqual(state, { status: "error", message });
      assert.equal(challenged, false);
      assert.equal(h.tasks.length, 0);
    }
  });

  test("the same answer, before the send, for a new, a confirmed and an unconfirmed address", async () => {
    // What step 0 measured GoTrue answering for each of the three.
    const outcomes: ReadonlyArray<[string, () => Promise<SendOutcome>]> = [
      ["new", async () => null],
      ["confirmed", async () => ({ code: "email_exists", status: 422 })],
      ["unconfirmed", async () => null],
    ];
    for (const [kind, send] of outcomes) {
      const h = harness();
      let started = false;
      const state = await requestSignup({
        name: "Ana",
        email: EMAIL,
        challenge: PASSED,
        send: () => {
          started = true;
          return send();
        },
        schedule: h.schedule,
        log: h.log,
      });
      assert.deepEqual(state, { status: "sent", email: EMAIL }, kind);
      assert.equal(started, false, kind);
      assert.equal(h.tasks.length, 1, kind);
      await h.tasks[0]();
    }
  });
});

describe("the founder coupon and the origin of a signup (#296)", () => {
  test("ride in the metadata only when there is one", () => {
    assert.deepEqual(
      signupOptions(CHELSEA, "Ana", { coupon: "abcd-efgh", origin: "grifoai" })
        .data,
      {
        signup: true,
        full_name: "Ana",
        founder_coupon: "abcd-efgh",
        origin: "grifoai",
      },
    );
    for (const extras of [{}, { coupon: "", origin: null }]) {
      assert.deepEqual(signupOptions(CHELSEA, "Ana", extras).data, {
        signup: true,
        full_name: "Ana",
      });
    }
  });

  test("the origin is only grifoai", () => {
    assert.equal(signupOrigin("grifoai"), "grifoai");
    assert.equal(signupOrigin(["grifoai", "x"]), "grifoai");
    for (const raw of ["GrifoAI", "facebook", "", null, undefined, ["x"]]) {
      assert.equal(signupOrigin(raw), null);
    }
  });

  test("the origins are exactly the ones signup_origins_known accepts", () => {
    const sql = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "0059_a_founder_comes_by_coupon_or_invite.sql",
      ),
      "utf8",
    );
    const list = /signup_origins_known check \(origin in \(([^)]*)\)\)/.exec(
      sql,
    )?.[1];
    assert.ok(list !== undefined, "signup_origins_known not found");
    assert.deepEqual(
      [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort(),
      [...SIGNUP_ORIGINS].sort(),
    );
  });

  test("the send carries them into the invite", async () => {
    const c = calls(async () => ({ error: null }));
    await signupSend(EMAIL, "Ana", CHELSEA, c.calls, {
      coupon: "FUNDADOR",
      origin: "grifoai",
    });
    const options = c.recorded.invite[0][1] as ReturnType<typeof signupOptions>;
    assert.equal(options.data.founder_coupon, "FUNDADOR");
    assert.equal(options.data.origin, "grifoai");
  });
});

describe("signupFounderView: the founders on /cadastro", () => {
  test("?cupom= fills the field, which shows", () => {
    assert.deepEqual(
      signupFounderView({
        coupon: " ABCD-EFGH ",
        origin: undefined,
        seatsLeft: 3,
      }),
      {
        coupon: "ABCD-EFGH",
        origin: null,
        showCoupon: true,
        seatsEnded: false,
      },
    );
  });

  test("?origem=grifoai hides the field and the seats, and keeps ?cupom=", () => {
    assert.deepEqual(
      signupFounderView({
        coupon: "FUNDADOR",
        origin: "grifoai",
        seatsLeft: 0,
      }),
      {
        coupon: "FUNDADOR",
        origin: "grifoai",
        showCoupon: false,
        seatsEnded: false,
      },
    );
  });

  test("0 seats left says so; no total, or the number unread, says nothing", () => {
    assert.equal(
      signupFounderView({ coupon: undefined, origin: undefined, seatsLeft: 0 })
        .seatsEnded,
      true,
    );
    assert.equal(
      signupFounderView({
        coupon: undefined,
        origin: undefined,
        seatsLeft: null,
      }).seatsEnded,
      false,
    );
  });

  test("an origin unknown is no origin; a list of values takes the first", () => {
    const view = signupFounderView({
      coupon: ["A1B2C3", "x"],
      origin: "facebook",
      seatsLeft: 1,
    });
    assert.equal(view.origin, null);
    assert.equal(view.showCoupon, true);
    assert.equal(view.coupon, "A1B2C3");
  });
});
