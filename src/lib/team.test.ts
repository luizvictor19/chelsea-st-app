import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TIME_ZONE,
  formatMinutes,
  knownZone,
  lastPracticeLabel,
  summaryLine,
  teamOf,
  teamSummary,
  weekLabels,
  type TeamMember,
  type TeamPractice,
  type TeamProfile,
} from "./team.ts";
import { DAILY_PRACTICE_MINUTES } from "./tutor/daily-cap.ts";

// Friday 06/11/2026, 12:00 in São Paulo, 15:00 in London. Its Monday is 02/11.
const NOW = new Date("2026-11-06T15:00:00Z");
const F = "org-f";
const G = "org-g";

const member = (
  userId: string,
  organizationId = F,
  joinedAt = "2026-11-03T12:00:00Z",
): TeamMember => ({ userId, organizationId, joinedAt });

const profile = (
  id: string,
  fullName: string,
  timeZone = "America/Sao_Paulo",
): TeamProfile => ({ id, fullName, timeZone });

const practice = (
  personId: string,
  lastPractisedOn: string | null,
  daysByWeek: number[],
  minutesThisMonth = 0,
  organizationId = F,
): TeamPractice => ({
  organizationId,
  personId,
  lastPractisedOn,
  daysByWeek,
  minutesThisMonth,
});

// Two organizations mixed in every input, as the queries hand them over.
const members = [
  member("ana"),
  member("bia"),
  member("caio"),
  member("gil", G),
  member("dora"),
];
const profiles = [
  profile("ana", "Ana"),
  profile("bia", "Bia"),
  profile("caio", "Caio", "Europe/London"),
  profile("gil", "Gil"),
  profile("dora", "Dora"),
];
const practices = [
  practice("ana", "2026-11-06", [1, 2, 3, 1], 40),
  practice("bia", "2026-10-28", [0, 1, 1, 0], 15),
  practice("caio", null, [0, 0, 0, 0]),
  practice("gil", "2026-11-06", [7, 7, 7, 5], 200, G),
  practice("dora", "2026-10-20", [0, 1, 0, 0]),
];

function rowsOfF() {
  return teamOf({
    organizationId: F,
    members,
    profiles,
    practice: practices,
    now: NOW,
  });
}

describe("teamOf", () => {
  test("holds only the people and the practice of the organization asked", () => {
    const rows = rowsOfF();
    assert.deepEqual(rows.map((row) => row.id).sort(), [
      "ana",
      "bia",
      "caio",
      "dora",
    ]);
    const ofG = teamOf({
      organizationId: G,
      members,
      profiles,
      practice: practices,
      now: NOW,
    });
    assert.deepEqual(
      ofG.map((row) => [row.id, row.minutesThisMonth]),
      [["gil", 200]],
    );
  });

  test("practice of another organization never lands on a person of this one", () => {
    // The same person id under G: a row of team_practice for G is not hers here.
    const rows = teamOf({
      organizationId: F,
      members: [member("ana")],
      profiles,
      practice: [practice("ana", "2026-11-06", [7, 7, 7, 7], 300, G)],
      now: NOW,
    });
    assert.equal(rows[0].lastPractice, "Ainda não praticou");
    assert.deepEqual(rows[0].daysByWeek, [0, 0, 0, 0]);
    assert.equal(rows[0].minutesThisMonth, 0);
  });

  test("never practised first, then the oldest last practice, then by name", () => {
    const rows = teamOf({
      organizationId: F,
      members: [...members, member("abel")],
      profiles: [...profiles, profile("abel", "Abel")],
      practice: practices,
      now: NOW,
    });
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Abel", "Caio", "Dora", "Bia", "Ana"],
    );
  });

  test("a member with no practice row yet reads as never practised", () => {
    // No row in students yet, so team_practice does not return her.
    const rows = teamOf({
      organizationId: F,
      members: [member("eva")],
      profiles: [profile("eva", "Eva")],
      practice: [],
      now: NOW,
    });
    assert.deepEqual(rows, [
      {
        id: "eva",
        name: "Eva",
        joinedOn: "03/11",
        lastPractisedOn: null,
        lastPractice: "Ainda não praticou",
        daysByWeek: [0, 0, 0, 0],
        practisedThisWeek: false,
        minutesThisMonth: 0,
        minutesAvailable: 6 * DAILY_PRACTICE_MINUTES,
      },
    ]);
  });

  test("the admin who also practises appears once", () => {
    const rows = teamOf({
      organizationId: F,
      members: [member("ana"), member("ana")],
      profiles,
      practice: practices,
      now: NOW,
    });
    assert.equal(rows.length, 1);
  });

  test("a member without a profile still shows, without a name", () => {
    const rows = teamOf({
      organizationId: F,
      members: [member("zé")],
      profiles: [],
      practice: [],
      now: NOW,
    });
    assert.equal(rows[0].name, "Sem nome");
    assert.equal(rows[0].joinedOn, "03/11");
  });

  test("labels and time follow the person's own zone", () => {
    const rows = rowsOfF();
    const ana = rows.find((row) => row.id === "ana");
    const bia = rows.find((row) => row.id === "bia");
    assert.equal(ana?.lastPractice, "Hoje");
    assert.equal(ana?.practisedThisWeek, true);
    assert.equal(bia?.lastPractice, "28/10");
    assert.equal(bia?.practisedThisWeek, false);
    assert.equal(ana?.minutesAvailable, 90);

    // 01/11 at 02:00 UTC is still 31/10 in São Paulo and already 01/11 in
    // London: the month of one is ending, the other's just began.
    const turn = new Date("2026-11-01T02:00:00Z");
    const atTurn = teamOf({
      organizationId: F,
      members: [member("ana", F, "2026-10-01T02:00:00Z"), member("caio")],
      profiles,
      practice: [practice("ana", "2026-10-30", [0, 0, 1, 0])],
      now: turn,
    });
    const anaAtTurn = atTurn.find((row) => row.id === "ana");
    const caioAtTurn = atTurn.find((row) => row.id === "caio");
    assert.equal(anaAtTurn?.minutesAvailable, 31 * DAILY_PRACTICE_MINUTES);
    assert.equal(anaAtTurn?.lastPractice, "Ontem");
    assert.equal(anaAtTurn?.joinedOn, "30/09");
    assert.equal(caioAtTurn?.minutesAvailable, DAILY_PRACTICE_MINUTES);
  });
});

