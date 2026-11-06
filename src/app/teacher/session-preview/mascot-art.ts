import type { Mascot } from "../../../lib/brand.ts";

/*
 * Which file of a brand's mascot each state of the tutor shows. Apart from
 * robin.tsx so node:test can read it as plain TypeScript: mascot-files.test.ts
 * holds that every file named here exists, for every brand.
 */

export type RobinState = "idle" | "listening" | "thinking" | "speaking";

export type Theme = "light" | "dark";

/**
 * What each state shows: the looping idle video, or a still.
 *
 * Thinking and speaking have no art yet. Thinking borrows the listening still
 * and speaking borrows the idle loop; both are stand-ins, to be replaced here
 * when their files arrive, and nowhere else.
 */
export const ART: Record<
  RobinState,
  { kind: "video" | "still"; pose: "idle" | "listening" }
> = {
  idle: { kind: "video", pose: "idle" },
  listening: { kind: "still", pose: "listening" },
  thinking: { kind: "still", pose: "listening" }, // stand-in
  speaking: { kind: "video", pose: "idle" }, // stand-in
};

/** The URL of one file of a mascot, under public/. */
export function artUrl(
  mascot: Mascot,
  pose: string,
  theme: Theme,
  extension: "png" | "mp4",
): string {
  return `${mascot.dir}/${mascot.prefix}-${pose}-${theme}.${extension}`;
}

/** Every file the states above ask for: a video also needs its poster. */
export function mascotFiles(mascot: Mascot): string[] {
  const urls = Object.values(ART).flatMap(({ kind, pose }) =>
    (["light", "dark"] as const).flatMap((theme) =>
      kind === "video"
        ? [
            artUrl(mascot, pose, theme, "mp4"),
            artUrl(mascot, pose, theme, "png"),
          ]
        : [artUrl(mascot, pose, theme, "png")],
    ),
  );
  return [...new Set(urls)].sort();
}
