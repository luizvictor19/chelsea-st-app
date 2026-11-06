import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  adminCount,
  COMPANY,
  createdButNotInvited,
  createdButNotMailed,
  organizationRefusal,
  readCompanyForm,
  SLUG,
  slugFromName,
} from "./organizations.ts";

const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);

/** Every migration's text, in the order they apply. */
function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS, file), "utf8"),
    }));
}

describe("a company's organization", () => {
  test("wears GrifoAI and has no teacher", () => {
    assert.deepEqual(COMPANY, { brand: "grifoai", hasTeacher: false });
  });

  test("the slug comes from the name: no accent, lower case, hyphens", () => {
    assert.equal(slugFromName("Padaria São João"), "padaria-sao-joao");
    assert.equal(slugFromName("  Açougue   do Zé  "), "acougue-do-ze");
    assert.equal(slugFromName("ACME & Filhos Ltda."), "acme-filhos-ltda");
    assert.equal(slugFromName("--Loja 24h--"), "loja-24h");
    assert.equal(slugFromName("Ünïcödé"), "unicode");
    assert.equal(slugFromName(""), "");
    assert.equal(slugFromName("!!!"), "");
  });

  test("every slug made from a name is one the database accepts, or empty", () => {
    for (const name of [
      "Padaria São João",
      "ACME & Filhos Ltda.",
      " - a - ",
      "Ação",
      "x",
      "123",
    ]) {
      const slug = slugFromName(name);
      assert.ok(slug === "" || SLUG.test(slug), `${name} gave ${slug}`);
    }
  });

  test("SLUG is the check organizations_slug_check holds", () => {
    // 0029 wrote it inline on schools.slug, 0040 renamed it. The latest
    // definition across the migrations is the one the database holds.
    const defined = migrations().flatMap(({ sql }) =>
      [...sql.matchAll(/check\s*\(\s*slug\s*~\s*'([^']*)'\s*\)/gi)].map(
        (match) => match[1],
      ),
    );
    assert.ok(defined.length > 0, "no slug check found in the migrations");
    assert.equal(SLUG.source, defined[defined.length - 1]);
  });

  test("no migration drops or rewrites the slug check in another form", () => {
    const touched = migrations()
      .filter(({ sql }) =>
        /drop constraint\s+(if exists\s+)?\w*slug_check/i.test(sql),
      )
      .map(({ file }) => file);
    assert.deepEqual(touched, []);
  });

  test("the form is read whole before anything is written", () => {
    assert.deepEqual(
      readCompanyForm({
        name: "  Padaria São João ",
        slug: " padaria-sao-joao ",
        email: " Dona@Padaria.com ",
      }),
      {
        ok: true,
        company: {
          name: "Padaria São João",
          slug: "padaria-sao-joao",
          email: "dona@padaria.com",
        },
      },
    );
  });

  test("the first problem of the form is the one said", () => {
    assert.deepEqual(readCompanyForm({ name: "  ", slug: "x-", email: "no" }), {
      ok: false,
      message: "Digite o nome da empresa.",
    });
    assert.deepEqual(
      readCompanyForm({ name: "Padaria", slug: "", email: "no" }),
      {
        ok: false,
        message:
          "O endereço usa só letras minúsculas sem acento, números e hífens entre eles.",
      },
    );
    for (const slug of [
      "Padaria",
      "padaria-",
      "-padaria",
      "pa--daria",
      "são",
    ]) {
      assert.equal(
        readCompanyForm({ name: "Padaria", slug, email: "a@b.co" }).ok,
        false,
        slug,
      );
    }
    assert.deepEqual(
      readCompanyForm({ name: "Padaria", slug: "padaria", email: "dona" }),
      { ok: false, message: "Digite o e-mail do primeiro admin." },
    );
  });

  test("a field missing from the form reads as empty", () => {
    assert.deepEqual(readCompanyForm({ name: null, slug: null, email: null }), {
      ok: false,
      message: "Digite o nome da empresa.",
    });
  });

  test("each refusal of the database is said by its constraint", () => {
    assert.equal(
      organizationRefusal({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "organizations_slug_key"',
      }),
      "Já existe uma organização com esse endereço. Escolha outro.",
    );
    assert.equal(
      organizationRefusal({
        code: "23514",
        message:
          'new row for relation "organizations" violates check constraint "organizations_slug_check"',
      }),
      "O endereço usa só letras minúsculas sem acento, números e hífens entre eles.",
    );
    assert.equal(
      organizationRefusal({
        code: "23514",
        message:
          'new row for relation "organizations" violates check constraint "organizations_name_check"',
      }),
      "Digite o nome da empresa.",
    );
    assert.equal(
      organizationRefusal({
        code: "42501",
        message:
          'new row violates row-level security policy for table "organizations"',
      }),
      "Só o administrador da plataforma cria organizações.",
    );
  });

  test("anything else is a generic failure, never one of those", () => {
    const generic =
      "Não foi possível criar a empresa agora. Tente de novo em alguns instantes.";
    assert.equal(organizationRefusal({}), generic);
    assert.equal(
      organizationRefusal({ code: "23505", message: "another_key" }),
      generic,
    );
    assert.equal(
      organizationRefusal({
        code: "23514",
        message: "organizations_brand_known",
      }),
      generic,
    );
  });

  test("a failure after the creation says the company exists", () => {
    assert.equal(
      createdButNotInvited("Digite um e-mail válido."),
      "A empresa foi criada, mas o convite não foi gravado. Digite um e-mail válido. Convide o admin em Convites.",
    );
    assert.equal(
      createdButNotMailed(
        "O convite foi gravado, mas o e-mail não saiu. Use Reenviar daqui a alguns minutos.",
      ),
      "A empresa foi criada. O convite foi gravado, mas o e-mail não saiu. Use Reenviar daqui a alguns minutos. Reenviar fica em Convites.",
    );
  });

  test("an organization's admins: members, and admin invites still open", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const open = { accepted_at: null, expires_at: "2026-11-20T12:00:00Z" };
    assert.deepEqual(
      adminCount(
        [{ role: "admin" }, { role: "student" }, { role: "admin" }],
        [
          { role: "admin", ...open },
          { role: "student", ...open },
          {
            role: "admin",
            accepted_at: "2026-11-05T12:00:00Z",
            expires_at: "2026-11-20T12:00:00Z",
          },
          {
            role: "admin",
            accepted_at: null,
            expires_at: "2026-11-06T12:00:00Z",
          },
        ],
        now,
      ),
      { admins: 2, openAdminInvites: 1 },
    );
    assert.deepEqual(adminCount([], [], now), {
      admins: 0,
      openAdminInvites: 0,
    });
  });
});
