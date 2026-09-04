import { MARGIN_GROUP_Y_TOLERANCE } from "./constants.ts";
import type { MarginReading } from "./margin-numbers.ts";

export type PageReadings = {
  readonly id: string;
  /** Where the page sat in the order the teacher uploaded. */
  readonly uploadIndex: number;
  readonly readings: readonly MarginReading[];
  /** Shaded panels found on the page. Part of the duplicate key. */
  readonly boxCount: number;
  /**
   * Headings and markers the page yielded. Used only to choose between two
   * copies of the same page: the one that gave up more structure is the one
   * worth keeping.
   */
  readonly structureCount: number;
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
   * before it in upload order.
   */
  readonly inheritedPoint: number | null;
  /** The page this one is a second scan of, when it is one. */
  readonly duplicateOf: string | null;
  /** Positions the algorithm could not settle, for the teacher to choose. */
  readonly disputes: readonly Dispute[];
};

export type Reconciliation = {
  /** Pages in book order, duplicates included but marked. */
  readonly pages: readonly PageResolution[];
  readonly assigned: readonly number[];
  readonly needsReview: boolean;
};

type Group = {
  readonly pageIndex: number;
  readonly y: number;
  candidates: Set<number>;
  readonly agreement: Map<number, number>;
  assigned: number | null;
};

/**
 * Decides which margin readings are real, across the whole batch at once.
 *
 * Not a per-page decision and not a monotonic sweep. A page on its own cannot
 * tell a real number from a convincing misreading: a continuation page whose
 * OCR returns the facing page's numbers looks exactly like a page that carries
 * them. What separates them is the rest of the batch.
 *
 * Four rules, applied until nothing more moves:
 *
 * 1. Two scans of one page are one page, merged before anything is assigned.
 * 2. A position with one candidate takes it; a value with one claimant goes to
 *    it. Both refuse to fire when another position is equally entitled, because
 *    a value may simply be absent and iteration order must not decide.
 * 3. Once some numbers are placed, the pages have an order, and a position
 *    between two placed numbers can only hold a value strictly between them.
 * 4. Only then, if a position is still undecided, the crop that saw a number
 *    more often wins. Never as a filter: requiring agreement would discard real
 *    numbers that only one crop found.
 *
 * Whatever is still undecided is a question for the teacher. A program that
 * cannot know should ask rather than guess.
 */
