import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  destinationFor,
  manages,
  practicesOnly,
  studies,
  teaches,
  type Access,
  type OrganizationRole,
} from "./access.ts";

// An organization with a teacher (Chelsea St) and one without (a company on
// GrifoAI, 0042).
const school = (role: OrganizationRole) => ({ role, hasTeacher: true });
const company = (role: OrganizationRole) => ({ role, hasTeacher: false });

const nobody: Access = { platformAdmin: false, memberships: [] };
const student: Access = {
  platformAdmin: false,
  memberships: [school("student")],
};
const teacher: Access = {
  platformAdmin: false,
  memberships: [school("teacher")],
};
const admin: Access = { platformAdmin: false, memberships: [school("admin")] };
// Luiz after 0029: above every organization, admin of Chelsea St and its student.
const luiz: Access = {
  platformAdmin: true,
  memberships: [school("admin"), school("student")],
};
const platformOnly: Access = { platformAdmin: true, memberships: [] };
const companyAdmin: Access = {
  platformAdmin: false,
  memberships: [company("admin")],
};
const employee: Access = {
  platformAdmin: false,
  memberships: [company("student")],
};
const companyAdminAndEmployee: Access = {
  platformAdmin: false,
  memberships: [company("admin"), company("student")],
};

describe("access", () => {
  test("admins, teachers and platform admins teach; students do not", () => {
    assert.equal(teaches(teacher), true);
    assert.equal(teaches(admin), true);
    assert.equal(teaches(platformOnly), true);
    assert.equal(teaches(student), false);
    assert.equal(teaches(nobody), false);
  });

  test("only a student role studies, even for a platform admin", () => {
    assert.equal(studies(student), true);
    assert.equal(studies(luiz), true);
    assert.equal(studies(platformOnly), false);
    assert.equal(studies(admin), false);
  });

  test("teaching wins where someone lands", () => {
    assert.equal(destinationFor(luiz), "/teacher");
    assert.equal(destinationFor(teacher), "/teacher");
    assert.equal(destinationFor(student), "/dashboard");
  });

  test("no role lands on the dashboard, which says the account is pending", () => {
    assert.equal(destinationFor(nobody), "/dashboard");
  });
});

describe("an organization without a teacher (0042)", () => {
  test("its admin does not teach, manages it and lands on /team", () => {
    assert.equal(teaches(companyAdmin), false);
    assert.equal(manages(companyAdmin), true);
    assert.equal(destinationFor(companyAdmin), "/team");
  });

  test("where there is a teacher, nobody manages apart from teaching", () => {
    assert.equal(manages(admin), false);
    assert.equal(manages(teacher), false);
    assert.equal(manages(luiz), false);
  });

  test("its employee lands on /dashboard and only practises", () => {
    assert.equal(teaches(employee), false);
    assert.equal(studies(employee), true);
    assert.equal(practicesOnly(employee), true);
    assert.equal(destinationFor(employee), "/dashboard");
  });

  test("a student of an organization with a teacher has lessons", () => {
    assert.equal(practicesOnly(student), false);
    assert.equal(practicesOnly(luiz), false);
    assert.equal(practicesOnly(nobody), false);
    assert.equal(practicesOnly(companyAdmin), false);
  });

  test("a platform admin teaches even as admin of a company", () => {
    const both: Access = {
      platformAdmin: true,
      memberships: [company("admin")],
    };
    assert.equal(teaches(both), true);
    assert.equal(destinationFor(both), "/teacher");
  });

  test("a company admin who is also its employee lands on /team", () => {
    assert.equal(destinationFor(companyAdminAndEmployee), "/team");
    assert.equal(practicesOnly(companyAdminAndEmployee), true);
  });

  test("an admin of Chelsea who also runs a company still teaches", () => {
    const both: Access = {
      platformAdmin: false,
      memberships: [school("admin"), company("admin")],
    };
    assert.equal(teaches(both), true);
    assert.equal(manages(both), true);
    assert.equal(destinationFor(both), "/teacher");
  });
});
