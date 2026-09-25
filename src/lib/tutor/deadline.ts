/**
 * Waits for `work`, but never longer than `ms`. Says which came first.
 *
 * The tutor's voice resolves when it stops talking, and a voice that never
 * reports the end would leave the screen in "speaking" for good, with the
 * button off. The deadline is the screen's guarantee that the student always
 * gets her turn back. A rejection counts as done: the screen has nothing to
 * wait for either way.
 */
export async function withDeadline(
  work: Promise<unknown>,
  ms: number,
): Promise<"done" | "timed-out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), ms);
  });
  const done = work.then(
    () => "done" as const,
    () => "done" as const,
  );
  try {
    return await Promise.race([done, late]);
  } finally {
    clearTimeout(timer);
  }
}
