"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
} from "react";

import {
  clearAll,
  fit,
  standing,
  toBoard,
  undo,
  type Ink,
  type Mark,
  type Point,
  type Size,
} from "./board";

type Tool = "pen" | "text" | "eraser";

/*
 * Fixed colours, not the tokens of the theme: the board is white with dark
 * ink in the dark theme too, because it is read on the other side of a
 * shared screen.
 */
const GROUND = "#ffffff";
const COLOUR: Record<Ink, string> = {
  black: "#111827",
  red: "#dc2626",
  blue: "#1d4ed8",
};
const INKS: readonly { readonly ink: Ink; readonly label: string }[] = [
  { ink: "black", label: "Preto" },
  { ink: "red", label: "Vermelho" },
  { ink: "blue", label: "Azul" },
];

// In units of the board, which is 900 high: the letter is 7% of its height.
const PEN_WIDTH = 5;
const ERASER_WIDTH = 48;
const TEXT_SIZE = 64;
const TEXT_FACE = "system-ui, sans-serif";
const TEXT_WEIGHT = 600;

type Stroke = Extract<Mark, { kind: "stroke" }>;

function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const erasing = stroke.ink === "erase";
  ctx.strokeStyle = stroke.ink === "erase" ? GROUND : COLOUR[stroke.ink];
  ctx.lineWidth = erasing ? ERASER_WIDTH : PEN_WIDTH;
  const [first, ...rest] = stroke.points;
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  // Through the middle of each pair, so a fast hand draws a curve and not
  // a chain of straight pieces. A single point comes out as a dot.
  let last = first;
  for (const point of rest) {
    ctx.quadraticCurveTo(
      last[0],
      last[1],
      (last[0] + point[0]) / 2,
      (last[1] + point[1]) / 2,
    );
    last = point;
  }
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

/** The whole board again, from the marks: there is no other copy of it. */
function paint(
  canvas: HTMLCanvasElement,
  area: Size,
  marks: readonly Mark[],
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null || area.width === 0 || area.height === 0) return;
  const density = window.devicePixelRatio || 1;
  const width = Math.round(area.width * density);
  const height = Math.round(area.height * density);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, width, height);

  const { scale, left, top } = fit(area);
  ctx.setTransform(
    density * scale,
    0,
    0,
    density * scale,
    density * left,
    density * top,
  );
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.textBaseline = "middle";
  ctx.font = `${TEXT_WEIGHT} ${TEXT_SIZE}px ${TEXT_FACE}`;
  for (const mark of marks) {
    if (mark.kind === "stroke") {
      paintStroke(ctx, mark);
    } else if (mark.kind === "text") {
      ctx.fillStyle = COLOUR[mark.ink];
      ctx.fillText(mark.text, mark.at[0], mark.at[1]);
    }
  }
}

const toolClass = (selected: boolean) =>
  selected
    ? "rounded-sm border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-sm text-white"
    : "rounded-sm border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 hover:border-neutral-500 disabled:opacity-40";

/*
 * The board over the card. It stays mounted while minimised, hidden, so the
 * tool and the colour are the same when it comes back; what was drawn lives
 * in the lesson above it, which is why it survives a change of card.
 */
