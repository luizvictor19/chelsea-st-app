import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fingerprint, firstFrame } from "./fingerprint.ts";

const BASE = {
  kind: "server",
  route: "/teacher/[book]",
  message: "TypeError: x is undefined",
  stack: [
    "TypeError: x is undefined",
    "    at render (/var/task/page.js:12:345)",
    "    at other (/var/task/page.js:1:2)",
  ].join("\n"),
};

describe("firstFrame", () => {
  test("Chrome's shape, without the line and column", () => {
    assert.equal(firstFrame(BASE.stack), "at render (/var/task/page.js)");
  });

  test("Firefox's shape, without the line and column", () => {
    assert.equal(
      firstFrame("onClick@https://app.chelsea-st.com/a.js:1:20\nb@c.js:1:1"),
      "onClick@https://app.chelsea-st.com/a.js",
    );
  });

  test("no stack, or none with a frame, is empty", () => {
    assert.equal(firstFrame(null), "");
    assert.equal(firstFrame("Error: only a message"), "");
  });
});

describe("fingerprint", () => {
  test("64 hex characters, as app_errors_fingerprint_shape takes", () => {
    assert.match(fingerprint(BASE), /^[0-9a-f]{64}$/);
  });

  test("the same error with other digits, or moved lines, is the same", () => {
    assert.equal(
      fingerprint(BASE),
      fingerprint({
        ...BASE,
        message: "TypeError: x is undefined",
        stack: BASE.stack.replace(":12:345", ":99:1"),
      }),
    );
    assert.equal(
      fingerprint({ ...BASE, message: "status 500 after 12 tries" }),
      fingerprint({ ...BASE, message: "status 502 after 3 tries" }),
    );
  });

  test("another kind, route, message or first frame is another error", () => {
    const one = fingerprint(BASE);
    assert.notEqual(one, fingerprint({ ...BASE, kind: "client" }));
    assert.notEqual(one, fingerprint({ ...BASE, route: "/teacher" }));
    assert.notEqual(one, fingerprint({ ...BASE, message: "TypeError: y" }));
    assert.notEqual(
      one,
      fingerprint({ ...BASE, stack: BASE.stack.replace("render", "paint") }),
    );
  });
});
