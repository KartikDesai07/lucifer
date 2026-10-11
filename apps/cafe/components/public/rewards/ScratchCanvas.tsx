"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import {
  clampDpr,
  clearedFraction,
  makeGrid,
  markStroke,
  SCRATCH_BRUSH_PX,
  SCRATCH_REVEAL_FRACTION,
  SCRATCH_SAMPLE_MS,
  type CellGrid,
  type Point,
} from "@/components/public/rewards/scratch-math";
import { FALLBACK_FOIL, FALLBACK_FOIL_TEXT, readThemeColour } from "@/components/public/rewards/theme-colour";

// CB-7 S4 — the scratch foil: the cafe's own brand colour with a light diagonal pattern, drawn on a canvas and wiped
// with a finger or mouse (Pointer Events). Loaded ONLY through next/dynamic (ssr: false) by PublicScratchSheet.
// It never reads pixels back: progress is a coarse cell grid (scratch-math.ts). Remount (a new `key`) = fresh foil.

const FOIL_STRIPE_GAP_PX = 14;
const FOIL_STRIPE_WIDTH_PX = 2;
const FOIL_STRIPE_ALPHA = 0.16;
const FOIL_HINT_ALPHA = 0.92;
const FOIL_HINT_FONT = "600 16px system-ui, sans-serif";

interface ScratchCanvasProps {
  hint: string;
  onFirstScratch: () => void;
  onEnough: () => void;
}

function paintFoil(ctx: CanvasRenderingContext2D, width: number, height: number, hint: string): void {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = readThemeColour("--primary", FALLBACK_FOIL);
  ctx.fillRect(0, 0, width, height);
  const ink = readThemeColour("--primary-foreground", FALLBACK_FOIL_TEXT);
  ctx.strokeStyle = ink;
  ctx.lineWidth = FOIL_STRIPE_WIDTH_PX;
  ctx.globalAlpha = FOIL_STRIPE_ALPHA;
  for (let offset = -height; offset < width; offset += FOIL_STRIPE_GAP_PX) {
    ctx.beginPath();
    ctx.moveTo(offset, height);
    ctx.lineTo(offset + height, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = FOIL_HINT_ALPHA;
  ctx.fillStyle = ink;
  ctx.font = FOIL_HINT_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hint, width / 2, height / 2);
  ctx.globalAlpha = 1;
}

export default function ScratchCanvas({ hint, onFirstScratch, onEnough }: ScratchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<CellGrid | null>(null);
  const lastRef = useRef<Point | null>(null);
  const startedRef = useRef(false);
  const enoughRef = useRef(false);
  const sampledAtRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const dpr = clampDpr(window.devicePixelRatio);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFoil(ctx, width, height, hint);
    gridRef.current = makeGrid(width, height);
  }, [hint]);

  function pointOf(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? canvas.offsetWidth / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  function wipe(e: ReactPointerEvent<HTMLCanvasElement>, from: Point | null, to: Point): void {
    const ctx = e.currentTarget.getContext("2d");
    const grid = gridRef.current;
    if (!ctx || !grid) return;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = SCRATCH_BRUSH_PX;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo((from ?? to).x, (from ?? to).y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    markStroke(grid, from, to);
  }

  function checkEnough(force: boolean): void {
    const grid = gridRef.current;
    if (!grid || enoughRef.current) return;
    const now = performance.now();
    if (!force && now - sampledAtRef.current < SCRATCH_SAMPLE_MS) return;
    sampledAtRef.current = now;
    if (clearedFraction(grid) >= SCRATCH_REVEAL_FRACTION) {
      enoughRef.current = true;
      onEnough();
    }
  }

  function handleDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!startedRef.current) {
      startedRef.current = true;
      onFirstScratch();
    }
    const point = pointOf(e);
    lastRef.current = point;
    wipe(e, null, point);
  }

  function handleMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (lastRef.current === null) return;
    const point = pointOf(e);
    wipe(e, lastRef.current, point);
    lastRef.current = point;
    checkEnough(false);
  }

  function handleUp(): void {
    lastRef.current = null;
    checkEnough(true);
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full touch-none rounded-2xl"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    />
  );
}
