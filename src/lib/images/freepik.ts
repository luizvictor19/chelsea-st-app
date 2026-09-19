/**
 * The only file that knows the image API and holds its key.
 *
 * A note on the name. The key is FREEPIK_API_KEY and an attempt records
 * provider 'freepik', because that is whose account is billed. The docs and
 * the host are Magnific: docs.freepik.com now redirects to docs.magnific.com,
 * and the documented base URL and header are the Magnific ones, so that is
 * what is used here. Read https://docs.magnific.com/llms.txt before changing
 * any of it. This host and header pair was confirmed against the live API on
 * 2026-09-19.
 */

import {
  type ImageModelId,
  type ImageProvider,
  type PollResult,
  isImageModelId,
} from "./provider";

// This module reads a secret, so it must never be bundled for the browser.
// There is no server-only package here, so the guard is explicit.
if (typeof window !== "undefined") {
  throw new Error("freepik.ts is server only and must not reach the browser");
}

const BASE_URL = "https://api.magnific.com";

/**
 * What each model needs, since the three do not take the same request.
 *
 * A word's picture is square: it sits in a small tile on the lesson screen,
 * and any other ratio would have to be cropped to get there. Both models say
 * that with aspect_ratio, which is why the two specs differ only in the path
 * and in Mystic's extra field; a model that wanted width and height would
 * need its own body, which is what this shape is for.
 *
 * Mystic's own `model` field picks a generator inside Mystic, and it
 * defaults to `realism`. `flexible` is asked for instead, because the docs
 * say it is the one that is "especially good with illustrations" and warn
 * against realism for anything stylised. Leaving the default would have
 * measured Mystic at the thing this product never asks it for.
 *
 * No reference image on either, though Mystic accepts one. This delivery
 * compares text to image, and a model given a reference the other cannot
 * have would not be being compared to it.
 *
 * Polling goes back to the same path with the task id appended. That is
 * documented for Mystic, and assumed for Seedream: its page gives the POST
 * and says the answer is polled, without spelling the GET out.
 */
type ModelSpec = {
  readonly path: string;
  readonly body: (prompt: string) => Record<string, unknown>;
};

const SPECS: Record<ImageModelId, ModelSpec> = {
  "seedream-v4": {
    path: "/v1/ai/text-to-image/seedream-v4",
    body: (prompt) => ({ prompt, aspect_ratio: "square_1_1" }),
  },
  mystic: {
    path: "/v1/ai/mystic",
    body: (prompt) => ({
      prompt,
      aspect_ratio: "square_1_1",
      model: "flexible",
    }),
  },
};

/**
 * The key is read per call rather than at module load, because the CI build
 * runs with no image key at all and importing this file must not fail there.
 */
function apiKey(): string {
  const key = process.env.FREEPIK_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable: FREEPIK_API_KEY");
  }
  return key;
}

/**
 * poll() is handed one opaque string, so the model it has to ask travels
 * inside it. The whole handle is what gets stored in provider_request_id,
 * which makes a stored row say which endpoint was called as well as which
 * task, and that is what tracing a charge actually needs.
 */
function encodeHandle(model: ImageModelId, taskId: string): string {
  return `${model}:${taskId}`;
}

function decodeHandle(handle: string): {
  model: ImageModelId;
  taskId: string;
} {
  const separator = handle.indexOf(":");
  const model = separator === -1 ? "" : handle.slice(0, separator);
  const taskId = separator === -1 ? "" : handle.slice(separator + 1);
  if (!isImageModelId(model) || taskId === "") {
    throw new Error(`Unrecognised image request handle: ${handle}`);
  }
  return { model, taskId };
}

/** The shape both endpoints answer with, narrowed by hand from unknown. */
type TaskBody = {
  taskId: string | null;
  status: string | null;
  generated: readonly string[];
};

function readTaskBody(body: unknown): TaskBody {
  const data =
    typeof body === "object" && body !== null && "data" in body
      ? (body as { data: unknown }).data
      : null;
  if (typeof data !== "object" || data === null) {
    return { taskId: null, status: null, generated: [] };
  }
  const record = data as Record<string, unknown>;
  const generated = Array.isArray(record.generated)
    ? record.generated.filter((url): url is string => typeof url === "string")
    : [];
  return {
    taskId: typeof record.task_id === "string" ? record.task_id : null,
    status: typeof record.status === "string" ? record.status : null,
    generated,
  };
}

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      "x-magnific-api-key": apiKey(),
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!response.ok) {
    // The body usually says why; it is worth more than the status alone.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Image API ${init.method} ${path} failed: ${response.status} ${detail.slice(0, 300)}`,
    );
  }
  return response.json();
}

export function createFreepikProvider(): ImageProvider {
  return {
    async generate({ prompt, model }): Promise<{ requestId: string }> {
      if (!isImageModelId(model)) {
        throw new Error(`Unknown image model: ${model}`);
      }

      const spec = SPECS[model];
      const body = await call(spec.path, {
        method: "POST",
        body: spec.body(prompt),
      });

      const task = readTaskBody(body);
      if (task.taskId === null) {
        throw new Error(
          "Image API accepted the prompt but returned no task id",
        );
      }
      return { requestId: encodeHandle(model, task.taskId) };
    },

    /**
     * Throws when the call itself fails, rather than reporting "failed": a
     * refused request and a refused generation are different things, and the
     * caller records them differently. Only the provider saying FAILED is a
     * failed generation.
     */
    async poll(requestId): Promise<PollResult> {
      const { model, taskId } = decodeHandle(requestId);
      const body = await call(`${SPECS[model].path}/${taskId}`, {
        method: "GET",
      });
      const task = readTaskBody(body);

      switch (task.status) {
        case "COMPLETED": {
          const imageUrl = task.generated[0];
          if (imageUrl === undefined) {
            return { status: "failed", error: "Finished with no image" };
          }
          // creditsSpent is deliberately absent: the response carries no
          // credit figure, so image_attempts.credits_spent stays null. What
          // an image actually costs was measured from the dashboard instead
          // and is recorded next to IMAGE_MODELS in provider.ts.
          return { status: "done", imageUrl };
        }
        case "FAILED":
          return { status: "failed", error: "The provider reported FAILED" };
        case "CREATED":
        case "IN_PROGRESS":
          return { status: "pending" };
        default:
          return {
            status: "failed",
            error: `Unrecognised provider status: ${task.status ?? "none"}`,
          };
      }
    },
  };
}
