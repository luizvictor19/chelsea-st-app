import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calendarDaily, DAILY_LIMIT } from "./daily.ts";

const SECRET = "c".repeat(40);
const URL = "https://app.example.com/api/calendar/daily";

function counting() {
  const limits: number[] = [];
  return {
    limits,
    drain: async (limit: number) => {
      limits.push(limit);
      return { sent: 2, retry: 1, abandoned: 0 };
    },
  };
}

describe("calendarDaily", () => {
  test("without the secret: 401, and nothing is read or sent", async () => {
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
    ];
    for (const headers of attempts) {
      const { limits, drain } = counting();
      const response = await calendarDaily(new Request(URL, { headers }), {
        secret: SECRET,
        drain,
      });
      assert.equal(response.status, 401);
      assert.deepEqual(limits, []);
    }
  });

  test("with no secret set, even an empty bearer is refused", async () => {
    const { limits, drain } = counting();
    const response = await calendarDaily(
      new Request(URL, { headers: { authorization: "Bearer " } }),
      { secret: undefined, drain },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(limits, []);
  });

  test("with the secret: one drain of any lesson, and its report", async () => {
    const { limits, drain } = counting();
    const response = await calendarDaily(
      new Request(URL, { headers: { authorization: `Bearer ${SECRET}` } }),
      { secret: SECRET, drain },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sent: 2,
      retry: 1,
      abandoned: 0,
    });
    assert.deepEqual(limits, [DAILY_LIMIT]);
  });
});
