import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  lessonsCovered,
  lessonsLabel,
  proposalItem,
  type ProposalRow,
} from "./view.ts";

const SP = "America/Sao_Paulo";

const FROM_TEACHER: ProposalRow = {
  proposal_id: "p-1",
  my_side: "student",
  proposed_by: "teacher",
  status: "open",
  teacher_id: "t-1",
  teacher_name: "Luiz Professor",
  student_id: "s-1",
  student_name: "Ana Aluna",
  expires_at: "2026-11-16T21:00:00Z",
  // Monday and Wednesday, 19:00 in São Paulo.
  starts_at: ["2026-11-16T22:00:00Z", "2026-11-18T22:00:00Z"],
  duration_minutes: 50,
  lesson_credits: 4,
};

const options = { zone: SP, balance: 20, timeOff: [] };

describe("proposalItem", () => {
  test("the student reads her teacher's open proposal, with the cost and her balance after", () => {
    const item = proposalItem(FROM_TEACHER, options);
    assert.equal(item.title, "Proposta de Luiz Professor");
    assert.deepEqual(item.lessons, [
      "segunda-feira, 16 de novembro, 19:00",
      "quarta-feira, 18 de novembro, 19:00",
    ]);
    assert.equal(
      item.status,
      "Aberta até segunda-feira, 16 de novembro, 18:00",
    );
    assert.equal(item.canAnswer, true);
    assert.equal(item.canWithdraw, false);
    assert.equal(item.cost, "2 aulas × 4 créditos = 8 créditos");
    assert.equal(
      item.balanceNote,
      "Seu saldo: 20 créditos. Depois do aceite: 12 créditos.",
    );
    assert.equal(item.short, false);
  });

  test("a balance short of the whole series says how many it covers", () => {
    const item = proposalItem(FROM_TEACHER, { ...options, balance: 5 });
    assert.equal(item.short, true);
    assert.match(item.balanceNote ?? "", /cobre 1 de 2 aulas/);
  });

  test("not on sale: no cost and no note", () => {
    const item = proposalItem(
      { ...FROM_TEACHER, lesson_credits: null },
      options,
    );
    assert.equal(item.cost, null);
    assert.equal(item.balanceNote, null);
    assert.equal(item.short, false);
  });

  test("the proposer withdraws her own open proposal and does not answer it", () => {
    const item = proposalItem(
      { ...FROM_TEACHER, my_side: "teacher" },
      { zone: SP, balance: null, timeOff: [] },
    );
    assert.equal(item.title, "Sua proposta para Ana Aluna");
    assert.equal(item.canAnswer, false);
    assert.equal(item.canWithdraw, true);
    assert.equal(item.balanceNote, null);
  });

  test("a closed proposal says its state and offers nothing", () => {
    for (const [status, label] of [
      ["accepted", "Aceita"],
      ["declined", "Recusada"],
      ["withdrawn", "Retirada"],
      ["expired", "Vencida"],
      ["other", "other"],
    ]) {
      const item = proposalItem({ ...FROM_TEACHER, status }, options);
      assert.equal(item.status, label);
      assert.equal(item.canAnswer, false);
      assert.equal(item.canWithdraw, false);
    }
  });

  test("the teacher is told when a lesson of the student's proposal falls in a time off", () => {
    const row: ProposalRow = {
      ...FROM_TEACHER,
      my_side: "teacher",
      proposed_by: "student",
      duration_minutes: null,
    };
    const off = {
      startsAt: "2026-11-18T03:00:00Z",
      endsAt: "2026-11-19T03:00:00Z",
    };
    const inside = proposalItem(row, {
      zone: SP,
      balance: null,
      timeOff: [off],
    });
    assert.deepEqual(inside.warnings, ["Uma das aulas cai numa folga sua."]);
    assert.equal(inside.canAnswer, true);
    const outside = proposalItem(row, {
      zone: SP,
      balance: null,
      timeOff: [
        { startsAt: "2026-11-20T03:00:00Z", endsAt: "2026-11-21T03:00:00Z" },
      ],
    });
    assert.deepEqual(outside.warnings, []);
    const closed = proposalItem(
      { ...row, status: "declined" },
      { zone: SP, balance: null, timeOff: [off] },
    );
    assert.deepEqual(closed.warnings, []);
  });
});

describe("lessonsLabel and lessonsCovered", () => {
  test("say and count lessons", () => {
    assert.equal(lessonsLabel(1), "1 aula");
    assert.equal(lessonsLabel(3), "3 aulas");
    assert.equal(lessonsCovered(9, 4, 3), 2);
    assert.equal(lessonsCovered(100, 4, 3), 3);
    assert.equal(lessonsCovered(-1, 4, 3), 0);
    assert.equal(lessonsCovered(0, 0, 3), 3);
  });
});