export function Whiteboard({
  open,
  marks,
  onMarks,
  onMinimise,
}: {
  readonly open: boolean;
  readonly marks: readonly Mark[];
  readonly onMarks: Dispatch<SetStateAction<readonly Mark[]>>;
  readonly onMinimise: () => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState<Ink>("black");
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  // Where a text is being typed, or null.
  const [typingAt, setTypingAt] = useState<Point | null>(null);
  const ground = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The stroke under the pointer, not yet a mark.
  const drawing = useRef<{ ink: Stroke["ink"]; points: Point[] } | null>(null);
  // Whether the press now under way began while a text was being typed.
  const pressedWhileTyping = useRef(false);

  useEffect(() => {
    const element = ground.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shown = standing(marks);

  useEffect(() => {
    if (canvas.current !== null) paint(canvas.current, area, shown);
  }, [area, shown]);

  function pointOf(event: PointerEvent<HTMLCanvasElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return toBoard(box, event.clientX - box.left, event.clientY - box.top);
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    pressedWhileTyping.current = typingAt !== null;
    // A press outside the text only confirms it, which its blur does.
    if (event.button !== 0 || typingAt !== null || tool === "text") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = {
      ink: tool === "eraser" ? "erase" : ink,
      points: [pointOf(event)],
    };
    paint(event.currentTarget, area, [
      ...shown,
      { kind: "stroke", ...drawing.current },
    ]);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current === null) return;
    drawing.current.points.push(pointOf(event));
    paint(event.currentTarget, area, [
      ...shown,
      { kind: "stroke", ...drawing.current },
    ]);
  }

  function onPointerEnd() {
    const stroke = drawing.current;
    if (stroke === null) return;
    drawing.current = null;
    onMarks((current) => [...current, { kind: "stroke", ...stroke }]);
  }

  const { scale, left, top } = fit(area);

  return (
    <div
      className={
        open
          ? "absolute inset-0 z-10 flex flex-col overflow-hidden rounded-sm bg-white text-neutral-900"
          : "hidden"
      }
      style={{ colorScheme: "light" }}
    >
      {/*
        The buttons do not take the focus: a text being typed stays open while
        its colour is chosen, and the space never lands on the last button
        pressed.
      */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-b border-neutral-300 bg-neutral-100 px-2 py-1.5"
        onMouseDown={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className={toolClass(tool === "pen")}
          aria-pressed={tool === "pen"}
          onClick={() => setTool("pen")}
        >
          Caneta
        </button>
        <button
          type="button"
          className={toolClass(tool === "text")}
          aria-pressed={tool === "text"}
          onClick={() => setTool("text")}
        >
          Texto
        </button>
        <button
          type="button"
          className={toolClass(tool === "eraser")}
          aria-pressed={tool === "eraser"}
          onClick={() => setTool("eraser")}
        >
          Borracha
        </button>
        <span className="mx-1 flex items-center gap-1.5">
          {INKS.map((option) => (
            <button
              key={option.ink}
              type="button"
              aria-label={option.label}
              title={option.label}
              aria-pressed={ink === option.ink && tool !== "eraser"}
              className={
                ink === option.ink && tool !== "eraser"
                  ? "size-6 rounded-full ring-2 ring-neutral-900 ring-offset-2 ring-offset-neutral-100"
                  : "size-6 rounded-full"
              }
              style={{ backgroundColor: COLOUR[option.ink] }}
              onClick={() => {
                setInk(option.ink);
                // A colour is for writing: choosing one puts the eraser down.
                if (tool === "eraser") setTool("pen");
              }}
            />
          ))}
        </span>
        <button
          type="button"
          className={toolClass(false)}
          disabled={marks.length === 0}
          onClick={() => onMarks(undo)}
          title="Ctrl+Z"
        >
          Desfazer
        </button>
        <button
          type="button"
          className={toolClass(false)}
          disabled={shown.length === 0}
          onClick={() => onMarks(clearAll)}
        >
          Apagar tudo
        </button>
        <button
          type="button"
          className={`${toolClass(false)} ml-auto`}
          onClick={onMinimise}
          title="Tecla Q"
        >
          Minimizar
        </button>
      </div>

      <div ref={ground} className="relative min-h-0 flex-1">
        <canvas
          ref={canvas}
          className={
            tool === "text"
              ? "absolute inset-0 size-full cursor-text touch-none"
              : "absolute inset-0 size-full cursor-crosshair touch-none"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={(event) => {
            // The click and not the press: the press takes the focus from
            // whatever has it, and would close the field it had just opened.
            if (tool !== "text" || pressedWhileTyping.current) return;
            const box = event.currentTarget.getBoundingClientRect();
            setTypingAt(
              toBoard(box, event.clientX - box.left, event.clientY - box.top),
            );
          }}
        />
        {typingAt !== null && (
          <input
            type="text"
            autoFocus
            aria-label="Texto no quadro"
            className="absolute bg-transparent p-0 outline-1 outline-offset-4 outline-neutral-400 outline-dashed"
            // The same letter the canvas will paint, in the same place: the
            // line is centred on the point that was clicked.
            style={{
              left: left + typingAt[0] * scale,
              top: top + (typingAt[1] - (TEXT_SIZE * 1.2) / 2) * scale,
              width: Math.max(
                area.width - (left + typingAt[0] * scale) - 8,
                80,
              ),
              height: TEXT_SIZE * 1.2 * scale,
              fontSize: TEXT_SIZE * scale,
              lineHeight: 1.2,
              fontFamily: TEXT_FACE,
              fontWeight: TEXT_WEIGHT,
              color: COLOUR[ink],
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = "";
                event.currentTarget.blur();
              }
            }}
            // The one way a text is confirmed: Enter, a click outside and
            // Escape (emptied first) all end here.
            onBlur={(event) => {
              const text = event.currentTarget.value.trim();
              if (text !== "") {
                onMarks((current) => [
                  ...current,
                  { kind: "text", ink, at: typingAt, text },
                ]);
              }
              setTypingAt(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
