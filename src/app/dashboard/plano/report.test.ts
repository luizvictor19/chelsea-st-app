import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import ts from "typescript";

/**
 * The three steps of /dashboard/plano that reach the payment (subscribe, the
 * Pix, cancel) catch their failure and answer "Tente de novo": each also
 * hands it to the error log (#69), through planFailure with its own step.
 * Read from the syntax tree, so a name in a comment counts for nothing.
 */

const SOURCE = readFileSync(join(import.meta.dirname, "actions.ts"), "utf8");

/** The step named by each planFailure call inside each exported function. */
function stepsByFunction(): Map<string, string[]> {
  const file = ts.createSourceFile(
    "actions.ts",
    SOURCE,
    ts.ScriptTarget.Latest,
    true,
  );
  const found = new Map<string, string[]>();
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined)
      continue;
    const steps: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "planFailure" &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        steps.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
    found.set(statement.name.text, steps);
  }
  return found;
}

describe("the plan's failures reach the error log", () => {
  const steps = stepsByFunction();

  for (const [action, step] of [
    ["subscribe", "subscribe"],
    ["showPix", "pix"],
    ["cancel", "cancel"],
  ] as const) {
    test(`${action} reports its failure as ${step}`, () => {
      assert.deepEqual(steps.get(action), [step]);
    });
  }

  test("the reports go after the answer, through reportError", () => {
    assert.equal(
      SOURCE.match(/after\(\(\) => reportError\(planFailure\(/g)?.length,
      3,
    );
  });
});
