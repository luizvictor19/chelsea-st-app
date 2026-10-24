import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { destinationFor, studies, teaches, type Access } from "./access.ts";

const nobody: Access = { platformAdmin: false, roles: [] };
const student: Access = { platformAdmin: false, roles: ["student"] };
const teacher: Access = { platformAdmin: false, roles: ["teacher"] };
const admin: Access = { platformAdmin: false, roles: ["admin"] };
// Luiz after 0029: above every school, admin of Chelsea St and its student.
const luiz: Access = { platformAdmin: true, roles: ["admin", "student"] };
const platformOnly: Access = { platformAdmin: true, roles: [] };

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
