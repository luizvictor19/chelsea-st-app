import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_SERIES_DAYS,
  proposalInputOf,
  proposalStarts,
  quarterHours,
  readProposalForm,
  type ProposalInput,
} from "./proposal-form.ts";

const SP = "America/Sao_Paulo";

const SERIES: ProposalInput = {
  mode: "series",
  date: "",
  time: "19:00",
  // Monday and Wednesday.
  weekdays: [1, 3],
  firstDate: "2026-11-16",
  lastDate: "2026-11-30",
};

function isos(read: ReturnType<typeof proposalStarts>): string[] {
  assert.ok(read.ok, read.ok ? "" : read.message);
  return read.values.map((date) => date.toISOString());
}

function message(read: ReturnType<typeof proposalStarts>): string {
  assert.ok(!read.ok);
  return read.message;
}

describe("proposalStarts", () => {
  test("a series of Mondays and Wednesdays gives every one of them in São Paulo", () => {
    assert.deepEqual(isos(proposalStarts(SERIES, SP)), [
      "2026-11-16T22:00:00.000Z",
      "2026-11-18T22:00:00.000Z",
      "2026-11-23T22:00:00.000Z",
      "2026-11-25T22:00:00.000Z",
      "2026-11-30T22:00:00.000Z",
    ]);
  });

  test("the local hour stays put across a DST change", () => {
    // New York leaves DST on 01/11/2026: 19:00 is 23:00 UTC before, 00:00 after.
    const read = proposalStarts(
      {
        ...SERIES,
        weekdays: [4],
        firstDate: "2026-10-29",
        lastDate: "2026-11-05",
      },
      "America/New_York",
    );
    assert.deepEqual(isos(read), [
      "2026-10-29T23:00:00.000Z",
      "2026-11-06T00:00:00.000Z",
    ]);
  });

  test("one lesson is the day and the time", () => {
    assert.deepEqual(
      isos(
        proposalStarts(
          { ...SERIES, mode: "single", date: "2026-11-20", time: "08:15" },
          SP,
        ),
      ),
      ["2026-11-20T11:15:00.000Z"],
    );
  });

  test("the first and the last day are both included", () => {
    assert.equal(
      isos(
        proposalStarts(
          { ...SERIES, weekdays: [1], lastDate: "2026-11-16" },
          SP,
        ),
      ).length,
      1,
    );
  });

  test("says what is missing or wrong", () => {
    assert.equal(
      message(proposalStarts({ ...SERIES, time: "25:00" }, SP)),
      "Escolha o horário da aula.",
    );
    assert.equal(
      message(
        proposalStarts({ ...SERIES, mode: "single", date: "2026-02-30" }, SP),
      ),
      "Escolha o dia da aula.",
    );
    assert.equal(
      message(proposalStarts({ ...SERIES, mode: "weekly" }, SP)),
      "Escolha entre uma aula e uma série.",
    );
    assert.equal(
      message(proposalStarts({ ...SERIES, weekdays: [] }, SP)),
      "Marque pelo menos um dia da semana.",
    );
    assert.equal(
      message(proposalStarts({ ...SERIES, weekdays: [7, -1, 1.5] }, SP)),
      "Marque pelo menos um dia da semana.",
    );
    assert.equal(
      message(proposalStarts({ ...SERIES, firstDate: "" }, SP)),
      "Escolha a primeira e a última data.",
    );
    assert.equal(
      message(
        proposalStarts(
          { ...SERIES, firstDate: "2026-11-30", lastDate: "2026-11-16" },
          SP,
        ),
      ),
      "A última data não pode vir antes da primeira.",
    );
    assert.equal(
      message(
        proposalStarts(
          {
            ...SERIES,
            weekdays: [0],
            firstDate: "2026-11-16",
            lastDate: "2026-11-18",
          },
          SP,
        ),
      ),
      "Nenhum dia marcado cai entre essas datas.",
    );
  });

  test("a series past the guard is refused before the loop runs", () => {
    const last = new Date(Date.UTC(2026, 10, 16 + MAX_SERIES_DAYS + 1))
      .toISOString()
      .slice(0, 10);
    assert.equal(
      message(proposalStarts({ ...SERIES, lastDate: last }, SP)),
      "Escolha uma última data mais próxima.",
    );
  });
});

describe("readProposalForm", () => {
  test("reads the fields the form sends", () => {
    const form = new FormData();
    form.set("mode", "series");
    form.set("time", "19:00");
    form.append("weekday", "1");
    form.append("weekday", "3");
    form.append("weekday", "9");
    form.set("first_date", "2026-11-16");
    form.set("last_date", "2026-11-18");
    assert.deepEqual(proposalInputOf(form).weekdays, [1, 3]);
    assert.deepEqual(isos(readProposalForm(form, SP)), [
      "2026-11-16T22:00:00.000Z",
      "2026-11-18T22:00:00.000Z",
    ]);
  });

  test("an empty form says what is missing", () => {
    assert.equal(
      message(readProposalForm(new FormData(), SP)),
      "Escolha o horário da aula.",
    );
  });
});

describe("quarterHours", () => {
  test("every 15 minutes, from 00:00 to 23:45", () => {
    const times = quarterHours();
    assert.equal(times.length, 96);
    assert.equal(times[0], "00:00");
    assert.equal(times[1], "00:15");
    assert.equal(times.at(-1), "23:45");
  });
});
