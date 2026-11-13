import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseMeetUrl } from "./meet-url.ts";

describe("parseMeetUrl", () => {
  test("keeps an https link without the spaces around it", () => {
    assert.deepEqual(
      parseMeetUrl("  https://meet.google.com/abc-defg-hij \n"),
      {
        ok: true,
        url: "https://meet.google.com/abc-defg-hij",
      },
    );
  });

  test("empty clears the link", () => {
    assert.deepEqual(parseMeetUrl("   "), { ok: true, url: null });
  });

  test("refuses http, a space inside and what is not a link", () => {
    assert.equal(parseMeetUrl("http://meet.google.com/abc").ok, false);
    assert.equal(parseMeetUrl("meet.google.com/abc").ok, false);
    assert.equal(parseMeetUrl("abc defg").ok, false);
    assert.deepEqual(parseMeetUrl("https://meet.google.com/abc def"), {
      ok: false,
      error: "O link não pode ter espaços.",
    });
  });

  test("holds the shape teachers_meet_url_https checks", () => {
    for (const raw of [
      "https://meet.google.com/abc-defg-hij",
      "http://x.y",
      "https://a b",
      "ftp://x.y",
    ]) {
      const parsed = parseMeetUrl(raw);
      const database = /^https:\/\/\S+$/.test(raw);
      assert.equal(parsed.ok && parsed.url !== null, database, raw);
    }
  });
});
