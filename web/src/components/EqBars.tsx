import { useEffect, useRef } from 'react';
import { getFrequencyBands, hasAnalyser, usePlayer } from '../store/player';

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
 *
 * Without an analyser (mobile skips Web Audio so background playback keeps
 * working) the loop would animate zeros forever — we render the CSS-animated
 * `.eq` bars instead, which cost nothing on the main thread.
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
  // Not reactive, but the isPlaying subscription re-renders us right after
  // playback starts, which is when the lazy audio graph gets built.
  const analyserReady = hasAnalyser();

  useEffect(() => {
    if (!analyserReady) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const spans = Array.from(wrap.querySelectorAll<HTMLSpanElement>('span'));
    const smooth = new Array(spans.length).fill(idle);
    let raf = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      if (document.hidden) { raf = 0; return; } // resumed by visibilitychange
      const data = isPlaying ? getFrequencyBands(bands) : null;
      for (let i = 0; i < spans.length; i++) {
        const target = data ? Math.max(idle, data[i]) : idle;
        // exp smoothing for buttery bars without per-frame jitter
        smooth[i] += (target - smooth[i]) * 0.28;
        spans[i].style.transform = `scaleY(${smooth[i].toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (!document.hidden && active && raf === 0) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bands, idle, isPlaying, trackId, analyserReady]);

  if (!analyserReady) {
    return (
      <span className={`eq ${className}`} style={{ height, color }} aria-hidden>
        {Array.from({ length: bands }).map((_, i) => (
          <span key={i} style={{ animationPlayState: isPlaying ? 'running' : 'paused' }} />
        ))}
      </span>
    );
  }

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
