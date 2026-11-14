import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BODY_LIMIT,
  CLIENT_ENDPOINT,
  REPORTS_PER_PAGE,
  clientPayload,
  createClientReporter,
  digestOf,
  installErrorReporting,
  reportBoundaryError,
  type ClientWindow,
} from "./client.ts";

type Listener = (event: unknown) => void;

function fakeWindow(
  pathname = "/teacher/lesson/3f2a9c1e-0b4d-4e8a-9f6b-2c7d1e0a5b3c",
) {
  const beacons: { url: string; body: Promise<string>; type: string }[] = [];
  const listeners = new Map<string, Listener>();
  const win = {
    location: { pathname },
    navigator: {
      sendBeacon(url: string, data: Blob) {
        beacons.push({ url, body: data.text(), type: data.type });
        return true;
      },
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  return { win: win as unknown as ClientWindow, beacons, listeners };
}

describe("clientPayload", () => {
  test("the message, the stack, and the route as a pattern without its query", () => {
    const error = new TypeError("x is undefined");
    const body = JSON.parse(
      clientPayload(error, "/teacher/lesson/12?token_hash=abc"),
    );
    assert.equal(body.message, "TypeError: x is undefined");
    assert.match(body.stack, /TypeError: x is undefined/);
    assert.equal(body.route, "/teacher/lesson/[n]");
  });

  test("a thrown value that is not an Error is its text, with no stack", () => {
    assert.deepEqual(JSON.parse(clientPayload("raw", "/")), {
      message: "raw",
      route: "/",
    });
  });

  test("stays under the 8 KB the route reads, cutting the stack first", () => {
    const error = new Error("x");
    error.stack = "€".repeat(20_000);
    const body = clientPayload(error, "/");
    assert.ok(new TextEncoder().encode(body).length <= BODY_LIMIT);
    assert.equal(JSON.parse(body).stack.length, 1000);
  });
});

describe("createClientReporter", () => {
  test("sends a beacon to /api/errors", async () => {
    const { win, beacons } = fakeWindow();
    createClientReporter(win)(new Error("boom"));
    assert.equal(beacons.length, 1);
    assert.equal(beacons[0].url, CLIENT_ENDPOINT);
    assert.equal(beacons[0].type, "text/plain");
    const body = JSON.parse(await beacons[0].body);
    assert.equal(body.message, "boom");
    assert.equal(body.route, "/teacher/lesson/[id]");
  });

  test("the same message once per page, and at most 10 a page", () => {
    const { win, beacons } = fakeWindow();
    const report = createClientReporter(win);
    report(new Error("same"));
    report(new Error("same"));
    assert.equal(beacons.length, 1);
    for (let i = 0; i < 20; i++) report(new Error(`loop ${i}`));
    assert.equal(beacons.length, REPORTS_PER_PAGE);
  });

  test("the browser's ResizeObserver noise is not sent", () => {
    const { win, beacons } = fakeWindow();
    createClientReporter(win)(
      new Error(
        "ResizeObserver loop completed with undelivered notifications.",
      ),
    );
    assert.equal(beacons.length, 0);
  });

  test("without sendBeacon, or with one that throws, nothing breaks", () => {
    const none = { ...fakeWindow().win, navigator: {} } as ClientWindow;
    assert.doesNotThrow(() => createClientReporter(none)(new Error("x")));
    const throwing = {
      ...fakeWindow().win,
      navigator: {
        sendBeacon() {
          throw new Error("blocked");
        },
      },
    } as ClientWindow;
    assert.doesNotThrow(() => createClientReporter(throwing)(new Error("x")));
  });
});

describe("installErrorReporting", () => {
  test("an error event and an unhandled rejection are sent", () => {
    const { win, beacons, listeners } = fakeWindow();
    installErrorReporting(win);
    listeners.get("error")?.({
      error: new Error("escaped"),
      filename: "https://app.chelsea-st.com/a.js",
    });
    listeners.get("unhandledrejection")?.({ reason: new Error("rejected") });
    assert.equal(beacons.length, 2);
  });

  test("an error event without an error sends its message", async () => {
    const { win, beacons, listeners } = fakeWindow();
    installErrorReporting(win);
    listeners.get("error")?.({ error: null, message: "Script error." });
    assert.equal(JSON.parse(await beacons[0].body).message, "Script error.");
  });

  test("an extension's script is not ours", () => {
    const { win, beacons, listeners } = fakeWindow();
    installErrorReporting(win);
    listeners.get("error")?.({
      error: new Error("x"),
      filename: "chrome-extension://abc/x.js",
    });
    assert.equal(beacons.length, 0);
  });

  test("a window that refuses listeners breaks nothing", () => {
    const { win } = fakeWindow();
    const refusing = {
      ...win,
      addEventListener() {
        throw new Error("no");
      },
    } as ClientWindow;
    assert.doesNotThrow(() => installErrorReporting(refusing));
  });
});

describe("reportBoundaryError", () => {
  test("an error the boundary caught without a digest is sent; one with a digest came from the server", () => {
    const { win, beacons } = fakeWindow();
    installErrorReporting(win);
    reportBoundaryError(
      Object.assign(new Error("from the server"), { digest: "123" }),
    );
    assert.equal(beacons.length, 0);
    reportBoundaryError(new Error("in the tab"));
    assert.equal(beacons.length, 1);
  });
});

describe("digestOf", () => {
  test("the digest as text, or null", () => {
    assert.equal(
      digestOf(Object.assign(new Error("x"), { digest: "123" })),
      "123",
    );
    assert.equal(digestOf(Object.assign(new Error("x"), { digest: "" })), null);
    assert.equal(digestOf(Object.assign(new Error("x"), { digest: 1 })), null);
    assert.equal(digestOf(new Error("x")), null);
    assert.equal(digestOf("x"), null);
  });
});
