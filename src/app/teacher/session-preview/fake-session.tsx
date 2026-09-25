"use client";

import { useState } from "react";

import { FakeTurnEngine } from "@/lib/tutor/fake-turn-engine";
import type { SessionWord } from "@/lib/tutor/turn-engine";

import { SessionScreen } from "./session-screen";

/**
 * The only place that knows the turn is fake. The real tutor replaces the
 * engine built here and SessionScreen stays as it is.
 */
export function FakeSession({ words }: { readonly words: SessionWord[] }) {
  const [engine] = useState(() => new FakeTurnEngine(words));
  return <SessionScreen engine={engine} preview />;
}
