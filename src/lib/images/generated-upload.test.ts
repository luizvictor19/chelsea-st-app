import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { uploadGenerated, type UploadBucket } from "./generated-upload.ts";

/*
 * A bucket that answers the way Supabase Storage does. Measured on
 * 2026-11-04 against a local stack (supabase CLI 2.122.0, supabase-js
 * 2.112.4): a second upload to a path that already exists, without upsert,
 * comes back with
 *
 *   { message: "The resource already exists", statusCode: "409" }
 *
 * and the same upload with upsert: true succeeds, leaving one object.
 */
function storageBucket(failWith?: string): UploadBucket & {
  readonly objects: Map<string, ArrayBuffer>;
} {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    async upload(path, body, options) {
      if (failWith !== undefined) return { error: { message: failWith } };
      if (objects.has(path) && options.upsert !== true) {
        return {
          error: {
            message: "The resource already exists",
            statusCode: "409",
          } as { message: string },
        };
      }
      objects.set(path, body);
      return { error: null };
    },
  };
}

const PATH = "owner/attempt-1.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

describe("uploadGenerated", () => {
  test("stores the picture at its path", async () => {
    const bucket = storageBucket();
    const { error } = await uploadGenerated(bucket, PATH, PNG, "image/png");
    assert.equal(error, null);
    assert.deepEqual([...bucket.objects.keys()], [PATH]);
  });

  /*
   * #73: the file is already there when the upload worked and the row's
   * finish did not, or when two polls of one attempt reach the store at
   * once. The second upload must not turn a paid, stored picture into a
   * failed attempt.
   */
  test("a second upload of the same attempt succeeds, and leaves one file", async () => {
    const bucket = storageBucket();
    await uploadGenerated(bucket, PATH, PNG, "image/png");
    const { error } = await uploadGenerated(bucket, PATH, PNG, "image/png");
    assert.equal(error, null);
    assert.equal(bucket.objects.size, 1);
  });

  test("an error that is not a repeated name still reaches the caller", async () => {
    const bucket = storageBucket("new row violates row-level security policy");
    const { error } = await uploadGenerated(bucket, PATH, PNG, "image/png");
    assert.equal(error?.message, "new row violates row-level security policy");
    assert.equal(bucket.objects.size, 0);
  });

  test("an unknown content type is left to the bucket", async () => {
    let seen: string | undefined = "unset";
    const bucket: UploadBucket = {
      async upload(_path, _body, options) {
        seen = options.contentType;
        return { error: null };
      },
    };
    await uploadGenerated(bucket, PATH, PNG, null);
    assert.equal(seen, undefined);
  });
});
