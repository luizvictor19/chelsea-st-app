/**
 * The upload of a generated picture into the bucket.
 *
 * Its own file, and taking the bucket as a parameter, so node --test can run
 * the real call against a fake bucket: attempt-store.ts imports "@/" and
 * next/cache, which node --test does not resolve.
 */

/** What this needs of a Supabase Storage bucket, and nothing more. */
export type UploadBucket = {
  upload(
    path: string,
    body: ArrayBuffer,
    options: { contentType?: string; upsert?: boolean },
  ): Promise<{ error: { message: string } | null }>;
};

/**
 * Put a generated picture at its attempt's path.
 *
 * With upsert, so a second upload of the same attempt succeeds (#73). The
 * file is already there in two cases: the upload worked and the write that
 * closes the row did not, so the row stays 'pending' and the next poll stores
 * again; or two polls of one attempt, from two tabs, reach the store at once.
 * Without upsert Storage refuses the second with "The resource already
 * exists", and that refusal was recorded as a failed attempt over a picture
 * that was paid for and sitting in the bucket.
 *
 * Writing over is safe here and nowhere else: the path is the attempt's id,
 * so the same name always means the same attempt and the same image from the
 * provider. An upload of a finished file or a reference takes a fresh id each
 * time and does not come through here. The storage policy on 2026-11-04
 * already allows it: `vocabulary_images_write` is `for all` and
 * `vocabulary_images_read` is `select`, the update and select an upsert needs.
 *
 * Upsert is asked for rather than the "already exists" error recognised: the
 * text of that error is Storage's and can change, and every other error must
 * still reach the caller.
 */
export async function uploadGenerated(
  bucket: UploadBucket,
  path: string,
  bytes: ArrayBuffer,
  contentType: string | null,
): Promise<{ error: { message: string } | null }> {
  const { error } = await bucket.upload(path, bytes, {
    contentType: contentType ?? undefined,
    upsert: true,
  });
  return { error };
}
