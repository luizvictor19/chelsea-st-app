import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sitesFromEnv } from "../brand.ts";

import { BODY_LIMIT, originAllowed, readClientReport } from "./intake.ts";

const ON_VERCEL = sitesFromEnv({ VERCEL: "1" });
const SITE = "https://app.chelsea-st.com";
const allowed = (origin: string | null) => originAllowed(origin, ON_VERCEL);

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/errors`, {
    method: "POST",
    body,
    headers: { origin: SITE, ...headers },
  });
}

const GOOD = JSON.stringify({
  message: "TypeError: x is undefined",
  stack: "TypeError: x is undefined\n    at a (b.js:1:2)",
  route: "/teacher/content/images",
});

describe("originAllowed", () => {
  test("a listed site's origin, whole", () => {
    assert.equal(allowed(SITE), true);
  });

  test("anything else: another host, another scheme, a port, a path, none", () => {
    for (const origin of [
      "https://evil.example",
      "http://app.chelsea-st.com",
      "https://app.chelsea-st.com:443",
      "https://app.chelsea-st.com.evil.com",
      "https://app.chelsea-st.com/x",
      "null",
      "",
      null,
    ]) {
      assert.equal(allowed(origin), false, String(origin));
    }
  });

  test("off Vercel, the dev server's loopback", () => {
    const local = sitesFromEnv({});
    assert.equal(originAllowed("http://localhost:3100", local), true);
  });
});

describe("readClientReport", () => {
  test("a good report from a listed site: a client error", async () => {
    assert.deepEqual(await readClientReport(post(GOOD), allowed), {
      kind: "client",
      route: "/teacher/content/images",
      message: "TypeError: x is undefined",
      stack: "TypeError: x is undefined\n    at a (b.js:1:2)",
    });
  });

  test("without a stack or a route", async () => {
    assert.deepEqual(
      await readClientReport(post(JSON.stringify({ message: "x" })), allowed),
      { kind: "client", route: "/", message: "x", stack: null },
    );
  });

  test("an Origin from elsewhere, or none: nothing", async () => {
    assert.equal(
      await readClientReport(
        post(GOOD, { origin: "https://evil.example" }),
        allowed,
      ),
      null,
    );
    const noOrigin = new Request(`${SITE}/api/errors`, {
      method: "POST",
      body: GOOD,
    });
    assert.equal(await readClientReport(noOrigin, allowed), null);
  });

  test("a body above 8 KB: nothing, declared or not", async () => {
    const big = JSON.stringify({ message: "x".repeat(BODY_LIMIT) });
    assert.equal(await readClientReport(post(big), allowed), null);
    const streamed = new Request(`${SITE}/api/errors`, {
      method: "POST",
      headers: { origin: SITE },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    assert.equal(await readClientReport(streamed, allowed), null);
  });

  test("no body at all: nothing", async () => {
    const empty = new Request(`${SITE}/api/errors`, {
      method: "POST",
      headers: { origin: SITE },
    });
    assert.equal(await readClientReport(empty, allowed), null);
  });

  test("a field beyond message, stack and route: nothing", async () => {
    for (const extra of [
      { user: "ana@example.com" },
      { headers: {} },
      { cookie: "x" },
    ]) {
      const body = JSON.stringify({ message: "x", ...extra });
      assert.equal(await readClientReport(post(body), allowed), null);
    }
  });

  test("not JSON, not an object, no message, or a field of the wrong type: nothing", async () => {
    for (const body of [
      "not json",
      "[]",
      "null",
      '"x"',
      "{}",
      JSON.stringify({ message: "  " }),
      JSON.stringify({ message: 1 }),
      JSON.stringify({ message: "x", stack: 1 }),
      JSON.stringify({ message: "x", route: 1 }),
    ]) {
      assert.equal(await readClientReport(post(body), allowed), null, body);
    }
  });
});
