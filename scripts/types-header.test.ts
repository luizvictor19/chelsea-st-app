import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The header of src/lib/supabase/types.ts exists twice: once in the file, and
 * once in the heredoc of scripts/gen-types.sh that writes it there.
 *
 * It has to, because the generator replaces the whole file and the script is
 * what puts the comment back. That makes the file's copy an output, and an
 * output edited by hand is reverted by the next run without a word. This
 * holds the two to being the same text, so an edit in the wrong one is a
 * failing test now rather than a silent revert later.
 */
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "gen-types.sh");
const TYPES = join(ROOT, "src", "lib", "supabase", "types.ts");

/** The heredoc the script prepends, between its opener and its terminator. */
function headerInScript(): string {
  const script = readFileSync(SCRIPT, "utf8");
  const match = /^ *cat <<'TYPES_HEADER'\n([\s\S]*?)^TYPES_HEADER$/m.exec(
    script,
  );
  assert.ok(match !== null, "no TYPES_HEADER heredoc in scripts/gen-types.sh");
  return match[1].trimEnd();
}

/** The block comment the generated file opens with. */
function headerInTypes(): string {
  const types = readFileSync(TYPES, "utf8");
  const end = types.indexOf("*/");
  assert.ok(end !== -1, "src/lib/supabase/types.ts opens with no comment");
  assert.ok(
    types.startsWith("/**"),
    "src/lib/supabase/types.ts does not open with the header",
  );
  return types.slice(0, end + 2);
}

describe("the types header", () => {
  test("is the same text in the file and in the script that writes it", () => {
    assert.equal(headerInTypes(), headerInScript());
  });

  /*
   * Named rather than described, because the whole point of the rewrite was
   * to stop the header repeating a command someone would run on its own. A
   * header that went back to spelling the command out would pass the equality
   * test above while undoing the reason for it.
   */
  test("sends the reader to the script and not to a command to retype", () => {
    const header = headerInTypes();
    assert.match(header, /scripts\/gen-types\.sh/u);
    assert.doesNotMatch(header, /supabase gen types/u);
  });

  /*
   * The two facts the header carries that nothing else in the repository
   * says: where the schema comes from, and why not from the deployed project.
   */
  test("still says where the schema comes from, and why not from the project", () => {
    const header = headerInTypes();
    assert.match(header, /supabase\/migrations/u);
    assert.match(header, /pgcrypto/u);
  });
});
