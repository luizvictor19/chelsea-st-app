import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { inviteWarnings, type InviteRow } from "./invite-status.ts";

function row(
  recipient: string,
  status: string,
  last_error: string | null = null,
  method = "request",
): InviteRow {
  return { method, recipient, status, last_error };
}

describe("inviteWarnings", () => {
  test("nothing when the invites went or wait their first turn", () => {
    assert.deepEqual(inviteWarnings([]), []);
    assert.deepEqual(
      inviteWarnings([row("student", "sent"), row("teacher", "pending")]),
      [],
    );
  });

  test("an abandoned request names who did not get it", () => {
    assert.deepEqual(
      inviteWarnings([row("teacher", "abandoned", "no_address")]),
      ["Convite de agenda não enviado ao seu e-mail da agenda."],
    );
    assert.deepEqual(
      inviteWarnings([
        row("student", "abandoned"),
        row("teacher", "abandoned"),
      ]),
      ["Convite de agenda não enviado ao aluno nem ao seu e-mail da agenda."],
    );
  });

  test("a request that failed and waits says the system tries again", () => {
    assert.deepEqual(
      inviteWarnings([
        row("student", "pending", "resend_500_unknown"),
        row("teacher", "abandoned"),
      ]),
      [
        "Convite de agenda não enviado ao seu e-mail da agenda.",
        "Convite de agenda ainda não enviado ao aluno: o sistema tenta de novo.",
      ],
    );
  });

  test("a cancel is not the agenda's concern: the lesson it belongs to is gone from it", () => {
    assert.deepEqual(
      inviteWarnings([row("student", "abandoned", null, "cancel")]),
      [],
    );
  });

  test("an unknown recipient still shows", () => {
    assert.deepEqual(inviteWarnings([row("someone", "abandoned")]), [
      "Convite de agenda não enviado a alguém.",
    ]);
  });
});
