import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  readProfileForm,
  readTimeOffForm,
  readWindowForm,
} from "./availability-form.ts";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("readProfileForm", () => {
  test("a full profile that takes bookings", () => {
    assert.deepEqual(
      readProfileForm(
        form({
          meet_url: " https://meet.google.com/abc-defg-hij ",
          calendar_email: " agenda@example.com ",
          is_active: "on",
        }),
      ),
      {
        ok: true,
        values: {
          meetUrl: "https://meet.google.com/abc-defg-hij",
          calendarEmail: "agenda@example.com",
          isActive: true,
        },
      },
    );
  });

  test("empty fields are kept empty while she takes no booking", () => {
    assert.deepEqual(readProfileForm(form({})), {
      ok: true,
      values: { meetUrl: null, calendarEmail: null, isActive: false },
    });
  });

  test("taking bookings needs the Meet and the e-mail, as the database", () => {
    const cases: Record<string, string>[] = [
      { calendar_email: "a@example.com", is_active: "on" },
      { meet_url: "https://meet.google.com/x", is_active: "on" },
    ];
    for (const fields of cases) {
      const read = readProfileForm(form(fields));
      assert.equal(read.ok, false);
      assert.match(read.ok ? "" : read.message, /preencha o link do Meet/);
    }
  });

  test("a link or an e-mail out of shape is said", () => {
    const meet = readProfileForm(form({ meet_url: "http://x.y" }));
    assert.equal(meet.ok, false);
    const email = readProfileForm(form({ calendar_email: "agenda" }));
    assert.deepEqual(email, {
      ok: false,
      message: "Confira o e-mail da agenda.",
    });
  });
});

describe("readWindowForm", () => {
  const window = (fields: Record<string, string>) =>
    readWindowForm(
      form({ weekday: "1", start_time: "09:00", end_time: "12:00", ...fields }),
      50,
    );

  test("a window of a weekday", () => {
    assert.deepEqual(window({}), {
      ok: true,
      values: { weekday: 1, startTime: "09:00", endTime: "12:00" },
    });
  });

  test("24:00 closes the day", () => {
    assert.deepEqual(window({ start_time: "20:00", end_time: "24:00" }), {
      ok: true,
      values: { weekday: 1, startTime: "20:00", endTime: "24:00" },
    });
  });

  test("each rule is said before the database", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ weekday: "7" }, /dia da semana/],
      [{ weekday: "" }, /dia da semana/],
      [{ start_time: "9h" }, /início e o fim/],
      [{ start_time: "24:00" }, /início e o fim/],
      [{ end_time: "25:00" }, /início e o fim/],
      [{ end_time: "09:00" }, /depois do início/],
      [{ end_time: "08:00" }, /depois do início/],
      [{ end_time: "09:40" }, /caber uma aula de 50 min/],
    ];
    for (const [fields, message] of cases) {
      const read = window(fields);
      assert.equal(read.ok, false, JSON.stringify(fields));
      assert.match(read.ok ? "" : read.message, message);
    }
  });

  test("exactly one lesson fits", () => {
    assert.equal(window({ end_time: "09:50" }).ok, true);
  });
});

describe("readTimeOffForm", () => {
  test("whole days, the last one included", () => {
    assert.deepEqual(
      readTimeOffForm(form({ from: "2026-12-24", to: "2026-12-31" })),
      {
        ok: true,
        values: { fromDate: "2026-12-24", untilDate: "2027-01-01" },
      },
    );
  });

  test("one day when the last is left empty", () => {
    assert.deepEqual(readTimeOffForm(form({ from: "2026-11-30" })), {
      ok: true,
      values: { fromDate: "2026-11-30", untilDate: "2026-12-01" },
    });
  });

  test("a day that does not exist, or an end before the start, is said", () => {
    assert.equal(readTimeOffForm(form({ from: "2026-02-30" })).ok, false);
    assert.equal(readTimeOffForm(form({ from: "" })).ok, false);
    assert.deepEqual(
      readTimeOffForm(form({ from: "2026-12-10", to: "2026-12-09" })),
      {
        ok: false,
        message: "O último dia da folga não pode vir antes do primeiro.",
      },
    );
  });
});
