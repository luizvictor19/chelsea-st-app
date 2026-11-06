import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

import ts from "typescript";

/**
 * Every server action under /teacher checks who calls it before it does
 * anything (#197). RLS refuses what a non-teacher writes, but a Server Action
 * is a public endpoint: the admin of a company without a teacher (0042) must
 * not reach one, and an action added later without the check fails here.
 *
 * An exported function of a "use server" file passes when its body calls
 * requireTeacher( or requireInviter(, itself or through a function of the
 * same file it calls (the streamed actions hand their work to a generator
 * that checks).
 */

const GUARDS = ["requireTeacher(", "requireInviter("];
const ROOT = join(import.meta.dirname);

/** The exported functions of one file that reach no guard. */
function unguardedActions(source: string): string[] {
  const file = ts.createSourceFile(
    "actions.ts",
    source,
    ts.ScriptTarget.Latest,
  );
  const bodies = new Map<string, string>();
  const exported: string[] = [];

  for (const statement of file.statements) {
    const isExported = (
      ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    )?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      bodies.set(statement.name.text, statement.getText(file));
      if (isExported) exported.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          bodies.set(declaration.name.text, init.getText(file));
          if (isExported) exported.push(declaration.name.text);
        }
      }
    }
  }

  function reachesGuard(name: string, seen: Set<string>): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const body = bodies.get(name) ?? "";
    if (GUARDS.some((guard) => body.includes(guard))) return true;
    return [...bodies.keys()].some(
      (other) =>
        other !== name &&
        new RegExp(`\\b${other}\\(`).test(body) &&
        reachesGuard(other, seen),
    );
  }

  return exported.filter((name) => !reachesGuard(name, new Set()));
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
      function b() { return a(); }`;
    assert.deepEqual(unguardedActions(source), ["open", "loops"]);
  });

  test("there are server actions to check", () => {
    assert.ok(serverActionFiles(ROOT).length >= 8);
  });

  test("every exported action checks its caller", () => {
    const unguarded = serverActionFiles(ROOT).flatMap((path) =>
      unguardedActions(readFileSync(path, "utf8")).map(
        (name) => `${relative(ROOT, path)}: ${name}`,
      ),
    );
    assert.deepEqual(unguarded, []);
  });
});
