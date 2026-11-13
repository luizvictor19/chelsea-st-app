import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { activeHref, teacherLinks, teacherSections } from "./nav-links.ts";

const labels = (platformAdmin: boolean) =>
  teacherLinks(platformAdmin).map(({ label }) => label);

describe("teacherLinks", () => {
  test("the platform admin sees content first and the platform last", () => {
    assert.deepEqual(labels(true), [
      "Início",
      "Conteúdo",
      "Imagens",
      "Perguntas",
      "Aula ao vivo",
      "Agenda",
      "Alunos",
      "Convites",
      "Aulas",
      "Planos e custos",
      "Organizações",
    ]);
  });

  test("a teacher sees only what she teaches with, in the same order", () => {
    assert.deepEqual(labels(false), [
      "Início",
      "Aula ao vivo",
      "Agenda",
      "Alunos",
      "Convites",
      "Aulas",
    ]);
  });

  test("content, plans and organizations never reach a teacher", () => {
    for (const { href } of teacherLinks(false)) {
      assert.ok(href === null || !href.startsWith("/teacher/content"));
      assert.notEqual(href, "/teacher/plans");
      assert.notEqual(href, "/teacher/organizations");
    }
    const admin = teacherLinks(true).map(({ href }) => href);
    assert.ok(admin.includes("/teacher/plans"));
    assert.ok(admin.includes("/teacher/organizations"));
  });

  test("Aulas is the one item with no screen", () => {
    for (const platformAdmin of [true, false]) {
      assert.deepEqual(
        teacherLinks(platformAdmin)
          .filter(({ href }) => href === null)
          .map(({ label }) => label),
        ["Aulas"],
      );
    }
  });

  test("no two items share an href or an icon", () => {
    const links = teacherLinks(true);
    const hrefs = links.flatMap(({ href }) => (href === null ? [] : [href]));
    assert.equal(new Set(hrefs).size, hrefs.length);
    assert.equal(new Set(links.map(({ icon }) => icon)).size, links.length);
  });

  test("the sections are the flat list, cut in groups", () => {
    for (const platformAdmin of [true, false]) {
      assert.deepEqual(
        teacherSections(platformAdmin).flat(),
        teacherLinks(platformAdmin),
      );
    }
    assert.equal(teacherSections(true).length, 4);
    assert.equal(teacherSections(false).length, 2);
  });
});

describe("activeHref", () => {
  const links = teacherLinks(true);

  test("the longest matching href wins", () => {
    assert.equal(
      activeHref(links, "/teacher/content/images"),
      "/teacher/content/images",
    );
    assert.equal(
      activeHref(links, "/teacher/content/questions/12"),
      "/teacher/content/questions",
    );
    assert.equal(activeHref(links, "/teacher/content/3"), "/teacher/content");
    assert.equal(
      activeHref(links, "/teacher/students/abc"),
      "/teacher/students",
    );
  });

  test("Início lights only on /teacher itself", () => {
    assert.equal(activeHref(links, "/teacher"), "/teacher");
    assert.equal(activeHref(links, "/teacher/audio-test"), null);
    assert.equal(activeHref(links, "/teacher/session-preview"), null);
  });

  test("a prefix of a word is not a match", () => {
    assert.equal(activeHref(links, "/teacher/lessons"), null);
  });

  test("a teacher's menu lights nothing on a screen it does not list", () => {
    assert.equal(activeHref(teacherLinks(false), "/teacher/plans"), null);
  });
});
