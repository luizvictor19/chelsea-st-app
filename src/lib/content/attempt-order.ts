/**
 * The order attempts are shown in: the approved one first, then the rest
 * newest to oldest.
 *
 * Sorting by date alone sank the approved image further down the list every
 * time another attempt was made, so the one picture that is actually in use
 * ended up hardest to find, and hardest exactly when a word had been worked
 * on the most.
 */
export function approvedFirst<
  T extends { readonly status: string; readonly createdAt: string },
>(attempts: readonly T[]): readonly T[] {
  return [...attempts].sort((a, b) => {
    const approved =
      Number(b.status === "approved") - Number(a.status === "approved");
    if (approved !== 0) return approved;
    // Newest first among the rest, which is the order they arrived in.
    return b.createdAt.localeCompare(a.createdAt);
  });
}
