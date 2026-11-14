import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MESSAGE_LIMIT,
  STACK_FRAMES,
  STACK_LIMIT,
  scrubDigest,
  scrubMessage,
  scrubRoute,
  scrubStack,
  scrubText,
} from "./scrub.ts";

/**
 * One case per pattern of the plan of 14/11 on #69. Each input holds only the
 * thing its rule takes out, so removing that rule fails that case alone.
 */

describe("scrubText takes out what names a person", () => {
  test("an e-mail", () => {
    assert.equal(
      scrubText("no account for ana.silva+aulas@example.com.br today"),
      "no account for [email] today",
    );
  });

  test("the real message of src/lib/judge/expected.ts:104, the spoken text in double quotes", () => {
    const errorSpan = "goed";
    const spoken = "yesterday I goed to the market with my sister";
    assert.equal(
      scrubText(`"${errorSpan}" is not in "${spoken}" as whole words`),
      '"[texto]" is not in "[texto]" as whole words',
    );
  });

  test("text in single quotes, with an apostrophe inside, and the contraction outside left alone", () => {
    assert.equal(
      scrubText("can't judge 'I don't know her' now"),
      `can't judge "[texto]" now`,
    );
  });

  test("text in backticks", () => {
    assert.equal(scrubText("said `my name is Ana`"), 'said "[texto]"');
  });

  test("text in typographic quotes", () => {
    assert.equal(
      scrubText("said “meu nome é Ana” and ‘oi’"),
      'said "[texto]" and "[texto]"',
    );
  });

  test("a constraint name in quotes stays: it names no person and says where it failed", () => {
    assert.equal(
      scrubText('violates unique constraint "profiles_email_key"'),
      'violates unique constraint "profiles_email_key"',
    );
  });

  test("the value of Postgres's Key (column)=(value)", () => {
    assert.equal(
      scrubText("Key (full_name)=(Ana Maria Silva) already exists."),
      "Key (full_name)=([valor]) already exists.",
    );
  });

  test("Key (column)=(value) with a function in the column and an e-mail as the value", () => {
    assert.equal(
      scrubText("Key (lower(email))=(ana@example.com) already exists."),
      "Key (lower(email))=([valor]) already exists.",
    );
  });

  test("a UUID, as src/lib/content/queries.ts:58 writes the user's id", () => {
    assert.equal(
      scrubText("no profile for 3f2a9c1e-0b4d-4e8a-9f6b-2c7d1e0a5b3c"),
      "no profile for [id]",
    );
  });

  test("a formatted CPF", () => {
    assert.equal(
      scrubText("cpf 123.456.789-09 refused"),
      "cpf [número] refused",
    );
  });

  test("a CPF without dots", () => {
    assert.equal(scrubText("cpf 12345678909 refused"), "cpf [número] refused");
  });

  test("a WhatsApp with the country code, as stored", () => {
    assert.equal(scrubText("lead 5511987654321 sent"), "lead [número] sent");
  });

  test("a WhatsApp with the country code, as typed", () => {
    assert.equal(
      scrubText("lead +55 (11) 98765-4321 sent"),
      "lead [número] sent",
    );
  });

  test("seven digits stay: a count or a status is no person", () => {
    assert.equal(
      scrubText("status 500 after 1234567 ms"),
      "status 500 after 1234567 ms",
    );
  });

  test("a JWT", () => {
    assert.equal(
      scrubText(
        "session eyJhbGciOiJFUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.c2lnbmF0dXJl expired",
      ),
      "session [token] expired",
    );
  });

  for (const key of [
    "sb_secret_AbC123-xyz",
    "sb_publishable_AbC123-xyz",
    "$aact_YTU5YTE0M2M2N2I4MTliNz+/k=",
    "re_AbC123_xyz",
  ]) {
    test(`a key with its prefix: ${key.slice(0, key.indexOf("_") + 1)}`, () => {
      assert.equal(scrubText(`key ${key} refused`), "key [token] refused");
    });
  }

  test("a bearer token", () => {
    assert.equal(
      scrubText("header Bearer abc.DEF-123 refused"),
      "header Bearer [token] refused",
    );
  });

  test("the query and the fragment of a URL", () => {
    assert.equal(
      scrubText(
        "fetch https://app.chelsea-st.com/auth/confirm?token_hash=abc123&type=email#top failed",
      ),
      "fetch https://app.chelsea-st.com/auth/confirm failed",
    );
  });

  test("the query of a path with no host", () => {
    assert.equal(
      scrubText("GET /auth/confirm?token_hash=abc123&type=email failed"),
      "GET /auth/confirm failed",
    );
  });

  test("a token_hash outside any URL", () => {
    assert.equal(
      scrubText("bad token_hash=abc123 given"),
      "bad token_hash=[token] given",
    );
  });

  test("the query of a frame's URL goes, its line and column stay", () => {
    assert.equal(
      scrubText(
        "    at onClick (https://app.chelsea-st.com/_next/static/chunks/a1b2.js?dpl=dpl_Xy9:1:2345)",
      ),
      "    at onClick (https://app.chelsea-st.com/_next/static/chunks/a1b2.js:1:2345)",
    );
  });
});

