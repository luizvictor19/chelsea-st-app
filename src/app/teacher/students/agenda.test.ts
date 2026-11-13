import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { instantIn, mayCancel, WEEKDAYS, type CancelRights } from "./agenda.ts";

const SP = "America/Sao_Paulo";

/** Monday 02/11/2026, 19:00 in São Paulo (UTC-3, no DST since 2019). */
const MONDAY_19 = new Date("2026-11-02T22:00:00Z");

describe("WEEKDAYS", () => {
  test("starts on Sunday, as extract(dow) and teacher_availability.weekday", () => {
    assert.equal(WEEKDAYS[0], "Domingo");
    assert.equal(WEEKDAYS[MONDAY_19.getUTCDay()], "Segunda");
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

describe("mayCancel", () => {
  const lesson = { organizationId: "org-a", teacherId: "teacher-row-a" };
  const none: CancelRights = {
    platformAdmin: false,
    adminOf: new Set(),
    teacherRows: new Set(),
  };

  test("the lesson's teacher cancels it", () => {
    assert.equal(
      mayCancel({ ...none, teacherRows: new Set(["teacher-row-a"]) }, lesson),
      true,
    );
  });

  test("another teacher of the organization does not", () => {
    assert.equal(
      mayCancel({ ...none, teacherRows: new Set(["teacher-row-b"]) }, lesson),
      false,
    );
    assert.equal(mayCancel(none, lesson), false);
  });

  test("the admin of the lesson's organization does, of another one not", () => {
    assert.equal(
      mayCancel({ ...none, adminOf: new Set(["org-a"]) }, lesson),
      true,
    );
    assert.equal(
      mayCancel({ ...none, adminOf: new Set(["org-b"]) }, lesson),
      false,
    );
  });

  test("the platform admin does", () => {
    assert.equal(mayCancel({ ...none, platformAdmin: true }, lesson), true);
  });
});
