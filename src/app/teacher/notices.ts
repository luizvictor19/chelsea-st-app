/**
 * The notices the teacher area shows in its snackbar, held outside React.
 *
 * Outside on purpose: the notice this was built for comes from a save that
 * fails after the panel that started it has closed. A notice kept in that
 * panel's state would close with it. The store lives as long as the page, and
 * the snackbar in the teacher layout only renders what is in it.
 *
 * The rules:
 * - an error stays until the teacher closes it. The errors sent here are the
 *   ones that lose work, and a message that leaves by itself can leave
 *   before it is read;
 * - a success leaves by itself after SUCCESS_MS, and can be closed sooner,
 *   unless it is pushed with `stays`. That is for the result of a long run,
 *   a minute or more, which ends while the teacher is looking elsewhere; it
 *   stays until closed, in the success colour. Two kinds, not three;
 * - notices stack, in the order they came. A new one never replaces another.
 */

export type NoticeKind = "error" | "success";

export type Notice = {
  readonly id: number;
  readonly kind: NoticeKind;
  readonly text: string;
};

/** How long a success stays. Long enough to read one short sentence. */
export const SUCCESS_MS = 4000;

/** The clock, injected so the tests can move it. */
export type Timer = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const browserTimer: Timer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type PushOptions = {
  /** Stay until closed, whatever the kind. Errors always stay. */
  readonly stays?: boolean;
};

export type Notices = {
  push(kind: NoticeKind, text: string, options?: PushOptions): number;
  dismiss(id: number): void;
  /** The same array until something changes, as useSyncExternalStore needs. */
  getSnapshot(): readonly Notice[];
  subscribe(listener: () => void): () => void;
};

export function createNotices(timer: Timer = browserTimer): Notices {
  let list: readonly Notice[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const timers = new Map<number, unknown>();

  function changed(to: readonly Notice[]) {
    list = to;
    for (const listener of listeners) listener();
  }

  function dismiss(id: number) {
    const handle = timers.get(id);
    if (handle !== undefined) {
      timer.clear(handle);
      timers.delete(id);
    }
    if (list.some((notice) => notice.id === id)) {
      changed(list.filter((notice) => notice.id !== id));
    }
  }

  return {
    push(kind, text, options = {}) {
      const id = next++;
      changed([...list, { id, kind, text }]);
      if (kind === "success" && options.stays !== true) {
        timers.set(
          id,
          timer.set(() => dismiss(id), SUCCESS_MS),
        );
      }
      return id;
    },
    dismiss,
    getSnapshot: () => list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The one store the teacher area shares. */
export const notices = createNotices();
