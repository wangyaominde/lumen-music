import { useEffect, useRef } from 'react';
import { getFrequencyBands, usePlayer } from '../store/player';

interface Props {
  bands?: number;
  className?: string;
  color?: string;
  /** Pixel height of the container, drives bar geometry. */
  height?: number;
  /** Idle minimum scale when no signal (keeps bars visible). */
  idle?: number;
}

/**
 * Real-time analyser-driven equalizer. Mutates DOM via rAF without
 * re-rendering React. Costs ~ O(fftSize) per frame; one shared
 * AudioContext + AnalyserNode regardless of how many instances.
 */
export function EqBars({
  bands = 4,
  className = '',
  color = 'currentColor',
  height = 12,
  idle = 0.18
}: Props) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  // Subscribe so we pause rAF when not playing — saves frames.
  const isPlaying = usePlayer(s => s.isPlaying);
  const trackId = usePlayer(s => s.queue[s.index]?.id);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const spans = Array.from(wrap.querySelectorAll<HTMLSpanElement>('span'));
    const smooth = new Array(spans.length).fill(idle);
    let raf = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      const data = isPlaying ? getFrequencyBands(bands) : null;
      for (let i = 0; i < spans.length; i++) {
        const target = data ? Math.max(idle, data[i]) : idle;
        // exp smoothing for buttery bars without per-frame jitter
        smooth[i] += (target - smooth[i]) * 0.28;
        spans[i].style.transform = `scaleY(${smooth[i].toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [bands, idle, isPlaying, trackId]);

  return (
    <span
      ref={wrapRef}
      className={`inline-flex items-end gap-[2px] ${className}`}
      style={{ height, color }}
      aria-hidden
    >
      {Array.from({ length: bands }).map((_, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 2,
            height: '100%',
            background: 'currentColor',
            borderRadius: 999,
            transformOrigin: 'bottom',
            willChange: 'transform',
            transform: `scaleY(${idle})`
          }}
        />
      ))}
    </span>
  );
}
