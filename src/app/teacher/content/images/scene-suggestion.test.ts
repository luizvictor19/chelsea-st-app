import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Anthropic from "@anthropic-ai/sdk";

import { ClaudeKeyMissingError } from "../../../../lib/text/claude.ts";
import type { TextProvider } from "../../../../lib/text/provider.ts";

import { CLAUDE_NOT_CONFIGURED, CLAUDE_NO_ANSWER } from "./claude-failure.ts";
import {
  COMMON_ONLY,
  SCENE_ARCHIVED,
  SCENE_GONE,
  SCHOOL_ONLY,
  UNREADABLE,
  proposeSceneSubject,
  type SceneRow,
  type SceneSuggestionDeps,
} from "./scene-suggestion.ts";

const COMMON: SceneRow = {
  description: "No, the box isn’t small; it’s large",
  imageStyle: "flat",
  schoolId: null,
  archived: false,
};

/** A provider that counts its calls and answers with `answer`. */
function fakeClient(answer: () => string) {
  const asked: { system: string; user: string }[] = [];
  let built = 0;
  const provider = (): TextProvider => {
    built += 1;
    return {
      async complete({ system, user }) {
        asked.push({ system, user });
        return { text: answer(), model: "claude-haiku-5-5", usage: null };
      },
    };
  };
  return {
    provider,
    asked,
    get built() {
      return built;
    },
  };
}

function deps(
  over: Partial<SceneSuggestionDeps> & {
    client?: ReturnType<typeof fakeClient>;
  } = {},
): SceneSuggestionDeps & { client: ReturnType<typeof fakeClient> } {
  const client =
    over.client ?? fakeClient(() => '{"subject": "one large box"}');
  return {
    scene: async () => COMMON,
    canWrite: async () => true,
    question: async () => "Is the box small?",
    provider: client.provider,
    ...over,
    client,
  };
}

describe("proposeSceneSubject", () => {
  test("a non-writer never reaches the client: neither built nor called", async () => {
    for (const scene of [COMMON, { ...COMMON, schoolId: "school-1" }]) {
      const schools: (string | null)[] = [];
      const d = deps({
        scene: async () => scene,
        canWrite: async (school) => {
          schools.push(school);
          return false;
        },
      });
      const result = await proposeSceneSubject(d);
      assert.deepEqual(result, {
        ok: false,
        error: scene.schoolId === null ? COMMON_ONLY : SCHOOL_ONLY,
      });
      assert.equal(d.client.built, 0);
      assert.equal(d.client.asked.length, 0);
      // Asked with the scene's own school: null is "common content".
      assert.deepEqual(schools, [scene.schoolId]);
    }
  });

  test("a scene gone or excluded is refused before the check and the call", async () => {
    let checked = 0;
    for (const [scene, error] of [
      [null, SCENE_GONE],
      [{ ...COMMON, archived: true }, SCENE_ARCHIVED],
    ] as const) {
      const d = deps({
        scene: async () => scene,
        canWrite: async () => {
          checked += 1;
          return true;
        },
      });
      assert.deepEqual(await proposeSceneSubject(d), { ok: false, error });
      assert.equal(d.client.built, 0);
    }
    assert.equal(checked, 0);
  });

  test("a writer gets the parsed phrase, asked with the line and its question", async () => {
    const d = deps();
    assert.deepEqual(await proposeSceneSubject(d), {
      ok: true,
      subject: "one large box",
    });
    assert.equal(d.client.asked.length, 1);
    assert.match(d.client.asked[0].user, /Is the box small\?/u);
    assert.match(d.client.asked[0].user, /it’s large/u);
  });

  test("a scene no question shows is asked without one", async () => {
    const d = deps({ question: async () => null });
    await proposeSceneSubject(d);
    assert.doesNotMatch(d.client.asked[0].user, /question/iu);
  });

  test("an answer with no phrase in it is said, with the answer as the cause", async () => {
    const d = deps({ client: fakeClient(() => "not json") });
    assert.deepEqual(await proposeSceneSubject(d), {
      ok: false,
      error: UNREADABLE,
      cause: "not json",
    });
  });

  test("a failed call says the sentence for its class, with the reason as the cause", async () => {
    for (const [thrown, error] of [
      [new ClaudeKeyMissingError(), CLAUDE_NOT_CONFIGURED],
      [
        new Anthropic.OverloadedError(
          529,
          undefined,
          "overloaded",
          new Headers(),
        ),
        CLAUDE_NO_ANSWER,
      ],
    ] as const) {
      const result = await proposeSceneSubject(
        deps({
          client: fakeClient(() => {
            throw thrown;
          }),
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok);
      assert.equal(result.error, error);
      assert.equal(result.cause, thrown.message);
    }
  });
});
