import { MARGIN_GROUP_Y_TOLERANCE } from "./constants.ts";
import type { MarginNumber } from "./types.ts";

export type PageReadings = {
  readonly id: string;
  /** Where the page sat in the order the teacher uploaded. */
  readonly uploadIndex: number;
  readonly readings: readonly MarginNumber[];
};

export type Dispute = {
  readonly y: number;
  readonly candidates: readonly number[];
};

export type PageResolution = {
  readonly id: string;
  /** Numbers this page carries, ascending. Empty when it carries none. */
  readonly points: readonly number[];
  /**
   * The point a page with no number of its own belongs to, taken from the page
   * before it in upload order. Null when it has numbers, or when nothing
   * precedes it.
   */
  readonly inheritedPoint: number | null;
  /** Positions the algorithm could not settle, for the teacher to choose. */
  readonly disputes: readonly Dispute[];
};

export type Reconciliation = {
  /** Pages in book order. */
  readonly pages: readonly PageResolution[];
  readonly assigned: readonly number[];
  readonly needsReview: boolean;
};

type Group = {
  readonly pageIndex: number;
  readonly y: number;
  candidates: Set<number>;
  assigned: number | null;
};

/**
 * Decides which margin readings are real, across the whole batch at once.
 *
 * Not a per-page decision and not a monotonic sweep. A page on its own cannot
 * tell a real number from a convincing misreading: a continuation page whose
 * OCR returns 58 and 59 looks exactly like a page that carries them. What
 * separates them is that the pages which really carry 58 and 59 have no other
 * candidate for those positions, so those values are spoken for.
 *
 * That is constraint propagation, and it is the spec's own rule made
 * mechanical: the numbers are the deduplication key, so a number belongs to one
 * position in the book and claiming it anywhere else is a misreading.
 *
 * When two positions are left competing for the same values, neither resolves
 * and both are handed to the teacher. A program that cannot know should ask
 * rather than guess.
 */
