import { useId } from "react";

import { SCENE_PALETTES } from "@/lib/brand-scene";
import { postmarkFor, type DayPart } from "@/lib/brand-time";

// A round postmark inked onto the painting's stamp: today's service round the
// top, the weekday round the bottom, the date in the middle, and a few wavy
// cancellation lines trailing off. It lands with a small "thump" once the
// painting has painted itself in (--animate-brand-stamp's delay).
//
// Decoration only (aria-hidden) — the date is a nicety, never the only place
// anything is said. Rendered only after mount (the caller holds it back until
// useNow has a time), so the server never guesses the date. The ink is the
// palette's own, chosen per sky so it shows; an SVG filter roughens and
// speckles it like a real rubber stamp.

/** The SVG's own frame: the ring sits in the left 100×100, the wavy lines
 *  trail off to the right. */
const VIEW_W = 150;
const VIEW_H = 100;
const CX = 50;
const CY = 50;
const RING_OUTER = 44;
const RING_INNER = 29;
/** Baselines for the ring's words. The top text stands OUTWARD from its arc,
 *  the bottom text hangs INWARD from its own, so both sit inside the band. */
const TOP_TEXT_R = 34;
const BOTTOM_TEXT_R = 39.5;
const TILT_DEG = -9;
const WAVE_ROWS = [35, 45, 55, 65] as const;
const WAVE_FROM_X = 97;
const WAVE_STEP = 6;
const WAVE_STEPS = 8;
const WAVE_AMP = 2.2;
const INK_OPACITY = 0.85;

/** An arc of radius r across the ring's middle, left to right: over the top
 *  (sweep 1) or under the bottom (sweep 0). */
function arc(r: number, sweep: 0 | 1): string {
  return `M ${CX - r},${CY} A ${r},${r} 0 0 ${sweep} ${CX + r},${CY}`;
}

function wave(y: number): string {
  let d = `M ${WAVE_FROM_X},${y} q ${WAVE_STEP / 2},${-WAVE_AMP} ${WAVE_STEP},0`;
  for (let i = 1; i < WAVE_STEPS; i++) d += ` t ${WAVE_STEP},0`;
  return d;
}

export function Postmark({ now, dayPart, className }: { now: Date; dayPart: DayPart; className?: string }) {
  // SVG ids are document-global; useId keeps two postmarks from sharing one.
  const id = `pm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const text = postmarkFor(now);
  const [r, g, b] = SCENE_PALETTES[dayPart].postmark;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={className}
      style={{ color: `rgb(${r} ${g} ${b})`, transformOrigin: `${(CX / VIEW_W) * 100}% 50%` }}
    >
      <defs>
        <path id={`${id}-top`} d={arc(TOP_TEXT_R, 1)} />
        <path id={`${id}-bottom`} d={arc(BOTTOM_TEXT_R, 0)} />
        {/* Rubber-stamp ink: the edges wobble (displacement) and the ink
            misses in small speckles (the noise's alpha cuts holes). */}
        <filter id={`${id}-ink`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.4" result="speckle" />
          <feComposite in="rough" in2="speckle" operator="in" />
        </filter>
      </defs>

      <g
        filter={`url(#${id}-ink)`}
        opacity={INK_OPACITY}
        transform={`rotate(${TILT_DEG} ${CX} ${CY})`}
        fill="currentColor"
        stroke="currentColor"
      >
        <circle cx={CX} cy={CY} r={RING_OUTER} fill="none" strokeWidth="2.2" />
        <circle cx={CX} cy={CY} r={RING_INNER} fill="none" strokeWidth="1.1" />
        <circle cx={CX - (RING_OUTER + RING_INNER) / 2} cy={CY} r="1.4" stroke="none" />
        <circle cx={CX + (RING_OUTER + RING_INNER) / 2} cy={CY} r="1.4" stroke="none" />

        <g stroke="none" fontWeight={600} letterSpacing="1.1" fontSize="7">
          <text>
            <textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">
              {text.service}
            </textPath>
          </text>
          <text>
            <textPath href={`#${id}-bottom`} startOffset="50%" textAnchor="middle">
              {text.weekday}
            </textPath>
          </text>
        </g>

        <text x={CX} y={CY + 3} textAnchor="middle" stroke="none" fontSize="14" fontWeight={700} letterSpacing="0.3">
          {text.dayMonth}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" stroke="none" fontSize="8" fontWeight={600} letterSpacing="1.5">
          {text.year}
        </text>

        {WAVE_ROWS.map((y) => (
          <path key={y} d={wave(y)} fill="none" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
}
