import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { teacherLinks } from "./nav-links.ts";

describe("teacherLinks", () => {
  test("whoever writes content sees the content screens first", () => {
    assert.deepEqual(
      teacherLinks(true).map(({ label }) => label),
      [
        "Conteúdo",
        "Imagens",
        "Perguntas",
        "Aula ao vivo",
        "Alunos",
        "Convites",
      ],
    );
  });

  test("a teacher sees only what she teaches with, in the same order", () => {
    assert.deepEqual(
      teacherLinks(false).map(({ label }) => label),
      ["Aula ao vivo", "Alunos", "Convites"],
    );
    assert.ok(
      teacherLinks(false).every(
        ({ href }) => !href.startsWith("/teacher/content"),
      ),
    );
  });
});
