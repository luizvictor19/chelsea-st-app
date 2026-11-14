import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PlanFields } from "./plan-form.tsx";
import { planSummary } from "./summary.ts";

const FOUNDER: PlanFields = {
  id: "p1",
  brand: "chelsea-st",
  key: "fundador",
  name: "Plano Fundador",
  position: 0,
  monthlyPrice: "297,00",
  annualPrice: "",
  monthlyCredits: 520,
  trailMinutesPerDay: 0,
  opensVoiceQuestion: false,
  opensFreeConversation: false,
  opensVideo: false,
  trialDays: 0,
  trialCredits: 0,
  creditCeilingMonths: 3,
  creditDaysAfterCancel: 90,
  teacherLessonCredits: 65,
  audience: "founder",
  isActive: true,
};

describe("planSummary", () => {
  test("a founder plan: who sees it, monthly only, credits, its lesson, no trail, on sale", () => {
    assert.deepEqual(planSummary(FOUNDER), {
      title: "Plano Fundador",
      parts: [
        "Só fundadores",
        "R$ 297,00 por mês, só mensal",
        "520 créditos por mês",
        "aula: 65 créditos",
        "sem trilha",
        "à venda",
      ],
    });
  });

  test("a public plan with both prices, the brand's lesson, a trail, a trial, off sale", () => {
    const plan: PlanFields = {
      ...FOUNDER,
      name: "Fluência",
      audience: "public",
      monthlyPrice: "167,00",
      annualPrice: "1837,00",
      monthlyCredits: 250,
      teacherLessonCredits: null,
      trailMinutesPerDay: 30,
      trialDays: 14,
      isActive: false,
    };
    assert.deepEqual(planSummary(plan).parts, [
      "Todos",
      "R$ 167,00 por mês ou R$ 1837,00 por ano",
      "250 créditos por mês",
      "aula: custo da marca",
      "30 min de trilha por dia",
      "14 dias de teste",
      "fora de venda",
    ]);
  });

  test("one credit, one lesson credit and the GrifoAI brand say so", () => {
    const plan: PlanFields = {
      ...FOUNDER,
      brand: "grifoai",
      audience: "public",
      monthlyCredits: 1,
      teacherLessonCredits: 1,
    };
    const parts = planSummary(plan).parts;
    assert.equal(parts[0], "Todos · grifoai");
    assert.ok(parts.includes("1 crédito por mês"));
    assert.ok(parts.includes("aula: 1 crédito"));
  });
});
