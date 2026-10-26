/**
 * Which model draws a scene out of approved pictures handed to it as
 * references (#120): "the pen on the book" from the approved pen and the
 * approved book.
 *
 * Flux Kontext Pro, the reference model already wired in, takes one picture,
 * so joining several meant a montage first. The three below take the
 * pictures separately, read on docs.magnific.com on 2026-10-25:
 *
 *   seedream-v4-edit    reference_images, up to 5, URL or base64
 *   seedream-v4-5-edit  reference_images, 1 to 5, URL or base64
 *   flux-2-pro          input_image .. input_image_4, base64 only
 *
 * None of the three lists a price. What one costs is read off the dashboard,
 * before and after a single run, as Seedream's 50 and Kontext's 150 were
 * (provider.ts); hence one model per run, never all three at once.
 *
 * It writes nothing to the database. Each call is appended to the JSONL file
 * the moment it answers, the POST included, so a run cut short still records
 * the generation it paid for; the picture is downloaded next to it, because
 * the provider's URL does not last.
 *
 *   node --env-file=../chelsea-st-app/.env.local scripts/measure-scene-references.ts --model seedream-v4-edit
 *   node --env-file=../chelsea-st-app/.env.local scripts/measure-scene-references.ts --model seedream-v4-5-edit
 *   node --env-file=../chelsea-st-app/.env.local scripts/measure-scene-references.ts --model flux-2-pro
 *
 * --ref replaces pen and book with other paths in the same bucket, once per
 * picture. One --ref with a montage asked, on 2026-10-26, whether a model
 * needs the pictures apart at all: it did (#120, 0033).
 *
 *   ... --model seedream-v4-5-edit --ref <scenes.reference_path>
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildScenePrompt } from "../src/lib/images/style.ts";

const args = process.argv.slice(2);
/* As in measure-suggestion-batch.ts: a flag with nothing after it falls back. */
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const ROOT = join(import.meta.dirname, "..");
const OUT = option("out", join(ROOT, "fixtures", "scene-references.jsonl"));
const PICTURES = join(ROOT, "fixtures", "scene-references");
const SUBJECT = option("subject", "the pen on the book");

/*
 * The approved pictures of pen and book, both flat, read through the
 * read-only Supabase MCP on 2026-10-25. Paths in the vocabulary-images
 * bucket, which is public.
 */
const REFERENCES = [
  {
    term: "pen",
    path: "0856b144-e26a-473f-8278-81e4c50f8868/d28631af-6308-438f-b71d-74c1b62496d2.jpg",
  },
  {
    term: "book",
    path: "9c65031f-6944-4cd0-abde-36a921cb3294/16c7c281-e025-430a-8034-086e5cabb864.jpg",
  },
] as const;

/* Every path after a --ref, in order; none keeps pen and book. */
const REFS = args.flatMap((arg, i) => {
  const value = args[i + 1];
  return arg === "--ref" && value !== undefined && !value.startsWith("--")
    ? [{ term: value.split("/").pop() ?? value, path: value }]
    : [];
});
const PICKED = REFS.length > 0 ? REFS : REFERENCES;

type Model = {
  readonly path: string;
  readonly body: (
    prompt: string,
    urls: readonly string[],
  ) => Promise<Record<string, unknown>>;
};

const MODELS: Record<string, Model> = {
  "seedream-v4-edit": {
    path: "/v1/ai/text-to-image/seedream-v4-edit",
    body: async (prompt, urls) => ({
      prompt,
      reference_images: urls,
      aspect_ratio: "square_1_1",
    }),
  },
  "seedream-v4-5-edit": {
    path: "/v1/ai/text-to-image/seedream-v4-5-edit",
    body: async (prompt, urls) => ({
      prompt,
      reference_images: urls,
      aspect_ratio: "square_1_1",
    }),
  },
  /* Base64 only, and one field per picture rather than an array. */
  "flux-2-pro": {
    path: "/v1/ai/text-to-image/flux-2-pro",
    body: async (prompt, urls) => {
      const encoded = await Promise.all(urls.map(download));
      const fields = [
        "input_image",
        "input_image_2",
        "input_image_3",
        "input_image_4",
      ];
      if (encoded.length > fields.length) {
        throw new Error(`flux-2-pro takes at most ${fields.length} pictures`);
      }
      return {
        prompt,
        width: 1024,
        height: 1024,
        ...Object.fromEntries(
          encoded.map((bytes, i) => [
            fields[i],
            Buffer.from(bytes).toString("base64"),
          ]),
        ),
      };
    },
  },
};

const MODEL_ID = option("model", "");
const model = MODELS[MODEL_ID];
if (model === undefined) {
  console.error(
    `--model is one of: ${Object.keys(MODELS).join(", ")} (got "${MODEL_ID}")`,
  );
  process.exit(1);
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function download(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.arrayBuffer();
}

async function call(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.magnific.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-magnific-api-key": env("FREEPIK_API_KEY"),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

type Task = { taskId: string; status: string; generated: string[] };

function readTask(body: unknown): Task {
  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  return {
    taskId: typeof data.task_id === "string" ? data.task_id : "",
    status: typeof data.status === "string" ? data.status : "",
    generated: Array.isArray(data.generated)
      ? data.generated.filter((url): url is string => typeof url === "string")
      : [],
  };
}

function record(line: Record<string, unknown>): void {
  appendFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), model: MODEL_ID, ...line }) +
      "\n",
  );
}

const bucket = `${env("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1/object/public/vocabulary-images`;
const urls = PICKED.map((reference) => `${bucket}/${reference.path}`);
const prompt = buildScenePrompt(SUBJECT, "flat");

mkdirSync(PICTURES, { recursive: true });

const posted = readTask(await call(model.path, await model.body(prompt, urls)));
record({
  phase: "posted",
  taskId: posted.taskId,
  subject: SUBJECT,
  references: PICKED.map((reference) => reference.term),
  prompt,
});
if (posted.taskId === "") throw new Error("No task id in the answer");

/* Polled on the same path with the task id appended, as freepik.ts does. */
const deadline = Date.now() + 5 * 60_000;
let task = posted;
while (task.status !== "COMPLETED" && task.status !== "FAILED") {
  if (Date.now() > deadline) {
    record({ phase: "timeout", taskId: posted.taskId });
    throw new Error("Gave up after 5 minutes; the task id is in the JSONL");
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  task = readTask(await call(`${model.path}/${posted.taskId}`));
}

const imageUrl = task.generated[0];
if (task.status === "FAILED" || imageUrl === undefined) {
  record({ phase: "failed", taskId: posted.taskId, status: task.status });
  throw new Error(`Generation ended ${task.status} with no picture`);
}

const extension = /\.png(\?|$)/u.test(imageUrl) ? "png" : "jpg";
const file = join(PICTURES, `${Date.now()}-${MODEL_ID}.${extension}`);
writeFileSync(file, Buffer.from(await download(imageUrl)));
record({ phase: "done", taskId: posted.taskId, file });
console.log(`${MODEL_ID}: ${file}`);
