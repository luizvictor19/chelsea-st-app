"use client";

import { useSyncExternalStore } from "react";

import { notices, type Notice } from "./notices";

const NONE: readonly Notice[] = [];

/**
 * The teacher area's stack of notices, mounted once in the layout. What it
 * shows lives in `notices`, so a notice pushed by a screen that has since
 * closed is still here. See notices.ts for the rules.
 */
export function Snackbar() {
  const list = useSyncExternalStore(
    notices.subscribe,
    notices.getSnapshot,
    () => NONE,
  );
  if (list.length === 0) return null;

  return (
    <ol className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96">
      {list.map((notice) => (
        <li
          key={notice.id}
          role={notice.kind === "error" ? "alert" : "status"}
          className={`bg-surface border-rule flex items-start gap-3 rounded-sm border border-l-4 p-3 text-sm shadow-lg ${
            notice.kind === "error" ? "border-l-accent" : "border-l-foreground"
          }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            title="Fechar"
            onClick={() => notices.dismiss(notice.id)}
            className="text-faint hover:text-foreground -m-1 rounded-sm p-1 transition-colors"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </li>
      ))}
    </ol>
  );
}
