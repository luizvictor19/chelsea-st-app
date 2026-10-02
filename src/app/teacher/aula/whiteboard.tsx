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
  editText,
  keepInView,
  LETTER,
  standing,
  textAt,
  undo,
  type Ink,
  type Mark,
  type Point,
  type StandingText,
  type Stroke,
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

const PEN_WIDTH = 4;
const ERASER_WIDTH = 40;
const TEXT_FACE = "system-ui, sans-serif";
const TEXT_WEIGHT = 600;
const FONT = `${TEXT_WEIGHT} ${LETTER.size}px ${TEXT_FACE}`;
const LINE = LETTER.size * LETTER.line;
// The square handle a text being typed is moved by, and how far the dashed
// outline of the field stands from the text: the handle sits on its corner.
const GRIP = 24;
const OUTLINE = 5;

type Size = { readonly width: number; readonly height: number };

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

/*
 * The whole board again, from the marks: there is no other copy of it. One
 * CSS pixel is one unit of the board, from the top left corner, so the
 * drawing stays where it is and as large as it is when the board changes
 * width. The canvas takes its size here and not from the layout: sized by
 * CSS, it would show the old drawing stretched until the next paint.
 */
function paint(
  canvas: HTMLCanvasElement,
  area: Size,
  marks: readonly (Stroke | StandingText)[],
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null || area.width === 0 || area.height === 0) return;
  const density = window.devicePixelRatio || 1;
  const width = Math.round(area.width * density);
  const height = Math.round(area.height * density);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${area.width}px`;
  canvas.style.height = `${area.height}px`;

  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, area.width, area.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.textBaseline = "middle";
  ctx.font = FONT;
  for (const mark of marks) {
    if (mark.kind === "stroke") {
      paintStroke(ctx, mark);
    } else {
      ctx.fillStyle = COLOUR[mark.ink];
      ctx.fillText(mark.text, mark.at[0], mark.at[1]);
    }
  }
}

/*
 * For a button whose disabled state changes while the page is open. Firefox
 * keeps that state through a reload and puts it back on the button before
 * React hydrates: the server sends Desfazer disabled, since the board starts
 * empty, Firefox enables it again because it was enabled before the reload,
 * and hydration finds disabled={null} where it renders disabled={true}. The
 * server and the client agreed all along; the browser changed the DOM between
 * them. autocomplete="off" on the button is how Firefox is told not to, and
 * the other browsers ignore it. Spread, because React's type for a button
 * does not list the attribute.
 */
export const stateNotRestored = { autoComplete: "off" };

const toolClass = (selected: boolean) =>
  selected
    ? "rounded-sm border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-sm text-white"
    : "rounded-sm border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-900 hover:border-neutral-500 disabled:opacity-40";

/*
 * The board beside the card, taking this share of the row. It stays mounted
 * while closed, hidden, so the tool and the colour are the same when it comes
 * back; what was drawn lives in the lesson above it, which is why it survives
 * a change of card.
 */
export function Whiteboard({
  open,
  share,
  marks,
  onMarks,
  onClose,
}: {
  readonly open: boolean;
  readonly share: number;
  readonly marks: readonly Mark[];
  readonly onMarks: Dispatch<SetStateAction<readonly Mark[]>>;
  readonly onClose: () => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState<Ink>("black");
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  // The text being typed, or null: where its line begins, which follows the
  // handle while it is dragged, and the standing text it rewrites when it is
  // not a new one.
  const [typing, setTyping] = useState<{
    readonly at: Point;
    readonly edited: StandingText | null;
  } | null>(null);
  const ground = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The stroke under the pointer, not yet a mark.
  const drawing = useRef<{ ink: Stroke["ink"]; points: Point[] } | null>(null);
  // Whether the press now under way began while a text was being typed.
  const pressedWhileTyping = useRef(false);
  // The drag of the handle under way: its pointer, where the pointer and the
  // text were when it began, and the caret of the field at that moment.
  const moving = useRef<{
    readonly pointer: number;
    readonly from: Point;
    readonly at: Point;
    readonly caret: readonly [start: number | null, end: number | null];
  } | null>(null);
  // True only while Escape closes the field: its blur then keeps nothing.
  const discarded = useRef(false);

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

  // A text being rewritten is in its field, and not painted under it too.
  const rewriting = typing?.edited?.origin ?? null;
  const shown = standing(marks).filter(
    (mark) => !(mark.kind === "text" && mark.origin === rewriting),
  );

  useEffect(() => {
    if (canvas.current !== null) paint(canvas.current, area, shown);
  }, [area, shown]);

  function pointOf(event: {
    readonly currentTarget: HTMLCanvasElement;
    readonly clientX: number;
    readonly clientY: number;
  }): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    pressedWhileTyping.current = typing !== null;
    // A press outside the text only confirms it, which its blur does.
    if (event.button !== 0 || typing !== null || tool === "text") return;
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

  /** How wide the canvas paints a text, for finding the one under a click. */
  function widthOf(text: string): number {
    const ctx = canvas.current?.getContext("2d") ?? null;
    if (ctx === null) return 0;
    ctx.font = FONT;
    return ctx.measureText(text).width;
  }

  function onGrab(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || typing === null || moving.current !== null) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // Should the click that ends this press land on the canvas, it is not a
    // click to write a new text over the open one.
    pressedWhileTyping.current = true;
    moving.current = {
      pointer: event.pointerId,
      from: [event.clientX, event.clientY],
      at: typing.at,
      caret: [
        field.current?.selectionStart ?? null,
        field.current?.selectionEnd ?? null,
      ],
    };
  }

  function onDrag(event: PointerEvent<HTMLDivElement>) {
    const grip = moving.current;
    if (grip === null || grip.pointer !== event.pointerId) return;
    const across = event.clientX - grip.from[0];
    const down = event.clientY - grip.from[1];
    // A press that never moved leaves the text where it is, even one that
    // stands partly outside the board.
    if (across === 0 && down === 0) return;
    // An empty field is kept in view too, by the width of one letter.
    const width = Math.max(widthOf(field.current?.value ?? ""), LETTER.size);
    const at = keepInView(
      [grip.at[0] + across, grip.at[1] + down],
      width,
      area,
    );
    setTyping((current) => (current === null ? null : { ...current, at }));
  }

  function onRelease(event: PointerEvent<HTMLDivElement>, held: boolean) {
    const grip = moving.current;
    if (grip === null || grip.pointer !== event.pointerId) return;
    // The place under the pointer now, not under its last move. A pointer
    // taken away by the browser says nothing of where it is, and the text
    // stays where the last move left it.
    if (held) onDrag(event);
    moving.current = null;
    // The handle never takes the focus. Where a browser moves it all the
    // same, the field has it back with the caret where it was.
    const input = field.current;
    if (input !== null && document.activeElement !== input) {
      input.focus();
      input.setSelectionRange(grip.caret[0], grip.caret[1]);
    }
  }

  // A text keeps the colour it was written in while it is rewritten.
  const typingInk = typing?.edited?.ink ?? ink;

  return (
    <div
      className={
        open
          ? "flex min-w-0 flex-none flex-col overflow-hidden rounded-sm border border-neutral-300 bg-white text-neutral-900"
          : "hidden"
      }
      style={{ colorScheme: "light", width: `${share * 100}%` }}
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
          {...stateNotRestored}
          onClick={() => onMarks(undo)}
          title="Ctrl+Z"
        >
          Desfazer
        </button>
        <button
          type="button"
          className={toolClass(false)}
          disabled={shown.length === 0}
          {...stateNotRestored}
          onClick={() => onMarks(clearAll)}
        >
          Apagar tudo
        </button>
        <button
          type="button"
          className={`${toolClass(false)} ml-auto`}
          onClick={() => {
            // The button never took the focus, so a text being typed still
            // has it: confirmed here, or it would come back open and deaf.
            field.current?.blur();
            onClose();
          }}
          title="Tecla Q"
        >
          Fechar
        </button>
      </div>

      <div ref={ground} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvas}
          className={
            tool === "text"
              ? "absolute top-0 left-0 cursor-text touch-none"
              : "absolute top-0 left-0 cursor-crosshair touch-none"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={(event) => {
            // The click and not the press: the press takes the focus from
            // whatever has it, and would close the field it had just opened.
            if (tool !== "text" || pressedWhileTyping.current) return;
            const point = pointOf(event);
            // On a text that stands, the click reopens it where it is; on
            // empty board it begins a new one.
            const edited = textAt(shown, point, widthOf);
            setTyping({ at: edited?.at ?? point, edited });
          }}
        />
        {typing !== null && (
          <input
            ref={field}
            type="text"
            autoFocus
            defaultValue={typing.edited?.text ?? ""}
            aria-label="Texto no quadro"
            className="absolute bg-transparent p-0 outline-1 outline-offset-4 outline-neutral-400 outline-dashed"
            // The same letter the canvas paints, in the same place: the line
            // begins at the point and is centred on it.
            style={{
              left: typing.at[0],
              top: typing.at[1] - LINE / 2,
              width: Math.max(area.width - typing.at[0] - 8, 80),
              height: LINE,
              fontSize: LETTER.size,
              lineHeight: LETTER.line,
              fontFamily: TEXT_FACE,
              fontWeight: TEXT_WEIGHT,
              color: COLOUR[typingInk],
            }}
            // A text reopened is continued from its end.
            onFocus={(event) => {
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
            }}
            onKeyDown={(event) => {
              // A text held by its handle is not closed under the hand.
              if (moving.current !== null) return;
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                // Back to what it was before this turn at the field: nothing
                // for a new text, the words and the place as they stood for
                // one reopened. The flag is up for the length of the blur and
                // no longer, so it is never left standing for the next text.
                discarded.current = true;
                event.currentTarget.blur();
                discarded.current = false;
              }
            }}
            // The one way a text is closed: Enter, a click outside and Escape
            // all end here. Kept, the words and the place go in together, as
            // one mark: one step for undo.
            onBlur={(event) => {
              if (moving.current !== null) return;
              const text = event.currentTarget.value.trim();
              const { at, edited } = typing;
              const kept = !discarded.current;
              if (kept && edited !== null) {
                onMarks((current) =>
                  editText(current, edited.origin, text, at),
                );
              } else if (kept && text !== "") {
                onMarks((current) => [
                  ...current,
                  { kind: "text", ink, at, text },
                ]);
              }
              setTyping(null);
            }}
          />
        )}
        {typing !== null && (
          /*
            The handle the open text is moved by, on the top left corner of
            its outline, and inside the board even when the text is not, so it
            can always be reached. It is an element of its own and holds the
            pointer while dragged, so a drag never reaches the canvas and
            never draws; it does not take the focus, so the field stays open
            and keeps every key.
          */
          <div
            title="Arraste para mover o texto"
            className="absolute flex cursor-grab touch-none items-center justify-center rounded-sm bg-neutral-900 text-white shadow-sm select-none hover:bg-neutral-700 active:cursor-grabbing"
            style={{
              width: GRIP,
              height: GRIP,
              left: Math.max(
                Math.min(typing.at[0] - OUTLINE, area.width - GRIP),
                0,
              ),
              top: Math.max(
                Math.min(
                  typing.at[1] - LINE / 2 - OUTLINE - GRIP,
                  area.height - GRIP,
                ),
                0,
              ),
            }}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={onGrab}
            onPointerMove={onDrag}
            onPointerUp={(event) => onRelease(event, true)}
            onPointerCancel={(event) => onRelease(event, false)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
