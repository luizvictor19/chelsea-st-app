import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acceptRefusal,
  INVITE_DAYS,
  inviteRefusal,
  invitableRoles,
  mailProblem,
  renewedExpiry,
} from "./invites.ts";

describe("invites", () => {
  test("a school's admin and a platform admin invite every role", () => {
    assert.deepEqual(invitableRoles(false, ["admin"]), [
      "student",
      "teacher",
      "admin",
    ]);
    assert.deepEqual(invitableRoles(true, []), ["student", "teacher", "admin"]);
  });

  test("a teacher invites students only, a student no one", () => {
    assert.deepEqual(invitableRoles(false, ["teacher"]), ["student"]);
    assert.deepEqual(invitableRoles(false, ["student"]), []);
    assert.deepEqual(invitableRoles(false, []), []);
  });

  test("admin wins over teacher in the same school", () => {
    assert.deepEqual(invitableRoles(false, ["teacher", "admin"]), [
      "student",
      "teacher",
      "admin",
    ]);
  });

  test("sending again opens the invite for the full period", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    assert.equal(renewedExpiry(now), "2026-11-08T12:00:00.000Z");
    assert.equal(INVITE_DAYS, 15);
  });

  test("each refusal of 0031 has its own sentence", () => {
    assert.match(inviteRefusal({ code: "23505" }), /Reenviar/);
    assert.match(
      inviteRefusal({
        code: "23514",
        message:
          'new row for relation "school_invites" violates check constraint "school_invites_email_check"',
      }),
      /e-mail válido/,
    );
    assert.match(inviteRefusal({ code: "42501" }), /não pode convidar/);
  });

  test("an unknown failure is not dressed as one of the rules", () => {
    assert.match(
      inviteRefusal({ code: "23514", message: "some other check" }),
      /Não foi possível/,
    );
    assert.match(inviteRefusal({}), /Não foi possível/);
  });

  test("writing an invite never says the person studies elsewhere (0032)", () => {
    assert.doesNotMatch(
      inviteRefusal({
        code: "23514",
        message: "this person already studies at another school",
      }),
      /outra escola/,
    );
  });
});

describe("mailProblem", () => {
  test("an account that already exists reads like any email sent", () => {
    // inviteUserByEmail refuses a confirmed account with email_exists: she sees
    // the invite when she signs in, and the inviter is told nothing more.
    assert.equal(mailProblem(undefined), null);
    assert.equal(mailProblem("email_exists"), null);
  });

  test("a mail that did not go out says so", () => {
    assert.match(mailProblem("over_email_send_rate_limit") ?? "", /limite/);
    assert.match(mailProblem("unexpected_failure") ?? "", /não saiu/);
  });
});

describe("acceptRefusal", () => {
  test("each refusal of accept_my_school_invite has its own sentence", () => {
    assert.match(
      acceptRefusal({
        code: "23514",
        message: "invite 1 is not open for this account",
      }),
      /venceu ou já foi usado/,
    );
    assert.match(
      acceptRefusal({
        code: "23514",
        message: "this person already studies at another school",
      }),
      /já estuda em outra escola/,
    );
  });

  test("an unknown failure is not dressed as one of the rules", () => {
    assert.match(acceptRefusal({ code: "23514" }), /Não foi possível/);
    assert.match(acceptRefusal({}), /Não foi possível/);
  });
});
