import {
  MARGIN_AGREEMENT,
  MARGIN_CHAIN_MINIMUM,
  MARGIN_GROUP_Y_TOLERANCE,
} from "./constants.ts";
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

/** A settled number and the height it was printed at. */
export type Placement = {
  readonly number: number;
  readonly y: number;
};

export type PageResolution = {
  readonly id: string;
  /** Numbers this page carries, ascending. Empty when it carries none. */
  readonly points: readonly number[];
  /**
   * The same numbers with their positions down the page. A spread carries two,
   * and a block belongs to the last number printed above it, so splitting a
   * page's content between its points needs the heights and not just the values.
   */
  readonly placements: readonly Placement[];
  /**
   * The point a page with no number of its own belongs to, taken from the page
   * before it in upload order.
   */
  readonly inheritedPoint: number | null;
  /**
   * The point in force as the page begins, before its own first number.
   *
   * Not the same question as inheritedPoint, which asks "which point is this
   * whole page" and is only answerable when the page carries no number. This
   * one is answerable for every page, and it is what the content printed above
   * a page's first margin number belongs to: that content was printed under the
   * last number of the page before, and stays there.
   *
   * The page carrying the book's own first point is the exception: nothing in
   * the book precedes it, so the top of that page is its own. Null everywhere
   * else that no page precedes it, which is a question and not an answer.
   */
  readonly openingPoint: number | null;
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
  /** Whether the interval pass found a placed number on each side. */
  boundedBelow: boolean;
  boundedAbove: boolean;
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
 * None of them place a number that nothing corroborates. Corroboration is one
 * of four things: two crops agreeing, the page's own printed order, an interval
 * with a placed number on each side, or a number already settled on the same
 * page. See mayAssign.
 *
 * Whatever is still undecided is a question for the teacher. A program that
 * cannot know should ask rather than guess.
 */
/** The span of numbers a book actually uses, read off its first and last page. */
export type PointRange = {
  readonly first: number;
  readonly last: number;
};

export function reconcilePoints(
  pages: readonly PageReadings[],
  range: PointRange,
): Reconciliation {
  const { first, last: ceiling } = range;
  // A reading below the book's first point is noise exactly as one above its
  // last is. Book 5 does not start at 1, and validating against a floor of 1
  // lets every stray small number through.
  const inRange = (value: number) => value >= first && value <= ceiling;

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
          boundedBelow: false,
          boundedAbove: false,
        };
        groups.push(group);
        groupsByPage[pageIndex].push(group);
      }
    }
  });

  /**
   * The numbers run down the margin in increasing order. That is how the book
   * is printed, not a guess about it, and it is the one constraint available
   * before anything is known about the other pages.
   *
   * Each page is settled on its own first: keep only the readings that can take
   * part in a longest increasing run down the page, and drop the positions that
   * cannot take part in any. A stray 11 read between the 57 and the 58 cannot
   * belong to the run, and dies here rather than surviving to the cross-page
   * phase, where it would already have become an anchor for itself.
   *
   * Where several runs tie for longest, every value that appears in one of them
   * is kept. Choosing between them is not this rule's business.
   */
  const narrowByPageMonotonicity = (): void => {
    for (const clusters of groupsByPage) {
      if (clusters.length === 0) {
        continue;
      }

      const forward = clusters.map(() => new Map<number, number>());
      for (let i = 0; i < clusters.length; i += 1) {
        for (const value of clusters[i].candidates) {
          let longest = 1;
          for (let j = 0; j < i; j += 1) {
            for (const earlier of clusters[j].candidates) {
              if (earlier < value) {
                longest = Math.max(longest, (forward[j].get(earlier) ?? 0) + 1);
              }
            }
          }
          forward[i].set(value, longest);
        }
      }

      const backward = clusters.map(() => new Map<number, number>());
      for (let i = clusters.length - 1; i >= 0; i -= 1) {
        for (const value of clusters[i].candidates) {
          let longest = 1;
          for (let j = i + 1; j < clusters.length; j += 1) {
            for (const later of clusters[j].candidates) {
              if (later > value) {
                longest = Math.max(longest, (backward[j].get(later) ?? 0) + 1);
              }
            }
          }
          backward[i].set(value, longest);
        }
      }

      let longestRun = 0;
      for (let i = 0; i < clusters.length; i += 1) {
        for (const value of clusters[i].candidates) {
          longestRun = Math.max(
            longestRun,
            (forward[i].get(value) ?? 0) + (backward[i].get(value) ?? 0) - 1,
          );
        }
      }

      for (let i = 0; i < clusters.length; i += 1) {
        for (const value of [...clusters[i].candidates]) {
          const participates =
            (forward[i].get(value) ?? 0) + (backward[i].get(value) ?? 0) - 1 ===
            longestRun;
          if (!participates) {
            clusters[i].candidates.delete(value);
          }
        }
      }
    }
  };

  /**
   * Pages whose own printed order corroborates every number on them.
   *
   * Read once, straight after the monotonicity pass and before anything is
   * assigned, so it describes what the crops actually returned rather than a
   * state some later cross-page deletion produced. A page qualifies when every
   * position it holds is down to a single candidate and those candidates
   * increase in the order they are printed — the order the book is set in.
   *
   * The pass above has already done the dangerous half: any reading that cannot
   * take part in a longest increasing run down the page is gone, so what
   * survives to be counted here is a page that reads cleanly top to bottom.
   */
  const readsInPrintedOrder = (clusters: readonly Group[]): boolean => {
    if (clusters.length < MARGIN_CHAIN_MINIMUM) {
      return false;
    }
    if (clusters.some((group) => group.candidates.size !== 1)) {
      return false;
    }
    const byHeight = [...clusters].sort((a, b) => a.y - b.y);
    return byHeight.every(
      (group, at) =>
        at === 0 ||
        [...group.candidates][0] > [...byHeight[at - 1].candidates][0],
    );
  };
  let corroboratedByOrder: boolean[] = groupsByPage.map(() => false);

  /**
   * Whether a position may be settled at all.
   *
   * Being the only candidate left is not enough on its own: a single reading
   * that one crop saw once, on a page with nothing else to corroborate it, is
   * exactly the shape of noise. It has to earn the assignment one of four
   * ways, and if it earns none it goes to the teacher with its candidates
   * listed. The failure mode is one more question, never a wrong answer.
   */
  const mayAssign = (group: Group, value: number): boolean => {
    // (a) More than one crop read it, so it is not one engine's slip.
    if ((group.agreement.get(value) ?? 0) >= MARGIN_AGREEMENT) {
      return true;
    }

    // (a2) Or the page's own printed order corroborates it, which is evidence
    // no single reading can carry: several positions, one number each, rising
    // down the margin. It is what settles the first page of book 1, whose three
    // numbers were each seen by one crop and which had no anchor anywhere.
    //
    // Both readings have to hold: as the crops returned it, and still now. The
    // first is what the rule is about, and only ever narrows — a page that
    // arrived with a position holding two candidates never earns it. The second
    // is what stops a chain being spent after it has been broken: a value taken
    // by another page is deleted here too, and the position it leaves empty
    // means the page no longer reads as the run this rule saw.
    if (
      corroboratedByOrder[group.pageIndex] &&
      readsInPrintedOrder(groupsByPage[group.pageIndex])
    ) {
      return true;
    }

    // (b) The placed numbers on either side leave no other possibility.
    if (
      group.boundedBelow &&
      group.boundedAbove &&
      group.candidates.size === 1 &&
      group.candidates.has(value)
    ) {
      return true;
    }

    // (c) It continues the increasing run of its own page alongside a number
    // already settled there.
    const siblings = groupsByPage[group.pageIndex].filter(
      (other) => other !== group && other.assigned !== null,
    );
    if (siblings.length === 0) {
      return false;
    }
    return siblings.every((sibling) =>
      sibling.y < group.y
        ? (sibling.assigned as number) < value
        : (sibling.assigned as number) > value,
    );
  };

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
      if (!mayAssign(group, value)) {
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
      if (rivals.length > 0 || !mayAssign(list[0], value)) {
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

    const lower = new Array<number>(sequence.length).fill(first - 1);
    const upper = new Array<number>(sequence.length).fill(ceiling + 1);
    let seen = first - 1;
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

    // A page that has nothing placed on it has no known position: the order it
    // was uploaded in says where an unnumbered page goes, but says nothing
    // about where a page whose number is still undecided belongs. Narrowing it
    // against the neighbours it happens to have been uploaded beside deletes
    // good candidates, and does so differently for every upload order.
    const positioned = new Set(
      groupsByPage
        .map((clusters, index) =>
          clusters.some((group) => group.assigned !== null) ? index : -1,
        )
        .filter((index) => index >= 0),
    );

    let moved = false;
    for (let i = 0; i < sequence.length; i += 1) {
      const group = sequence[i];
      if (group.assigned !== null || !positioned.has(group.pageIndex)) {
        continue;
      }
      // Bounded means a placed number sits on that side, not the open end of
      // the book. Only then can the interval force a value.
      group.boundedBelow = lower[i] > first - 1;
      group.boundedAbove = upper[i] <= ceiling;
      for (const value of [...group.candidates]) {
        if (value <= lower[i] || value >= upper[i]) {
          group.candidates.delete(value);
          moved = true;
        }
      }
    }
    return moved;
  };

  /**
   * Rule 3b. When a page's undecided positions and the values still free
   * between its anchors are the same in number, there is only one way to fit
   * them, and the printed order says which is which.
   *
   * This is rule 3 counted rather than applied one at a time. Two positions on
   * a page bounded by 118 and 121 leave 119 and 120, and neither is forced
   * alone, so the interval rule stalls and the page loses both its numbers. It
   * only bites on a small upload, where there are few anchors, which is how
   * pages will actually be uploaded.
   *
   * Forced only when it agrees with what was read: a position whose candidates
   * exclude the value it would receive is a disagreement, not an arrangement,
   * and goes to the teacher instead.
   */
  const forceByCount = (): boolean => {
    const sequence: Group[] = [];
    for (const pageIndex of pageOrder()) {
      sequence.push(...groupsByPage[pageIndex]);
    }
    const taken = new Set(
      groups
        .filter((group) => group.assigned !== null)
        .map((group) => group.assigned as number),
    );

    let moved = false;
    for (const [pageIndex, clusters] of groupsByPage.entries()) {
      const undecided = clusters.filter((group) => group.assigned === null);
      if (undecided.length === 0) {
        continue;
      }

      const firstIndex = sequence.indexOf(undecided[0]);
      const lastIndex = sequence.indexOf(undecided[undecided.length - 1]);
      if (firstIndex < 0 || lastIndex < 0) {
        continue;
      }

      let lower = first - 1;
      for (let i = firstIndex - 1; i >= 0; i -= 1) {
        if (sequence[i].assigned !== null) {
          lower = sequence[i].assigned as number;
          break;
        }
      }
      let upper = ceiling + 1;
      for (let i = lastIndex + 1; i < sequence.length; i += 1) {
        if (sequence[i].assigned !== null) {
          upper = sequence[i].assigned as number;
          break;
        }
      }
      // Both sides must be anchored, or the count means nothing.
      if (lower === first - 1 || upper === ceiling + 1) {
        continue;
      }

      const free: number[] = [];
      for (let value = lower + 1; value < upper; value += 1) {
        if (!taken.has(value)) {
          free.push(value);
        }
      }
      if (free.length !== undecided.length) {
        continue;
      }

      // Every position must have read the value it is about to receive. A
      // position left with no candidate at all is one whose every reading was
      // rejected, and filling it from the count would invent a number nobody
      // read: measured, that handed a continuation page the number 56 and took
      // it from the page that carries it.
      const agrees = undecided.every((group, index) =>
        group.candidates.has(free[index]),
      );
      if (!agrees) {
        continue;
      }

      undecided.forEach((group, index) => {
        assign(group, free[index]);
        taken.add(free[index]);
      });
      moved = true;
      void pageIndex;
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
      if (winners.length === 1 && mayAssign(group, winners[0])) {
        assign(group, winners[0]);
        moved = true;
      }
    }
    return moved;
  };

  // Within a page first, where the printing order is a fact rather than an
  // inference. Only then across pages, where everything depends on what has
  // already been placed.
  narrowByPageMonotonicity();
  corroboratedByOrder = groupsByPage.map(readsInPrintedOrder);

  let progressed = true;
  while (progressed) {
    progressed = propagate() || narrowBySequence() || forceByCount();
  }
  if (breakTiesByAgreement()) {
    progressed = true;
    while (progressed) {
      progressed = propagate() || narrowBySequence() || forceByCount();
    }
  }

  const byPage = pages.map(() => ({
    points: [] as Placement[],
    disputes: [] as Dispute[],
  }));
  for (const group of groups) {
    const target = byPage[group.pageIndex];
    if (group.assigned !== null) {
      target.points.push({ number: group.assigned, y: group.y });
    } else if (group.candidates.size >= 1) {
      target.disputes.push({
        y: group.y,
        candidates: [...group.candidates].sort((a, b) => a - b),
      });
    }
  }

  const order = pageOrder();
  // The point in force as each page begins, taken before the page's own numbers
  // are counted. A page that carries numbers still has one, which is what the
  // content above its first number belongs to.
  const opening = new Map<number, number | null>();
  let currentPoint: number | null = null;
  for (const index of order) {
    opening.set(index, currentPoint);
    const points = byPage[index].points;
    if (points.length > 0) {
      currentPoint = Math.max(...points.map((placement) => placement.number));
    }
  }

  const resolutionFor = (index: number): PageResolution => ({
    id: pages[index].id,
    points: byPage[index].points
      .map((placement) => placement.number)
      .sort((a, b) => a - b),
    placements: [...byPage[index].points].sort((a, b) => a.y - b.y),
    inheritedPoint:
      byPage[index].points.length > 0 ? null : (opening.get(index) ?? null),
    // Nothing precedes the book's own first point, so the space above it on the
    // page that carries it belongs to that point and to no earlier one.
    openingPoint:
      opening.get(index) ??
      (byPage[index].points.some((placement) => placement.number === first)
        ? first
        : null),
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
