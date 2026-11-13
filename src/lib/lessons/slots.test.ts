import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  creditsLabel,
  groupSlotsByDay,
  MAX_WEEK,
  readWeek,
  startLabel,
  weekSpan,
} from "./slots.ts";

const SP = "America/Sao_Paulo";
const LISBON = "Europe/Lisbon";
const NEW_YORK = "America/New_York";

describe("groupSlotsByDay", () => {
  test("groups by the day in the reader's zone, in time order", () => {
    const days = groupSlotsByDay(
      ["2026-11-17T13:00:00Z", "2026-11-16T22:00:00Z", "2026-11-16T13:00:00Z"],
      SP,
    );
    assert.deepEqual(
      days.map((day) => [day.key, day.slots.map((slot) => slot.time)]),
      [
        ["2026-11-16", ["10:00", "19:00"]],
        ["2026-11-17", ["10:00"]],
      ],
    );
    assert.equal(days[0].label, "segunda-feira, 16 de novembro");
    assert.equal(days[0].slots[1].startsAt, "2026-11-16T22:00:00Z");
  });

  test("a start near midnight is Monday in São Paulo and Tuesday in Lisbon", () => {
    // 23:00 in São Paulo (UTC-3) is 02:00 the next day in Lisbon (UTC+0).
    const start = ["2026-11-17T02:00:00Z"];
    assert.equal(groupSlotsByDay(start, SP)[0].key, "2026-11-16");
    assert.equal(groupSlotsByDay(start, SP)[0].slots[0].time, "23:00");
    assert.equal(groupSlotsByDay(start, LISBON)[0].key, "2026-11-17");
    assert.equal(groupSlotsByDay(start, LISBON)[0].slots[0].time, "02:00");
  });

  test("follows a zone across its change of daylight saving time", () => {
    // New York leaves daylight saving time on 01/11/2026: 10:00 is 14:00 UTC
    // the day before and 15:00 UTC the day after.
    const days = groupSlotsByDay(
      ["2026-10-31T14:00:00Z", "2026-11-02T15:00:00Z"],
      NEW_YORK,
    );
    assert.deepEqual(
      days.map((day) => [day.key, day.slots[0].time]),
      [
        ["2026-10-31", "10:00"],
        ["2026-11-02", "10:00"],
      ],
    );
  });

  test("no slot is no day", () => {
    assert.deepEqual(groupSlotsByDay([], SP), []);
  });
});

describe("weekSpan", () => {
  test("seven days from now, so many weeks ahead", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    assert.deepEqual(weekSpan(now, 0), {
      from: now,
      to: new Date("2026-11-20T12:00:00Z"),
    });
    assert.deepEqual(weekSpan(now, 2), {
      from: new Date("2026-11-27T12:00:00Z"),
      to: new Date("2026-12-04T12:00:00Z"),
    });
  });
});

describe("readWeek", () => {
  test("a whole number from the address, capped", () => {
    assert.equal(readWeek("3"), 3);
    assert.equal(readWeek(["2", "5"]), 2);
    assert.equal(readWeek("99"), MAX_WEEK);
  });

  test("anything else is this week", () => {
    for (const raw of [undefined, "", "-1", "1.5", "abc", "100"]) {
      assert.equal(readWeek(raw), 0, String(raw));
    }
  });
});

describe("labels", () => {
  test("the start as a person says it", () => {
    assert.equal(
      startLabel("2026-11-16T22:00:00Z", SP),
      "19:00 de segunda-feira, 16 de novembro",
    );
  });

  test("credits in the singular and the plural", () => {
    assert.equal(creditsLabel(1), "1 crédito");
    assert.equal(creditsLabel(4), "4 créditos");
    assert.equal(creditsLabel(0), "0 créditos");
  });
});
