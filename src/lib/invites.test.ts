import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acceptRefusal,
  INVITE_DAYS,
  invitedAs,
  inviteRefusal,
  invitableRoles,
  mailProblem,
  renewedExpiry,
  roleLabel,
} from "./invites.ts";

describe("invites", () => {
  test("an organization's admin and a platform admin invite every role", () => {
    assert.deepEqual(invitableRoles(false, ["admin"], true), [
      "student",
      "teacher",
      "admin",
    ]);
    assert.deepEqual(invitableRoles(true, [], true), [
      "student",
      "teacher",
      "admin",
    ]);
  });

  test("a teacher invites students only, a student no one", () => {
    assert.deepEqual(invitableRoles(false, ["teacher"], true), ["student"]);
    assert.deepEqual(invitableRoles(false, ["student"], true), []);
    assert.deepEqual(invitableRoles(false, [], true), []);
  });

  test("admin wins over teacher in the same organization", () => {
    assert.deepEqual(invitableRoles(false, ["teacher", "admin"], true), [
      "student",
      "teacher",
      "admin",
    ]);
  });

  test("without a teacher, nobody is invited as one (0042)", () => {
    assert.deepEqual(invitableRoles(false, ["admin"], false), [
      "student",
      "admin",
    ]);
    assert.deepEqual(invitableRoles(true, [], false), ["student", "admin"]);
    assert.deepEqual(invitableRoles(false, ["student"], false), []);
  });

  test("a role is named for the kind of organization", () => {
    assert.equal(roleLabel("student", true), "Aluna");
    assert.equal(roleLabel("teacher", true), "Professor");
    assert.equal(roleLabel("admin", true), "Admin da escola");
    assert.equal(roleLabel("student", false), "Funcionário");
    assert.equal(roleLabel("admin", false), "Admin da empresa");
  });

  test("an open invite names the role as its organization does (#213)", () => {
    const company = { has_teacher: false } as const;
    const school = { has_teacher: true } as const;
    assert.equal(invitedAs({ ...company, role: "student" }), "Funcionário");
    assert.equal(invitedAs({ ...company, role: "admin" }), "Admin da empresa");
    assert.equal(invitedAs({ ...school, role: "student" }), "Aluna");
    assert.equal(invitedAs({ ...school, role: "teacher" }), "Professor");
    assert.equal(invitedAs({ ...school, role: "admin" }), "Admin da escola");
  });

  test("an invite read from a database before 0046 keeps the school's names", () => {
    assert.equal(
      invitedAs({ role: "student", has_teacher: undefined }),
      "Aluna",
    );
    assert.equal(
      invitedAs({ role: "admin", has_teacher: null }),
      "Admin da escola",
    );
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
          'new row for relation "organization_invites" violates check constraint "organization_invites_email_check"',
      }),
      /e-mail válido/,
    );
    assert.match(inviteRefusal({ code: "42501" }), /não pode convidar/);
  });

  test("a teacher invite where there is no teacher has its own sentence (0042)", () => {
    assert.match(
      inviteRefusal({
        code: "23514",
        message:
          "organization 1 has no teacher (teacher_needs_a_teaching_organization)",
      }),
      /não tem professor/,
    );
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
        message: "this person already studies at another organization",
      }),
      /outra escola/,
    );
  });
});

describe("mailProblem", () => {
  test("an account that already exists reads like any email sent", () => {
    // inviteUserByEmail refuses a confirmed account with email_exists: she sees
    // the invite when she signs in, and the inviter is told nothing more.
    assert.equal(mailProblem(null), null);
    assert.equal(mailProblem({ code: "email_exists" }), null);
  });

  test("a mail that did not go out says so", () => {
    assert.match(
      mailProblem({ code: "over_email_send_rate_limit" }) ?? "",
      /limite/,
    );
    assert.match(mailProblem({ code: "unexpected_failure" }) ?? "", /não saiu/);
    // A network failure comes with no code at all, and it is not a success.
    assert.match(mailProblem({}) ?? "", /não saiu/);
  });
});

describe("acceptRefusal", () => {
  test("each refusal of accept_my_organization_invite has its own sentence", () => {
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
        message: "this person already studies at another organization",
      }),
      /já estuda em outra escola/,
    );
  });

  test("an unknown failure is not dressed as one of the rules", () => {
    assert.match(acceptRefusal({ code: "23514" }), /Não foi possível/);
    assert.match(acceptRefusal({}), /Não foi possível/);
  });
});
