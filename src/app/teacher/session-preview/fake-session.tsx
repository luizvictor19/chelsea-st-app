"use client";

import { useState } from "react";

import type { Mascot } from "@/lib/brand";
import { FakeTurnEngine } from "@/lib/tutor/fake-turn-engine";
import type { SessionWord } from "@/lib/tutor/turn-engine";

import { SessionScreen } from "./session-screen";

/**
 * The only place that knows the turn is fake. The real tutor replaces the
 * engine built here and SessionScreen stays as it is.
 */
export function FakeSession({
  words,
  mascot,
}: {
  readonly words: SessionWord[];
  readonly mascot: Mascot;
}) {
  const [engine] = useState(() => new FakeTurnEngine(words));
  return <SessionScreen engine={engine} mascot={mascot} preview />;
}
