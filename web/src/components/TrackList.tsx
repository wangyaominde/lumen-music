import { useState } from 'react';
import type { Track } from '../api/types';
import { fmtDuration, qualityLabel } from '../lib/format';
import { usePlayer } from '../store/player';
import { PlayIcon } from './icons';
import { EqBars } from './EqBars';
import { EnrichDialog } from './EnrichDialog';

interface Props {
  tracks: Track[];
  showAlbum?: boolean;
  numberByIndex?: boolean;
}

const SPARKLE = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" />
    <path d="M19 15l.7 1.8L21 17.5l-1.8.7L18.5 20l-.7-1.8L16 17.5l1.8-.7z" />
  </svg>
);

export function TrackList({ tracks, showAlbum, numberByIndex }: Props) {
  const playQueue = usePlayer(s => s.playQueue);
  const currentTrackId = usePlayer(s => s.queue[s.index]?.id);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);

  // Two grid templates: one tight for mobile (no quality / album columns),
  // one full for >=md.
  const mobileCols = 'grid-cols-[28px_minmax(0,1fr)_44px_28px]';
  const desktopCols = showAlbum
    ? 'md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1.4fr)_84px_60px_36px]'
    : 'md:grid-cols-[40px_minmax(0,1fr)_84px_60px_36px]';

  return (
    <>
      <div className="text-sm">
        <div
          className={`hidden md:grid ${desktopCols} gap-3 px-3 py-2 text-[11px] uppercase tracking-[0.16em] border-b border-white/5`}
          style={{ color: 'var(--color-fg-mute)' }}
        >
          <span className="text-right">#</span>
          <span>标题</span>
          {showAlbum && <span>专辑</span>}
          <span>质量</span>
          <span>时长</span>
          <span />
        </div>
        {tracks.map((t, i) => {
          const active = t.id === currentTrackId;
          return (
            <div
              key={t.id}
              className={`grid ${mobileCols} ${desktopCols} gap-2 md:gap-3 px-2 md:px-3 py-2 row-hover rounded-md group cursor-pointer items-center`}
              onDoubleClick={() => playQueue(tracks, i)}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, a')) return;
                playQueue(tracks, i);
              }}
            >
              <div className="text-right tabular-nums relative" style={{ color: active ? 'var(--color-accent)' : 'var(--color-fg-mute)' }}>
                <span className="md:group-hover:hidden">
                  {active ? (
                    <EqBars className="ml-auto" color="var(--color-accent)" height={12} bands={4} />
                  ) : (
                    numberByIndex ? i + 1 : (t.track_no ?? i + 1)
                  )}
                </span>
                <button
                  className="hidden md:group-hover:inline-flex w-6 h-6 items-center justify-center rounded-full text-white"
                  onClick={(e) => { e.stopPropagation(); playQueue(tracks, i); }}
                  aria-label="播放"
                >
                  <PlayIcon width={14} height={14} />
                </button>
              </div>
              <div className="min-w-0">
                <div className={`truncate ${active ? 'text-[var(--color-accent)]' : ''}`}>{t.title}</div>
                <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>
                  {t.artist_name}
                  {/* Album name folded into the subtitle on mobile when showAlbum is requested */}
                  {showAlbum && <span className="md:hidden"> · {t.album_name}</span>}
                </div>
              </div>
              {showAlbum && (
                <div className="hidden md:block text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{t.album_name}</div>
              )}
              <div className="hidden md:block text-[11px]" style={{ color: 'var(--color-fg-soft)' }}>
                {qualityLabel({ lossless: t.lossless, codec: t.codec, bitrate: t.bitrate, bit_depth: t.bit_depth, sample_rate: t.sample_rate })}
              </div>
              <div className="text-[11px] md:text-[12px] tabular-nums text-right md:text-left" style={{ color: 'var(--color-fg-soft)' }}>{fmtDuration(t.duration ?? 0)}</div>
              <button
                className="btn-icon w-7 h-7 opacity-60 md:opacity-50 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); setEnrichingId(t.id); }}
                aria-label="刮削此曲"
                title="刮削此曲：从 MusicBrainz / 网易云查找候选"
              >
                {SPARKLE}
              </button>
            </div>
          );
        })}
      </div>
      <EnrichDialog trackId={enrichingId} onClose={() => setEnrichingId(null)} />
    </>
  );
}
