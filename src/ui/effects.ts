// ── effects.ts ── Smooth animation primitives for Ink TUI ───────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Spinner presets ────────────────────────────────────────────────────────────

export const SPINNERS = {
  braille:  { frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], interval: 80 },
  dots:     { frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], interval: 80 },
  line:     { frames: ['-', '\\', '|', '/'], interval: 120 },
  bounce:   { frames: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'], interval: 80 },
  pulse:    { frames: ['◆', '◇', '◈', '◉', '●', '◉', '◈', '◇'], interval: 100 },
  wave:     { frames: [' ngạc', ' ∙ ', ' • ', '  •', ' • ', ' ∙ '], interval: 150 },
  grow:     { frames: ['▁', '▃', '▄', '▅', '▆', '▇', '▆', '▅', '▄', '▃'], interval: 60 },
} as const;

export type SpinnerPreset = keyof typeof SPINNERS;

/**
 * Animated spinner hook. Returns the current frame character.
 * @param active - whether the spinner should animate
 * @param preset - spinner style
 */
export function useSpinner(active: boolean, preset: SpinnerPreset = 'braille'): string {
  const { frames, interval } = SPINNERS[preset];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), interval);
    return () => clearInterval(id);
  }, [active, frames.length, interval]);

  return active ? frames[frame] : '';
}

// ── Blinking cursor ────────────────────────────────────────────────────────────

/**
 * Returns '▌' or ' ' at ~530ms cadence. Returns '' when inactive.
 */
export function useBlinkCursor(active: boolean): string {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) { setOn(true); return; }
    const id = setInterval(() => setOn((v) => !v), 530);
    return () => { clearInterval(id); setOn(true); };
  }, [active]);
  return active ? (on ? '▌' : ' ') : '';
}

// ── Animated dots ──────────────────────────────────────────────────────────────

/**
 * "Thinking" → "Thinking." → "Thinking.." → "Thinking..."
 * Returns the label with the current dot count.
 */
export function useAnimatedDots(label: string, active: boolean, speed = 400): string {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    if (!active) { setDots(0); return; }
    const id = setInterval(() => setDots((d) => (d + 1) % 4), speed);
    return () => { clearInterval(id); setDots(0); };
  }, [active, speed]);
  return active ? label + '.'.repeat(dots) : label;
}

// ── Smooth character reveal ────────────────────────────────────────────────────

/**
 * Reveals a string character-by-character. Returns the visible prefix.
 * Useful for "entry" animations on new messages.
 */
export function useReveal(text: string, speed = 8): string {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (visible >= text.length) return;
    const id = setInterval(() => {
      setVisible((v) => {
        const next = v + speed;
        return next >= text.length ? text.length : next;
      });
    }, 16); // ~60fps
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, visible);
}

// ── Batched text accumulator (smooth streaming) ────────────────────────────────

/**
 * Accumulates streamed text chunks and flushes to state at a fixed interval
 * for smooth visual updates without per-chunk React re-render storms.
 */
export function useBatchedText(speed = 30): {
  /** Push a new chunk into the buffer */
  push: (chunk: string) => void;
  /** Current visible text */
  text: string;
  /** Whether there are pending (unflushed) chars */
  flushing: boolean;
  /** Reset the accumulator */
  reset: () => void;
} {
  const bufferRef = useRef('');
  const flushedRef = useRef('');
  const [text, setText] = useState('');
  const [, setTick] = useState(0); // force re-render

  const push = useCallback((chunk: string) => {
    bufferRef.current += chunk;
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = '';
    flushedRef.current = '';
    setText('');
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (bufferRef.current.length > 0) {
        flushedRef.current += bufferRef.current;
        bufferRef.current = '';
        setText(flushedRef.current);
        setTick((t) => t + 1);
      }
    }, speed);
    return () => clearInterval(id);
  }, [speed]);

  return {
    push,
    text,
    flushing: bufferRef.current.length > 0,
    reset,
  };
}

// ── Pulse glow effect ─────────────────────────────────────────────────────────

/**
 * Returns a color string that pulses between two colors.
 * Useful for highlighting active elements.
 */
export function usePulse(color1: string, color2: string, speed = 600): string {
  const [state, setState] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setState((s) => !s), speed);
    return () => clearInterval(id);
  }, [speed]);
  return state ? color1 : color2;
}

// ── Progress bar ───────────────────────────────────────────────────────────────

/**
 * Renders an ASCII progress bar: [████████░░░░░░░░░░░░] 40%
 * Returns the formatted string.
 */
export function renderProgressBar(
  current: number,
  total: number,
  width = 20,
  filledChar = '█',
  emptyChar = '░'
): string {
  const ratio = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return filledChar.repeat(filled) + emptyChar.repeat(empty) + ` ${pct}%`;
}

// ── Smooth fade-in via ANSI ────────────────────────────────────────────────────

/**
 * Returns a string wrapped in ANSI dim-to-normal transition.
 * Approximates a "fade in" effect in terminals that support it.
 */
export function fadeIn(text: string, step: number): string {
  // step 0-4, 0=dim, 4=full
  if (step >= 4) return text;
  return text; // Ink handles styling via props; this is a marker for callers
}

// ── Typing speed estimator ─────────────────────────────────────────────────────

/**
 * Estimates "reading time" for a given text (like a human typing indicator).
 */
export function typingEstimate(text: string, wpm = 60): number {
  const words = text.split(/\s+/).length;
  return Math.ceil((words / wpm) * 60) * 1000; // ms
}
