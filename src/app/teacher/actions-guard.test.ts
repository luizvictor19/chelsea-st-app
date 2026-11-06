import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";

import ts from "typescript";

/**
 * Every server action under /teacher checks who calls it before it does
 * anything (#197). RLS refuses what a non-teacher writes, but a Server Action
 * is a public endpoint: the admin of a company without a teacher (0042) must
 * not reach one, and an action added later without the check fails here.
 *
 * An exported function of a "use server" file passes when its body calls
 * requireTeacher, itself or through a function of the same file it calls
 * (the streamed actions hand their work to a generator that checks). Only
 * the invite actions, which /team shares, may call requireInviter instead:
 * it lets the company's admin in. Under content/ only requireContentWriter
 * counts, for the actions and for every page: a teacher only teaches, and
 * content is written by the platform admin alone (0043, #211). Calls are read
 * from the syntax tree, so a name in a comment or a string counts for
 * nothing.
 */

const ROOT = join(import.meta.dirname);
const INVITE_ACTIONS = join("invites", "actions.ts");
const CONTENT = "content";

/** The guards that count for a file, by where it sits under /teacher. */
function guardsFor(where: string): readonly string[] {
  if (where === INVITE_ACTIONS) return ["requireTeacher", "requireInviter"];
  if (where.split(sep)[0] === CONTENT) return ["requireContentWriter"];
  return ["requireTeacher"];
}

/** The exported functions of one file that reach none of the guards given. */
function unguardedActions(source: string, guards: readonly string[]): string[] {
  const file = ts.createSourceFile(
    "actions.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const bodies = new Map<string, ts.Node>();
  const exported = new Set<string>();

  for (const statement of file.statements) {
    const isExported = (
      ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    )?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bodies.set(statement.name.text, statement);
      if (isExported) exported.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          bodies.set(declaration.name.text, init);
          if (isExported) exported.add(declaration.name.text);
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exported.add((element.propertyName ?? element.name).text);
      }
    }
  }

  function calls(node: ts.Node): string[] {
    const names: string[] = [];
    const visit = (child: ts.Node) => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
        names.push(child.expression.text);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return names;
  }

  function reachesGuard(name: string, seen: Set<string>): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const body = bodies.get(name);
    if (!body) return false;
    return calls(body).some(
      (called) =>
        guards.includes(called) ||
        (bodies.has(called) && reachesGuard(called, seen)),
    );
  }

  return [...exported].filter((name) => !reachesGuard(name, new Set()));
}

/** Every page.tsx under dir, at any depth. */
function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

function serverActionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverActionFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) {
      return [];
    }
    const source = readFileSync(path, "utf8");
    return /^\s*["']use server["']/.test(source) ? [path] : [];
  });
}

describe("server actions under /teacher", () => {
  test("the check finds an action with no guard, and follows a helper", () => {
    const source = `"use server";
      export async function open() { return 1; }
      export async function direct() { await requireTeacher(); }
      export const arrow = async () => { await requireInviter(); };
      export async function delegated() { return work(); }
      async function work() { await requireTeacher(); }
      export async function loops() { return a(); }
      function a() { return b(); }
      function b() { return a(); }
      export async function commented() { /* requireTeacher() */ return "requireTeacher()"; }
      async function late() { return 1; }
      export { late };`;
    assert.deepEqual(unguardedActions(source, ["requireTeacher"]), [
      "open",
      "arrow",
      "loops",
      "commented",
      "late",
    ]);
    assert.deepEqual(
      unguardedActions(source, ["requireTeacher", "requireInviter"]),
      ["open", "loops", "commented", "late"],
    );
  });

  test("a content action that only asks for a teacher is unguarded", () => {
    const source = `"use server";
      export async function save() { await requireTeacher(); }
      export async function write() { await requireContentWriter(); }`;
    const guards = guardsFor(join(CONTENT, "images", "actions.ts"));
    assert.deepEqual(unguardedActions(source, guards), ["save"]);
    assert.deepEqual(guardsFor(join("lesson", "actions.ts")), [
      "requireTeacher",
    ]);
  });

  test("there are server actions to check", () => {
    assert.ok(serverActionFiles(ROOT).length >= 8);
  });

  test("every exported action checks its caller", () => {
    const unguarded = serverActionFiles(ROOT).flatMap((path) => {
      const where = relative(ROOT, path);
      return unguardedActions(readFileSync(path, "utf8"), guardsFor(where)).map(
        (name) => `${where}: ${name}`,
      );
    });
    assert.deepEqual(unguarded, []);
  });
});

describe("pages under /teacher/content", () => {
  test("there are content pages to check", () => {
    assert.ok(pageFiles(join(ROOT, CONTENT)).length >= 4);
  });

  test("every content page lets in only whoever writes content", () => {
    const unguarded = pageFiles(join(ROOT, CONTENT)).flatMap((path) =>
      unguardedActions(readFileSync(path, "utf8"), [
        "requireContentWriter",
      ]).map((name) => `${relative(ROOT, path)}: ${name}`),
    );
    assert.deepEqual(unguarded, []);
  });
});
