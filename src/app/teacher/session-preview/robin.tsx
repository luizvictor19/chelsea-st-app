export type RobinState = "idle" | "listening" | "thinking" | "speaking";

const LABELS: Record<RobinState, string> = {
  idle: "parado",
  listening: "ouvindo",
  thinking: "pensando",
  speaking: "falando",
};

/**
 * What each state shows: the looping idle video, or a still.
 *
 * Thinking and speaking have no art yet. Thinking borrows the listening still
 * and speaking borrows the idle loop; both are stand-ins, to be replaced here
 * when their files arrive, and nowhere else.
 */
const ART: Record<RobinState, { kind: "video" | "still"; name: string }> = {
  idle: { kind: "video", name: "robin-idle" },
  listening: { kind: "still", name: "robin-listening" },
  thinking: { kind: "still", name: "robin-listening" }, // stand-in
  speaking: { kind: "video", name: "robin-idle" }, // stand-in
};

/*
 * No file has transparency. Each is painted on the screen's own ground,
 * exactly #F2F2F0 in light and #0F1115 in dark, so the file has to follow the
 * theme or its square shows. The switch is made in CSS rather than read in
 * script: the server has no theme to read, and a guess would flash the wrong
 * square on first paint.
 */
const FRAME = "size-full object-contain";

function Still({ name }: { readonly name: string }) {
  return (
    <picture>
      <source
        srcSet={`/robin/${name}-dark.png`}
        media="(prefers-color-scheme: dark)"
      />
      <img src={`/robin/${name}-light.png`} alt="" className={FRAME} />
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
function Loop({ name }: { readonly name: string }) {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => (
        <video
          key={theme}
          src={`/robin/${name}-${theme}.mp4`}
          poster={`/robin/${name}-${theme}.png`}
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

export function Robin({ state }: { readonly state: RobinState }) {
  const art = ART[state];
  return (
    <div
      role="img"
      aria-label={`Robin, ${LABELS[state]}`}
      className="size-32 shrink-0 bg-[#F2F2F0] sm:size-40 dark:bg-[#0F1115]"
    >
      {art.kind === "video" ? (
        <Loop key={art.name} name={art.name} />
      ) : (
        <Still name={art.name} />
      )}
    </div>
  );
}
