import { useState } from 'react';
import { usePlayer } from '../store/player';
import { fmtDuration } from '../lib/format';

interface Props {
  className?: string;
  /** Color for the elapsed / total labels. */
  timeColor?: string;
  /** Filled-track color forwarded to the slider. */
  trackColor?: string;
  /** Extra classes applied to both time labels (e.g. a fixed width). */
  timeClass?: string;
}

/**
 * Progress slider + elapsed/total labels. Isolated in its own leaf so the
 * 4Hz timeupdate re-render stays here instead of re-rendering the whole
 * player bar / now-playing overlay.
 *
 * Seeks commit on release, not per input event — a drag fires dozens of
 * change events, and in transcode mode every seek() is a full source reload
 * plus a server-side ffmpeg spawn.
 */
export function SeekBar({ className = '', timeColor = 'var(--color-fg-mute)', trackColor, timeClass = '' }: Props) {
  const currentTime = usePlayer(s => s.currentTime);
  const duration = usePlayer(s => s.duration);
  const seek = usePlayer(s => s.seek);
  // Non-null while the user is dragging: the slider shows the drag position
  // instead of the (still-advancing) playback position.
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? currentTime;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;

  const commit = () => {
    if (scrub === null) return;
    seek(scrub);
    setScrub(null);
  };

  return (
    <div className={`flex items-center ${className}`}>
      <span className={`text-[11px] tabular-nums text-right ${timeClass}`} style={{ color: timeColor }}>{fmtDuration(shown)}</span>
      <input
        type="range"
        className="range-slim flex-1"
        min={0}
        max={duration || 0}
        step={0.1}
        value={shown}
        onChange={e => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{
          ['--progress' as any]: `${pct}%`,
          ...(trackColor ? { ['--track-color' as any]: trackColor } : {})
        }}
      />
      <span className={`text-[11px] tabular-nums ${timeClass}`} style={{ color: timeColor }}>{fmtDuration(duration)}</span>
    </div>
  );
}

/** Thin read-only progress strip (mobile player bar top edge). Same leaf isolation. */
export function ProgressStrip({ className = '' }: { className?: string }) {
  const currentTime = usePlayer(s => s.currentTime);
  const duration = usePlayer(s => s.duration);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <div className={`h-[2px] bg-white/[0.05] ${className}`}>
      <div className="h-full bg-white/80 transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  );
}
