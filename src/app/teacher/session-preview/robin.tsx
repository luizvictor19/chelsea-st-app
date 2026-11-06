import type { Mascot } from "@/lib/brand";

import { ART, artUrl, type RobinState } from "./mascot-art";

export type { RobinState };

const LABELS: Record<RobinState, string> = {
  idle: "parado",
  listening: "ouvindo",
  thinking: "pensando",
  speaking: "falando",
};

/*
 * No file has transparency. Each is painted on the screen's own ground,
 * exactly #F2F2F0 in light and #0F1115 in dark, so the file has to follow the
 * theme or its square shows. The switch is made in CSS rather than read in
 * script: the server has no theme to read, and a guess would flash the wrong
 * square on first paint.
 */
const FRAME = "size-full object-contain";

type ArtProps = { readonly mascot: Mascot; readonly pose: string };

function Still({ mascot, pose }: ArtProps) {
  return (
    <picture>
      <source
        srcSet={artUrl(mascot, pose, "dark", "png")}
        media="(prefers-color-scheme: dark)"
      />
      <img
        src={artUrl(mascot, pose, "light", "png")}
        alt=""
        className={FRAME}
      />
    </picture>
  );
}

/**
 * One video per theme with the other one hidden, because a <source media> on
 * a video is read once on load and would not follow a theme change.
 *
 * The hidden one is not free: in Chromium 153 on 2026-09-25 both downloaded
 * and both kept playing, currentTime advancing on the one not shown. The
 * price is one more file of under 200 KB and a second small decode, accepted
 * for a prototype; pausing it would need the theme in script.
 */
function Loop({ mascot, pose }: ArtProps) {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => (
        <video
          key={theme}
          src={artUrl(mascot, pose, theme, "mp4")}
          poster={artUrl(mascot, pose, theme, "png")}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className={
            theme === "light"
              ? `${FRAME} dark:hidden`
              : `${FRAME} hidden dark:block`
          }
        />
      ))}
    </>
  );
}

/**
 * The tutor, drawn with the mascot of the brand of the Host. The tutor is
 * called Robin under every brand; only the art changes.
 */
export function Robin({
  state,
  mascot,
}: {
  readonly state: RobinState;
  readonly mascot: Mascot;
}) {
  const art = ART[state];
  return (
    <div
      role="img"
      aria-label={`Robin, ${LABELS[state]}`}
      className="size-32 shrink-0 bg-[#F2F2F0] sm:size-40 dark:bg-[#0F1115]"
    >
      {art.kind === "video" ? (
        <Loop key={`${mascot}/${art.pose}`} mascot={mascot} pose={art.pose} />
      ) : (
        <Still mascot={mascot} pose={art.pose} />
      )}
    </div>
  );
}
