import assert from "node:assert/strict";
import { test } from "node:test";

import { taught } from "./taught.ts";

/*
 * The platform admin reads every row of students (RLS), and an employee of a
 * company is a row of students too, in an organization without a teacher
 * (0042). The agenda of the students lists only those someone teaches (#362).
 */
test("keeps the students of an organization with a teacher, drops an employee's", () => {
  const rows = [
    { id: "aluno", organizations: { has_teacher: true } },
    { id: "funcionario", organizations: { has_teacher: false } },
  ];
  assert.deepEqual(
    taught(rows).map((row) => row.id),
    ["aluno"],
  );
});
