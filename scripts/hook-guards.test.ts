import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

/**
 * .claude/hooks/guard-main.sh is the only thing that says "never on main" and
 * "only from an issue worktree": the deny list in settings.json blocks or
 * allows a command whole. Since #324 the Claude merges origin/main into issue
 * branches and applies migrations, so a hook that lets the wrong command
 * through reaches main or the production database.
 *
 * Each case runs the script as Claude Code does, with the hook input on
 * stdin (tool_input.command and cwd), against throwaway repositories: a main
 * folder on main, a linked worktree on an issue branch, and a folder outside
 * any repository.
 */
const HOOK = join(
  import.meta.dirname,
  "..",
  ".claude",
  "hooks",
  "guard-main.sh",
);

let root = "";
let app = "";
let worktree = "";
let plain = "";

/** Git with no user or system config, so the machine's settings never leak in. */
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd, env: gitEnv, stdio: "ignore" },
  );
}

/** What the hook decides for one Bash call: "deny", or "allow" when it prints nothing. */
function decide(command: string, cwd: string): "deny" | "allow" {
  const run = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: "utf8",
    // The folder outside any repository stays outside, wherever tmpdir is.
    env: { ...gitEnv, GIT_CEILING_DIRECTORIES: root },
  });
  assert.equal(run.status, 0, run.stderr);
  if (run.stdout.trim() === "") return "allow";
  const out = JSON.parse(run.stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  return "deny";
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "hook-guards-"));
  app = join(root, "chelsea-st-app");
  worktree = join(root, "chelsea-st-app-324");
  plain = join(root, "plain");
  mkdirSync(app);
  mkdirSync(plain);
  git(app, "init", "-q", "-b", "main");
  git(app, "commit", "-q", "--allow-empty", "-m", "init");
  git(app, "worktree", "add", "-q", worktree, "-b", "chore/324-workflow");
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("git commit", () => {
  test("is denied on main", () => {
    assert.equal(decide('git commit -m "x"', app), "deny");
    assert.equal(decide("git add . && git commit -m x", app), "deny");
  });

  test("is denied when -C points at main, whatever the session folder", () => {
    assert.equal(decide(`git -C ${app} commit -m x`, worktree), "deny");
  });

  test("goes through on an issue branch", () => {
    assert.equal(decide('git commit -m "x"', worktree), "allow");
    assert.equal(decide(`git -C ${worktree} commit -m x`, app), "allow");
  });
});

describe("git push", () => {
  test("is denied when it targets main", () => {
    assert.equal(decide("git push origin main", worktree), "deny");
    assert.equal(decide("git push origin HEAD:main", worktree), "deny");
  });

  test("is denied from main", () => {
    assert.equal(decide("git push", app), "deny");
  });

  test("is denied when forced, in every spelling", () => {
    for (const command of [
      "git push --force origin chore/324-workflow",
      "git push -f origin chore/324-workflow",
      "git push -uf origin chore/324-workflow",
      "git push --force-with-lease",
      "git push origin +chore/324-workflow",
    ]) {
      assert.equal(decide(command, worktree), "deny", command);
    }
  });

  test("goes through for the issue branch", () => {
    assert.equal(
      decide("git push -u origin chore/324-workflow", worktree),
      "allow",
    );
  });
});

describe("git merge", () => {
  test("is denied on main, even of origin/main", () => {
    assert.equal(decide("git merge origin/main", app), "deny");
    assert.equal(decide(`git -C ${app} merge origin/main`, worktree), "deny");
  });

  test("is denied for anything but origin/main", () => {
    for (const command of [
      `git -C ${worktree} merge feat/other`,
      `git -C ${worktree} merge main`,
      `git -C ${worktree} merge origin/feat/other`,
      `git -C ${worktree} merge origin/main feat/other`,
      `git -C ${worktree} merge --squash origin/main`,
      `git -C ${worktree} merge -X theirs origin/main`,
      `git -C ${worktree} merge`,
    ]) {
      assert.equal(decide(command, app), "deny", command);
    }
  });

  test("goes through for origin/main on an issue branch", () => {
    for (const command of [
      `git -C ${worktree} merge origin/main`,
      `git -C ${worktree} merge --no-edit origin/main`,
      `git -C ${worktree} merge --no-ff -m "chore: bring main (#324)" origin/main`,
      `git -C ${worktree} merge --abort`,
      `git -C ${worktree} fetch origin && git -C ${worktree} merge --no-edit origin/main`,
    ]) {
      assert.equal(decide(command, app), "allow", command);
    }
    assert.equal(decide("git merge origin/main", worktree), "allow");
  });
});

describe("supabase db push", () => {
  test("is denied from the main folder", () => {
    for (const command of [
      "supabase db push",
      "supabase db push --dry-run",
      "npx supabase db push",
      "supabase --debug db push",
    ]) {
      assert.equal(decide(command, app), "deny", command);
    }
    assert.equal(decide(`cd ${app} && supabase db push`, worktree), "deny");
    assert.equal(decide(`supabase --workdir ${app} db push`, worktree), "deny");
  });

  test("is denied from a folder outside any repository", () => {
    assert.equal(decide("supabase db push", plain), "deny");
  });

  test("goes through from an issue worktree", () => {
    assert.equal(decide("supabase db push", worktree), "allow");
    assert.equal(decide("supabase db push --dry-run", worktree), "allow");
    assert.equal(decide(`cd ${worktree} && supabase db push`, app), "allow");
    assert.equal(
      decide(`cd ${worktree} && supabase db push --dry-run`, app),
      "allow",
    );
  });
});

describe("unrelated commands", () => {
  test("go through, on main and on a branch", () => {
    for (const command of [
      "git status",
      "git pull",
      "git merge-base HEAD origin/main",
      "npm run check",
      'grep -n "git merge feat/x" AGENTS.md',
      'echo "supabase db push"',
      "supabase db dump --linked -f /tmp/x.sql",
      "supabase migration list",
    ]) {
      assert.equal(decide(command, app), "allow", command);
      assert.equal(decide(command, worktree), "allow", command);
    }
  });
});