describe("knownZone", () => {
  test("a zone Intl knows stays, anything else is the default", () => {
    assert.equal(knownZone("Europe/London"), "Europe/London");
    assert.equal(knownZone("Not/A_Zone"), DEFAULT_TIME_ZONE);
    assert.equal(knownZone(undefined), DEFAULT_TIME_ZONE);
  });

  test("one profile with a zone nobody knows does not take the team down", () => {
    // 01/11 at 02:00 UTC is still 31/10 in São Paulo, the default.
    const rows = teamOf({
      organizationId: F,
      members: [member("ana"), member("bia")],
      profiles: [profile("ana", "Ana", "Not/A_Zone"), profile("bia", "Bia")],
      practice: [practice("ana", "2026-10-31", [0, 0, 0, 1])],
      now: new Date("2026-11-01T02:00:00Z"),
    });
    const ana = rows.find((row) => row.id === "ana");
    assert.equal(ana?.lastPractice, "Hoje");
    assert.equal(ana?.minutesAvailable, 31 * DAILY_PRACTICE_MINUTES);
  });
});

describe("lastPracticeLabel", () => {
  test("today, yesterday, a date, or never", () => {
    assert.equal(lastPracticeLabel("2026-11-06", "2026-11-06"), "Hoje");
    assert.equal(lastPracticeLabel("2026-11-05", "2026-11-06"), "Ontem");
    assert.equal(lastPracticeLabel("2026-10-31", "2026-11-01"), "Ontem");
    assert.equal(lastPracticeLabel("2026-10-30", "2026-11-06"), "30/10");
    assert.equal(lastPracticeLabel(null, "2026-11-06"), "Ainda não praticou");
  });
});

describe("weekLabels", () => {
  test("the Mondays of the weeks, oldest first, this week last", () => {
    assert.deepEqual(weekLabels(NOW, "America/Sao_Paulo", 4), [
      "12/10",
      "19/10",
      "26/10",
      "02/11",
    ]);
  });

  test("a Monday is this week's first day, and Sunday its last", () => {
    // Monday 02/11 at 00:30 in São Paulo.
    assert.deepEqual(
      weekLabels(new Date("2026-11-02T03:30:00Z"), "America/Sao_Paulo", 2),
      ["26/10", "02/11"],
    );
    // Sunday 01/11 at 23:30 in São Paulo, already Monday in London.
    const sunday = new Date("2026-11-02T02:30:00Z");
    assert.deepEqual(weekLabels(sunday, "America/Sao_Paulo", 1), ["26/10"]);
    assert.deepEqual(weekLabels(sunday, "Europe/London", 1), ["02/11"]);
  });
});

describe("teamSummary and summaryLine", () => {
  test("who practised this week, and the month's time against the time available", () => {
    const summary = teamSummary(rowsOfF());
    assert.deepEqual(summary, {
      people: 4,
      practisedThisWeek: 1,
      minutesThisMonth: 55,
      minutesAvailable: 4 * 6 * DAILY_PRACTICE_MINUTES,
    });
    assert.equal(summaryLine(summary), "1 de 4 praticou esta semana.");
    assert.equal(
      summaryLine({ ...summary, practisedThisWeek: 3 }),
      "3 de 4 praticaram esta semana.",
    );
    assert.equal(
      summaryLine({ ...summary, practisedThisWeek: 0 }),
      "0 de 4 praticaram esta semana.",
    );
  });

  test("an empty team", () => {
    assert.deepEqual(teamSummary([]), {
      people: 0,
      practisedThisWeek: 0,
      minutesThisMonth: 0,
      minutesAvailable: 0,
    });
  });
});

describe("formatMinutes", () => {
  test("minutes under an hour, hours and minutes above", () => {
    assert.equal(formatMinutes(0), "0 min");
    assert.equal(formatMinutes(45), "45 min");
    assert.equal(formatMinutes(60), "1h");
    assert.equal(formatMinutes(65), "1h05");
    assert.equal(formatMinutes(90), "1h30");
    assert.equal(formatMinutes(465), "7h45");
  });
});
