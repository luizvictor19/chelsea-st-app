/**
 * Which forms of the questions screen hold something unsaved (#184).
 *
 * Leaving the screen drops every open form at once, so a link that leaves
 * asks first when any of them is dirty, not only the form it sits in. Each
 * form marks itself by the key it already files its draft under, and marks
 * itself clean again when it is saved, emptied or closed.
 *
 * Plain data and no React, so the rule is tested under node; leave-guard.tsx
 * holds one for the screen.
 */
export type UnsavedRegistry = {
  /** Records whether the form under `key` holds something unsaved. */
  readonly mark: (key: string, dirty: boolean) => void;
  /** Whether leaving now would drop something unsaved. */
  readonly any: () => boolean;
};

export function createUnsavedRegistry(): UnsavedRegistry {
  const dirty = new Set<string>();
  return {
    mark(key, isDirty) {
      if (isDirty) dirty.add(key);
      else dirty.delete(key);
    },
    any() {
      return dirty.size > 0;
    },
  };
}
