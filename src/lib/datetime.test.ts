import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  calendarDaysBetween,
  formatLessonDate,
  formatLessonTime,
  humanCountdown,
  instantIn,
  offsetAt,
} from "./datetime.ts";

const SP = "America/Sao_Paulo";

describe("instantIn", () => {
  test("a local date and time in São Paulo become the right UTC instant", () => {
    // Monday 02/11/2026, 19:00 in São Paulo (UTC-3, no DST since 2019).
    assert.equal(
      instantIn("2026-11-02", "19:00", SP).toISOString(),
      "2026-11-02T22:00:00.000Z",
    );
  });

  test("works where the offset changes with the season", () => {
    // New York is UTC-5 in November and UTC-4 in July.
    assert.equal(
      instantIn("2026-11-10", "19:00", "America/New_York").toISOString(),
      "2026-11-11T00:00:00.000Z",
    );
    assert.equal(
      instantIn("2026-07-10", "19:00", "America/New_York").toISOString(),
      "2026-07-10T23:00:00.000Z",
    );
  });
});

describe("offsetAt", () => {
  test("is how far the zone is ahead of UTC at that instant", () => {
    assert.equal(
      offsetAt(new Date("2026-11-02T22:00:00Z"), SP),
      -3 * 3_600_000,
    );
    assert.equal(
      offsetAt(new Date("2026-07-10T23:00:00Z"), "America/New_York"),
      -4 * 3_600_000,
    );
  });
});

describe("calendarDaysBetween", () => {
  test("counts calendar dates in the zone, not 24-hour blocks", () => {
    // 23:00 on the 2nd to 01:00 on the 3rd, in São Paulo.
    assert.equal(
      calendarDaysBetween(
        new Date("2026-11-03T02:00:00Z"),
        new Date("2026-11-03T04:00:00Z"),
        SP,
      ),
      1,
    );
    assert.equal(
      calendarDaysBetween(
        new Date("2026-11-03T02:00:00Z"),
        new Date("2026-11-03T04:00:00Z"),
        "UTC",
      ),
      0,
    );
  });
});

describe("humanCountdown", () => {
  const from = new Date("2026-11-02T12:00:00Z");
  const after = (ms: number) => new Date(from.getTime() + ms);

  test("now, minutes, hours, tomorrow and days", () => {
    assert.equal(humanCountdown(from, from, SP), "agora");
    assert.equal(humanCountdown(from, after(10 * 60_000), SP), "em 10 minutos");
    assert.equal(humanCountdown(from, after(3 * 3_600_000), SP), "em 3 horas");
    assert.equal(humanCountdown(from, after(24 * 3_600_000), SP), "amanhã");
    assert.equal(humanCountdown(from, after(72 * 3_600_000), SP), "em 3 dias");
  });

  test("half a day away on the same date says hours", () => {
    // 09:00 to 21:30 in São Paulo, the same date.
    assert.equal(
      humanCountdown(from, after(12.5 * 3_600_000), SP),
      "em 13 horas",
    );
  });
});

describe("formatLessonDate and formatLessonTime", () => {
  test("in the zone given", () => {
    const instant = new Date("2026-11-02T22:00:00Z");
    assert.equal(
      formatLessonDate(instant, SP),
      "segunda-feira, 02 de novembro",
    );
    assert.equal(formatLessonTime(instant, SP), "19:00");
    assert.equal(formatLessonTime(instant, "UTC"), "22:00");
  });
});