export function reconcilePoints(
  pages: readonly PageReadings[],
  ceiling: number,
): Reconciliation {
  // (a) Readings at nearly the same height are competing guesses at one number.
  // (b) Anything outside the book cannot be a point in it.
  const groups: Group[] = [];
  pages.forEach((page, pageIndex) => {
    const ordered = [...page.readings].sort((a, b) => a.y - b.y);
    for (const reading of ordered) {
      if (reading.value < 1 || reading.value > ceiling) {
        continue;
      }
      const last = groups[groups.length - 1];
      if (
        last !== undefined &&
        last.pageIndex === pageIndex &&
        reading.y - last.y <= MARGIN_GROUP_Y_TOLERANCE
      ) {
        last.candidates.add(reading.value);
      } else {
        groups.push({
          pageIndex,
          y: reading.y,
          candidates: new Set([reading.value]),
          assigned: null,
        });
      }
    }
  });

  const assign = (group: Group, value: number): void => {
    group.assigned = value;
    group.candidates = new Set([value]);
    for (const other of groups) {
      if (other !== group && other.assigned === null) {
        other.candidates.delete(value);
      }
    }
  };

  // (c) and (d). Both directions of the same rule, run to a fixed point: a
  // position with one candidate takes it, and a value with one claimant goes
  // to it. Each assignment narrows the others, which is what makes the pages
  // that genuinely carry a number push the misreadings off it.
  let progressed = true;
  while (progressed) {
    progressed = false;

    // A position with one candidate takes it, unless another position is
    // equally certain of the same value. Two groups whose only candidate is 58
    // are in conflict, and whichever the loop reached first would win by
    // nothing but iteration order. That is how a continuation page, whose OCR
    // picked up the facing page's numbers, could take them from the page that
    // really carries them.
    const soleClaim = new Map<number, number>();
    for (const group of groups) {
      if (group.assigned === null && group.candidates.size === 1) {
        const value = [...group.candidates][0];
        soleClaim.set(value, (soleClaim.get(value) ?? 0) + 1);
      }
    }
    for (const group of groups) {
      if (group.assigned !== null || group.candidates.size !== 1) {
        continue;
      }
      const value = [...group.candidates][0];
      if ((soleClaim.get(value) ?? 0) > 1) {
        continue;
      }
      assign(group, value);
      progressed = true;
    }

    const claimants = new Map<number, Group[]>();
    for (const group of groups) {
      if (group.assigned !== null) {
        continue;
      }
      for (const value of group.candidates) {
        const list = claimants.get(value);
        if (list === undefined) {
          claimants.set(value, [group]);
        } else {
          list.push(group);
        }
      }
    }
    for (const [value, list] of claimants) {
      if (list.length !== 1 || list[0].assigned !== null) {
        continue;
      }
      // Only sound while the group has no rival that is equally unclaimed
      // elsewhere. "A value with one claimant belongs to it" assumes every
      // value must be placed somewhere, and that is false here: the teacher
      // may upload part of a book, so a number can simply be absent. When two
      // of a group's candidates are both spoken for by nobody else, the rule
      // fires for whichever is looked at first and invents an answer. That is
      // a tie, and a tie is a question for the teacher.
      const rivals = [...list[0].candidates].filter(
        (other) => other !== value && (claimants.get(other)?.length ?? 0) === 1,
      );
      if (rivals.length > 0) {
        continue;
      }
      assign(list[0], value);
      progressed = true;
    }
  }

  // (e) A position left with nothing was never a number; one left with several
  // is a question for the teacher.
  const byPage = pages.map(() => ({
    points: [] as number[],
    disputes: [] as Dispute[],
  }));
  for (const group of groups) {
    const target = byPage[group.pageIndex];
    if (group.assigned !== null) {
      target.points.push(group.assigned);
    } else if (group.candidates.size >= 1) {
      // Either several candidates and no way to choose, or a single candidate
      // that another position claims just as strongly. Both are questions.
      target.disputes.push({
        y: group.y,
        candidates: [...group.candidates].sort((a, b) => a - b),
      });
    }
  }

  // (f) Book order comes from the numbers. A page carrying none sits where the
  // upload put it, just after the page it followed.
  const inUploadOrder = [...pages]
    .map((page, index) => ({ page, index }))
    .sort((a, b) => a.page.uploadIndex - b.page.uploadIndex);

  const anchors = new Map<number, { key: number; inherited: number | null }>();
  let currentKey = -Infinity;
  let currentPoint: number | null = null;
  for (const { page, index } of inUploadOrder) {
    const points = byPage[index].points;
    if (points.length > 0) {
      currentKey = Math.min(...points);
      currentPoint = Math.max(...points);
      anchors.set(index, { key: currentKey, inherited: null });
    } else {
      anchors.set(index, { key: currentKey, inherited: currentPoint });
    }
    void page;
  }

  const resolved: PageResolution[] = pages.map((page, index) => ({
    id: page.id,
    points: [...byPage[index].points].sort((a, b) => a - b),
    inheritedPoint:
      byPage[index].points.length > 0
        ? null
        : (anchors.get(index)?.inherited ?? null),
    disputes: byPage[index].disputes,
  }));

  const ordered = resolved
    .map((resolution, index) => ({ resolution, index }))
    .sort(
      (a, b) =>
        (anchors.get(a.index)?.key ?? 0) - (anchors.get(b.index)?.key ?? 0) ||
        pages[a.index].uploadIndex - pages[b.index].uploadIndex,
    )
    .map((entry) => entry.resolution);

  const assigned = groups
    .filter((group) => group.assigned !== null)
    .map((group) => group.assigned as number)
    .sort((a, b) => a - b);

  return {
    pages: ordered,
    assigned,
    needsReview: ordered.some((page) => page.disputes.length > 0),
  };
}