describe("what has to remain", () => {
  test("the type of the error, a frame with its line, and a route", () => {
    const stack = [
      "TypeError: Cannot read properties of undefined",
      "    at render (/var/task/.next/server/app/teacher/page.js:12:345)",
    ].join("\n");
    assert.equal(scrubStack(stack), stack);
    assert.equal(
      scrubRoute("/teacher/content/[book]"),
      "/teacher/content/[book]",
    );
  });

  test("a digest stays whole, digits and all; anything else is no digest", () => {
    assert.equal(scrubDigest("2830441736"), "2830441736");
    assert.equal(scrubDigest("NEXT_REDIRECT-a1"), "NEXT_REDIRECT-a1");
    assert.equal(scrubDigest("ana@example.com"), null);
    assert.equal(scrubDigest("x".repeat(65)), null);
    assert.equal(scrubDigest(undefined), null);
  });
});

describe("the stack is scrubbed whole and cut", () => {
  test("its first line repeats the message, and is scrubbed too", () => {
    const stack = [
      "Error: no account for ana@example.com",
      "    at signIn (/var/task/.next/server/app/login/page.js:1:20)",
    ].join("\n");
    assert.equal(
      scrubStack(stack),
      [
        "Error: no account for [email]",
        "    at signIn (/var/task/.next/server/app/login/page.js:1:20)",
      ].join("\n"),
    );
  });

  test(`at most ${STACK_FRAMES} frames after the first line`, () => {
    const frames = Array.from(
      { length: STACK_FRAMES + 10 },
      (_, i) => `    at f${i} (file.js:1:${i})`,
    );
    const lines = scrubStack(["Error: x", ...frames].join("\n")).split("\n");
    assert.equal(lines.length, STACK_FRAMES + 1);
    assert.equal(lines[0], "Error: x");
  });

  test(`at most ${STACK_LIMIT} characters`, () => {
    const long = `Error: ${"x".repeat(STACK_LIMIT * 2)}`;
    assert.equal(scrubStack(long).length, STACK_LIMIT);
  });

  test("an empty or missing stack is null", () => {
    assert.equal(scrubStack(""), null);
    assert.equal(scrubStack(null), null);
    assert.equal(scrubStack(undefined), null);
  });
});

describe("the message", () => {
  test(`is cut at ${MESSAGE_LIMIT} characters, after the scrub`, () => {
    const message = scrubMessage(
      `${"a".repeat(MESSAGE_LIMIT)} ana@example.com`,
    );
    assert.equal(message.length, MESSAGE_LIMIT);
    assert.ok(!message.includes("@"));
  });

  test("an empty message says so", () => {
    assert.equal(scrubMessage("   "), "(sem mensagem)");
  });
});

describe("scrubRoute", () => {
  test("takes the query and the fragment out", () => {
    assert.equal(scrubRoute("/auth/confirm?token_hash=abc#x"), "/auth/confirm");
  });

  test("a UUID becomes [id] and a number [n]", () => {
    assert.equal(
      scrubRoute(
        "/teacher/lesson/3f2a9c1e-0b4d-4e8a-9f6b-2c7d1e0a5b3c/point/12",
      ),
      "/teacher/lesson/[id]/point/[n]",
    );
  });

  test("anything left that names a person goes through scrubText", () => {
    assert.equal(scrubRoute("/convite/ana@example.com"), "/convite/[email]");
  });

  test("is cut at 200 characters, and empty is /", () => {
    assert.equal(scrubRoute(`/${"a".repeat(300)}`).length, 200);
    assert.equal(scrubRoute(""), "/");
  });
});