export function reconcilePoints(
  pages: readonly PageReadings[],
  ceiling: number,
): Reconciliation {
  const inRange = (value: number) => value >= 1 && value <= ceiling;

  // Rule 1. The same page scanned twice reads the same numbers and shows the
  // same panels. Box contents are not usable as the key: two scans of one page
  // differ exactly where the flattened table's reading order differs, which is
  // the least stable thing on the page.
  const duplicateOf = new Array<string | null>(pages.length).fill(null);
  const clusters = new Map<string, number[]>();
  pages.forEach((page, index) => {
    const values = [
      ...new Set(
        page.readings.map((r) => r.value).filter((value) => inRange(value)),
      ),
    ].sort((a, b) => a - b);
    if (values.length === 0) {
      // The key is undefined for a page that carries no number. Two different
      // continuation pages with the same panel count would look identical, and
      // one of them would be discarded as a copy of the other. A duplicate is
      // two scans of a page, and a page with nothing to match on cannot be
      // recognised as one here.
      return;
    }
    const key = `${page.boxCount}:${values.join(",")}`;
    const cluster = clusters.get(key);
    if (cluster === undefined) {
      clusters.set(key, [index]);
    } else {
      cluster.push(index);
    }
  });
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) {
      continue;
    }
    // Keep the scan that gave up more structure; it is the one the rest of the
    // pipeline will read better.
    const keeper = cluster.reduce((best, index) =>
      pages[index].structureCount > pages[best].structureCount ||
      (pages[index].structureCount === pages[best].structureCount &&
        pages[index].uploadIndex < pages[best].uploadIndex)
        ? index
        : best,
    );
    for (const index of cluster) {
      if (index !== keeper) {
        duplicateOf[index] = pages[keeper].id;
      }
    }
  }

  // Readings at nearly the same height are competing guesses at one number.
  const groups: Group[] = [];
  const groupsByPage = pages.map<Group[]>(() => []);
  pages.forEach((page, pageIndex) => {
    if (duplicateOf[pageIndex] !== null) {
      return;
    }
    for (const reading of [...page.readings].sort((a, b) => a.y - b.y)) {
      if (!inRange(reading.value)) {
        continue;
      }
      const last = groupsByPage[pageIndex].at(-1);
      if (
        last !== undefined &&
        reading.y - last.y <= MARGIN_GROUP_Y_TOLERANCE
      ) {
        last.candidates.add(reading.value);
        last.agreement.set(reading.value, reading.agreement);
      } else {
        const group: Group = {
          pageIndex,
          y: reading.y,
          candidates: new Set([reading.value]),
          agreement: new Map([[reading.value, reading.agreement]]),
          assigned: null,
        };
        groups.push(group);
        groupsByPage[pageIndex].push(group);
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

  /** Rule 2, both directions, conflict-aware. */
  const propagate = (): boolean => {
    let moved = false;

    // The census and the assignments have to be taken from the same instant.
    // An assignment made during this pass can leave another position holding a
    // single candidate, and that position was never counted, so it would be
    // assigned without ever being checked for a rival. It waits for the next
    // pass instead, where the census sees it.
    const eligible = groups.filter(
      (group) => group.assigned === null && group.candidates.size === 1,
    );
    const soleCandidate = new Map<number, number>();
    for (const group of eligible) {
      const value = [...group.candidates][0];
      soleCandidate.set(value, (soleCandidate.get(value) ?? 0) + 1);
    }
    for (const group of eligible) {
      if (group.assigned !== null || group.candidates.size !== 1) {
        continue;
      }
      const value = [...group.candidates][0];
      // Two positions certain of the same value are in conflict. Whichever the
      // loop reached first would win by nothing but iteration order.
      if ((soleCandidate.get(value) ?? 0) > 1) {
        continue;
      }
      assign(group, value);
      moved = true;
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
      // "One claimant, so it is theirs" assumes every value must be placed, and
      // that is false: the teacher may upload part of a book. When a position
      // holds two values that nobody else wants, it is a tie, not an answer.
      const rivals = [...list[0].candidates].filter(
        (other) => other !== value && (claimants.get(other)?.length ?? 0) === 1,
      );
      if (rivals.length > 0) {
        continue;
      }
      assign(list[0], value);
      moved = true;
    }

    return moved;
  };

  /** Book order from what is placed so far, unnumbered pages held by upload. */
  const pageOrder = (): number[] => {
    const anchor = new Map<number, number>();
    let current = Number.NEGATIVE_INFINITY;
    const byUpload = pages
      .map((page, index) => ({ page, index }))
      .filter(({ index }) => duplicateOf[index] === null)
      .sort((a, b) => a.page.uploadIndex - b.page.uploadIndex);
    for (const { index } of byUpload) {
      const placed = groupsByPage[index]
        .map((group) => group.assigned)
        .filter((value): value is number => value !== null);
      if (placed.length > 0) {
        current = Math.min(...placed);
      }
      anchor.set(index, current);
    }
    return byUpload
      .map(({ index }) => index)
      .sort(
        (a, b) =>
          (anchor.get(a) ?? 0) - (anchor.get(b) ?? 0) ||
          pages[a].uploadIndex - pages[b].uploadIndex,
      );
  };

  /**
   * Rule 3. Once numbers are placed the pages have an order, and a position
   * sitting between two of them can only hold a value strictly between them.
   * This is the sequence half of "validate by sequence and ceiling", and it is
   * what removes noise the ceiling cannot: a stray 4 between the pages holding
   * 73 and 75 is impossible without any threshold saying so.
   */
  const narrowBySequence = (): boolean => {
    const sequence: Group[] = [];
    for (const pageIndex of pageOrder()) {
      sequence.push(...groupsByPage[pageIndex]);
    }

    const lower = new Array<number>(sequence.length).fill(0);
    const upper = new Array<number>(sequence.length).fill(ceiling + 1);
    let seen = 0;
    for (let i = 0; i < sequence.length; i += 1) {
      lower[i] = seen;
      if (sequence[i].assigned !== null) {
        seen = sequence[i].assigned as number;
      }
    }
    seen = ceiling + 1;
    for (let i = sequence.length - 1; i >= 0; i -= 1) {
      upper[i] = seen;
      if (sequence[i].assigned !== null) {
        seen = sequence[i].assigned as number;
      }
    }

    let moved = false;
    for (let i = 0; i < sequence.length; i += 1) {
      const group = sequence[i];
      if (group.assigned !== null) {
        continue;
      }
      for (const value of [...group.candidates]) {
        if (value <= lower[i] || value >= upper[i]) {
          group.candidates.delete(value);
          moved = true;
        }
      }
    }
    return moved;
  };

  /** Rule 4, last and only within one position. */
  const breakTiesByAgreement = (): boolean => {
    let moved = false;
    for (const group of groups) {
      if (group.assigned !== null || group.candidates.size < 2) {
        continue;
      }
      let best = -1;
      let winners: number[] = [];
      for (const value of group.candidates) {
        const seen = group.agreement.get(value) ?? 0;
        if (seen > best) {
          best = seen;
          winners = [value];
        } else if (seen === best) {
          winners.push(value);
        }
      }
      if (winners.length === 1) {
        assign(group, winners[0]);
        moved = true;
      }
    }
    return moved;
  };

  let progressed = true;
  while (progressed) {
    progressed = propagate() || narrowBySequence();
  }
  if (breakTiesByAgreement()) {
    progressed = true;
    while (progressed) {
      progressed = propagate() || narrowBySequence();
    }
  }

  const byPage = pages.map(() => ({
    points: [] as number[],
    disputes: [] as Dispute[],
  }));
  for (const group of groups) {
    const target = byPage[group.pageIndex];
    if (group.assigned !== null) {
      target.points.push(group.assigned);
    } else if (group.candidates.size >= 1) {
      target.disputes.push({
        y: group.y,
        candidates: [...group.candidates].sort((a, b) => a - b),
      });
    }
  }

  const order = pageOrder();
  const inherited = new Map<number, number | null>();
  let currentPoint: number | null = null;
  for (const index of order) {
    const points = byPage[index].points;
    if (points.length > 0) {
      currentPoint = Math.max(...points);
      inherited.set(index, null);
    } else {
      inherited.set(index, currentPoint);
    }
  }

  const resolutionFor = (index: number): PageResolution => ({
    id: pages[index].id,
    points: [...byPage[index].points].sort((a, b) => a - b),
    inheritedPoint:
      byPage[index].points.length > 0 ? null : (inherited.get(index) ?? null),
    duplicateOf: duplicateOf[index],
    disputes: byPage[index].disputes,
  });

  const ordered = order.map(resolutionFor);
  // Duplicates keep a row so the screen can say the upload was recognised as a
  // page it already has, rather than silently dropping it.
  const duplicates = pages
    .map((_, index) => index)
    .filter((index) => duplicateOf[index] !== null)
    .map(resolutionFor);

  return {
    pages: [...ordered, ...duplicates],
    assigned: groups
      .filter((group) => group.assigned !== null)
      .map((group) => group.assigned as number)
      .sort((a, b) => a - b),
    needsReview: [...ordered, ...duplicates].some(
      (page) => page.disputes.length > 0,
    ),
  };
}
