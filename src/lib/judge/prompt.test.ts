import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  JUDGE_SYSTEM,
  JUDGEMENT_TOOL_DEFINITION,
  TRANSLATION_SYSTEM,
  TRANSLATION_TOOL_DEFINITION,
  promptFingerprint,
  promptFor,
} from "./prompt.ts";

/**
 * The English wording is the one measured on 2026-09-25: the 60 lines of
 * fixtures/stt/judge-results/2026-09-25.jsonl that report-judge.ts reads
 * carry this fingerprint. A change here is a new measurement, not an edit.
 */
const MEASURED_ENGLISH = "594aaf34940b";

describe("the prompts", () => {
  test("English is still the wording measured on 2026-09-25", () => {
    assert.equal(promptFingerprint("en"), MEASURED_ENGLISH);
    assert.equal(promptFingerprint(), MEASURED_ENGLISH);
  });

  test("translation is another measurement", () => {
    assert.notEqual(promptFingerprint("pt"), MEASURED_ENGLISH);
  });

  test("each language gets its own wording and tool", () => {
    assert.deepEqual(promptFor("en"), {
      system: JUDGE_SYSTEM,
      tool: JUDGEMENT_TOOL_DEFINITION,
    });
    assert.deepEqual(promptFor("pt"), {
      system: TRANSLATION_SYSTEM,
      tool: TRANSLATION_TOOL_DEFINITION,
    });
  });

  test("the translation tool has no other language", () => {
    const tool = JSON.stringify(TRANSLATION_TOOL_DEFINITION);
    assert.ok(!tool.includes("other_language"));
    assert.ok(!tool.includes("english"));
    assert.ok(!/In English, please/i.test(TRANSLATION_SYSTEM));
  });

  test("both tools are forced under the same name", () => {
    assert.equal(
      TRANSLATION_TOOL_DEFINITION.function.name,
      JUDGEMENT_TOOL_DEFINITION.function.name,
    );
  });
});
