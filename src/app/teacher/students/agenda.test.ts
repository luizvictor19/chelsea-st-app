import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  instantIn,
  lessonsLeavingWith,
  parseMeetUrl,
  parseStartTime,
  runsOutSoon,
  scheduleLabel,
  slotOf,
  type AgendaLesson,
} from "./agenda.ts";

const SP = "America/Sao_Paulo";

/** Monday 02/11/2026, 19:00 in São Paulo (UTC-3, no DST since 2019). */
const MONDAY_19 = new Date("2026-11-02T22:00:00Z");

function lesson(
  id: string,
  scheduledAt: string,
  status: AgendaLesson["status"] = "scheduled",
): AgendaLesson {
  return { id, scheduledAt, status };
}

describe("slotOf", () => {
  test("reads weekday and time in the schedule's zone, not in UTC", () => {
    // 22:00 UTC is still Monday 19:00 in São Paulo.
    assert.deepEqual(slotOf(MONDAY_19, SP), { weekday: 1, time: "19:00" });
  });

  test("a late lesson crosses into the next UTC day without changing its weekday", () => {
    // Monday 22:30 in São Paulo is Tuesday 01:30 UTC.
    assert.deepEqual(slotOf(new Date("2026-11-03T01:30:00Z"), SP), {
      weekday: 1,
      time: "22:30",
    });
  });
});

describe("instantIn", () => {
  test("a local date and time in São Paulo become the right UTC instant", () => {
    assert.equal(
      instantIn("2026-11-02", "19:00", SP).toISOString(),
      MONDAY_19.toISOString(),
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

describe("lessonsLeavingWith", () => {
  const schedule = { weekday: 1, startTime: "19:00:00", timeZone: SP };
  const now = new Date("2026-11-02T22:20:00Z"); // Monday 19:20, during a lesson

  test("takes the future lessons on the schedule's weekday and time", () => {
    const leaving = lessonsLeavingWith(
      schedule,
      [
        lesson("next-monday", "2026-11-09T22:00:00Z"),
        lesson("monday-after", "2026-11-16T22:00:00Z"),
      ],
      now,
    );
    assert.deepEqual(
      leaving.map((row) => row.id),
      ["next-monday", "monday-after"],
    );
  });

  test("leaves the lesson running now, the past and the cancelled ones", () => {
    const leaving = lessonsLeavingWith(
      schedule,
      [
        lesson("running", "2026-11-02T22:00:00Z"),
        lesson("last-week", "2026-10-26T22:00:00Z"),
        lesson("cancelled", "2026-11-09T22:00:00Z", "cancelled"),
      ],
      now,
    );
    assert.deepEqual(leaving, []);
  });

  test("leaves a lesson moved to another time or another day", () => {
    const leaving = lessonsLeavingWith(
      schedule,
      [
        lesson("monday-20h", "2026-11-09T23:00:00Z"),
        lesson("tuesday-19h", "2026-11-10T22:00:00Z"),
      ],
      now,
    );
    assert.deepEqual(leaving, []);
  });
});

describe("runsOutSoon", () => {
  const now = new Date("2026-11-03T12:00:00Z");

  test("warns with no lesson ahead at all", () => {
    assert.equal(runsOutSoon(null, now), true);
  });

  test("warns when the last lesson is less than 14 days away", () => {
    assert.equal(runsOutSoon(new Date("2026-11-16T22:00:00Z"), now), true);
  });

  test("is quiet at 14 days or more", () => {
    assert.equal(runsOutSoon(new Date("2026-11-17T12:00:00Z"), now), false);
    assert.equal(runsOutSoon(new Date("2026-12-29T22:00:00Z"), now), false);
  });
});

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

  test("refuses http and what is not a link", () => {
    assert.equal(parseMeetUrl("http://meet.google.com/abc").ok, false);
    assert.equal(parseMeetUrl("meet.google.com/abc").ok, false);
    assert.equal(parseMeetUrl("abc defg").ok, false);
  });
});

describe("parseStartTime", () => {
  test("accepts what a time input sends", () => {
    assert.equal(parseStartTime("19:00"), "19:00");
    assert.equal(parseStartTime("07:30"), "07:30");
  });

  test("refuses anything else", () => {
    assert.equal(parseStartTime("24:00"), null);
    assert.equal(parseStartTime("19h"), null);
    assert.equal(parseStartTime(""), null);
  });
});

describe("scheduleLabel", () => {
  test("names the day and the hour as people say them", () => {
    assert.equal(scheduleLabel(1, "19:00:00", 45), "Segunda, 19h · 45 min");
    assert.equal(scheduleLabel(4, "19:30:00", 50), "Quinta, 19h30 · 50 min");
    assert.equal(scheduleLabel(0, "09:05:00", 45), "Domingo, 9h05 · 45 min");
  });
});
