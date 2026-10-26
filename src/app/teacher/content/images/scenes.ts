/**
 * The Cenas section's list: every scene, grouped by the point of the first
 * question that uses it (#64).
 *
 * A scene belongs to no point of its own. The question that shows it does,
 * so the scene is filed where the book first needs it: a scene two questions
 * use, at points 12 and 30, is wanted from point 12 on. A scene no question
 * uses yet goes last, in a group of its own, because it is not needed
 * anywhere yet.
 *
 * Pure, so scenes.test.ts can hold the order without a database.
 */

/** What the grouping reads of a scene. */
export type GroupedScene = {
  readonly id: string;
  readonly description: string;
  /** The point numbers of the questions that show it, in any order. */
  readonly questionPoints: readonly number[];
};

export type SceneGroup<T> = {
  /** Null is the group of scenes no question uses yet. */
  readonly point: number | null;
  readonly scenes: readonly T[];
};

/** The first point in book order that needs this scene, or null. */
export function firstPoint(scene: {
  readonly questionPoints: readonly number[];
}): number | null {
  return scene.questionPoints.length === 0
    ? null
    : Math.min(...scene.questionPoints);
}

/**
 * Groups in book order, the scenes no question uses last. Inside a group, by
 * description, which is what the teacher reads, case and accents aside.
 */
export function groupScenes<T extends GroupedScene>(
  scenes: readonly T[],
): readonly SceneGroup<T>[] {
  const byPoint = new Map<number | null, T[]>();
  for (const scene of scenes) {
    const point = firstPoint(scene);
    const group = byPoint.get(point);
    if (group === undefined) byPoint.set(point, [scene]);
    else group.push(scene);
  }
  const points = [...byPoint.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  return points.map((point) => ({
    point,
    scenes: [...(byPoint.get(point) ?? [])].sort((a, b) =>
      a.description.localeCompare(b.description, "en", {
        sensitivity: "base",
      }),
    ),
  }));
}

/** A group's heading. */
export function groupLabel(point: number | null): string {
  return point === null ? "Sem pergunta ainda" : `Ponto ${point}`;
}

/**
 * Whether an insert was refused because the description is taken: a unique
 * violation, and on scenes_description_key rather than any other key.
 */
export function isDescriptionTaken(error: {
  readonly code?: string | null;
  readonly message: string;
}): boolean {
  return (
    error.code === "23505" && error.message.includes("scenes_description_key")
  );
}

/**
 * Whether archiving was refused because a question shows the scene: the
 * check violation scenes_in_use_stays raises (0034), told apart by its
 * sentence, since the trigger's name does not reach the message.
 */
export function isSceneInUse(error: {
  readonly code?: string | null;
  readonly message: string;
}): boolean {
  return (
    error.code === "23514" &&
    error.message.includes("is shown by a question and cannot be archived")
  );
}

/**
 * A description the way scenes_description_key (0030) compares it: case
 * folded and every run of white space one space, trimmed. Used to find the
 * scene a refused description collides with, so the screen can open it.
 */
export function descriptionKey(description: string): string {
  return description.replace(/\s+/gu, " ").trim().toLowerCase();
}
