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
  takesReference,
} from "./provider";

// This module reads a secret, so it must never be bundled for the browser.
// There is no server-only package here, so the guard is explicit.
if (typeof window !== "undefined") {
  throw new Error("freepik.ts is server only and must not reach the browser");
}

const BASE_URL = "https://api.magnific.com";

/**
 * How much of the reference's shape to keep, 0 to 100.
 *
 * 25, measured on 2026-09-19 against the same word, the same reference and
 * the same instruction, with this number as the only thing that moved:
 *
 *   50, which is the API's own default as read from the Mystic POST
 *   reference that day: the pen came out right, but rendered like a catalogue
 *   photograph, on a grey background, with a reflection under it.
 *
 *   25: the style went back to flat, on the off-white background the style
 *   constant asks for, and the barrel came out solid blue instead of
 *   transparent.
 *
 * So the number is not "how much of the shape to keep" in practice so much as
 * how much of the reference's own rendering comes with it. At 50 the
 * photograph won over the style constant, which is the one thing the style
 * constant exists to prevent: a few hundred pictures read as a set, and a
 * reference that drags its own lighting in undoes that one word at a time.
 * Approved at 25.
 *
 * Sent rather than left out: a picture has to be reproducible from what is
 * stored, and if Freepik moves their default then every image made until then
 * becomes irreproducible in silence and the record starts lying without
 * anyone noticing. The value is ours, and visible in a diff the day it
 * changes.
 *
 * It stays a constant while one number serves every word. The day one does
 * not, it stops being a constant and becomes a column on the attempt, because
 * a value that varies has to be stored next to the picture it made.
 *
 * Mystic's, and only Mystic's. It takes effect alongside structure_reference
 * and nowhere else, which is why it is set in the same branch — and Flux
 * Kontext Pro has no equivalent at all, so do not go looking for why this
 * number does nothing there. Its documentation, read on 2026-09-19, lists no
 * parameter with strength, weight, adherence or fidelity in the name.
 */
const STRUCTURE_STRENGTH = 25;

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
 * Mystic takes a structure reference and Seedream takes no input image at
 * all, so the reference is part of the body a model builds rather than
 * something added on top of it. A model handed one it cannot use throws
 * rather than dropping it: the attempt row would still record which file was
 * used, and a row that says a picture came from a reference it never saw is
 * worse than a refusal.
 *
 * Polling goes back to the same path with the task id appended. That is
 * documented for Mystic, and assumed for Seedream: its page gives the POST
 * and says the answer is polled, without spelling the GET out.
 */
type ModelSpec = {
  readonly path: string;
  /**
   * `reference` arrives in whatever form this model asked for, which is the
   * model's `reference` field in provider.ts: base64 for Mystic, a public
   * URL for Kontext. The caller prepares it; the spec only places it.
   */
  readonly body: (
    prompt: string,
    reference: string | null,
  ) => Record<string, unknown>;
};

const SPECS: Record<ImageModelId, ModelSpec> = {
  "seedream-v4": {
    path: "/v1/ai/text-to-image/seedream-v4",
    body: (prompt) => ({ prompt, aspect_ratio: "square_1_1" }),
  },
  /*
   * Kontext takes its reference as a URL, so nothing is downloaded and
   * nothing is encoded: the caller hands over the public URL of the file
   * already sitting in the bucket. That is the whole reason it is here and
   * Flux 2 Pro is not.
   *
   * guidance (3.0) and steps (50) are left at the API's own defaults, read on
   * 2026-09-19, and deliberately not sent. Sending them would write down two
   * numbers nobody chose; what fixed structure_strength at 25 was a
   * measurement, not a principle. The reproducibility argument still applies
   * to them, so it waits here for its first reason: the day anyone has cause
   * to move guidance or steps, they become explicit in the same movement,
   * never nudged as a loose default.
   */
  "flux-kontext-pro": {
    path: "/v1/ai/text-to-image/flux-kontext-pro",
    body: (prompt, reference) => ({
      prompt,
      aspect_ratio: "square_1_1",
      ...(reference === null ? {} : { input_image: reference }),
    }),
  },
  mystic: {
    path: "/v1/ai/mystic",
    body: (prompt, reference) => ({
      prompt,
      aspect_ratio: "square_1_1",
      model: "flexible",
      /*
       * Raw base64, no data: prefix, because the POST reference types the
       * field as a string of `format: byte`. Read on 2026-09-19 and not
       * exercised against the live API in the same session, so if it comes
       * back refused, the two things to try in order are the data-URL form
       * and a plain URL: the Mystic overview page recommends URLs for
       * quality, and the bucket is already public, so the URL is a short
       * road from here.
       */
      ...(reference === null
        ? {}
        : {
            structure_reference: reference,
            structure_strength: STRUCTURE_STRENGTH,
          }),
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
    async generate({
      prompt,
      model,
      reference,
    }): Promise<{ requestId: string }> {
      if (!isImageModelId(model)) {
        throw new Error(`Unknown image model: ${model}`);
      }
      if (reference !== null && !takesReference(model)) {
        throw new Error(`${model} takes no structure reference`);
      }

      const spec = SPECS[model];
      const body = await call(spec.path, {
        method: "POST",
        body: spec.body(prompt, reference),
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
