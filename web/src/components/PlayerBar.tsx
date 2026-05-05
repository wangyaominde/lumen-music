import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { coverUrl } from '../api';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { fmtDuration, qualityLabel } from '../lib/format';
import { Cover } from './Cover';
import {
  PlayIcon, PauseIcon, PrevIcon, NextIcon,
  ShuffleIcon, RepeatIcon, RepeatOneIcon,
  VolumeIcon, MuteIcon, QueueIcon, HeartIcon, ChevronDown
} from './icons';
import { api } from '../api';

export function PlayerBar() {
  const queue = usePlayer(s => s.queue);
  const index = usePlayer(s => s.index);
  const isPlaying = usePlayer(s => s.isPlaying);
  const currentTime = usePlayer(s => s.currentTime);
  const duration = usePlayer(s => s.duration);
  const volume = usePlayer(s => s.volume);
  const muted = usePlayer(s => s.muted);
  const repeat = usePlayer(s => s.repeat);
  const shuffle = usePlayer(s => s.shuffle);
  const toggle = usePlayer(s => s.toggle);
  const next = usePlayer(s => s.next);
  const prev = usePlayer(s => s.prev);
  const seek = usePlayer(s => s.seek);
  const setVolume = usePlayer(s => s.setVolume);
  const toggleMute = usePlayer(s => s.toggleMute);
  const cycleRepeat = usePlayer(s => s.cycleRepeat);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);

  const setNowPlaying = useUI(s => s.setNowPlaying);
  const toggleQueue = useUI(s => s.toggleQueue);

  const track = queue[index];
  const [isFavorited, setFavorited] = useState(false);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    api.favoriteIds().then(ids => { if (!cancelled) setFavorited(ids.includes(track.id)); });
    return () => { cancelled = true; };
  }, [track?.id]);

  useEffect(() => {
    if (!track) return;
    if ('mediaSession' in navigator) {
      const url = track.album_id ? coverUrl(track.album_id, true) : '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist_name,
        album: track.album_name,
        artwork: url ? [{ src: url, sizes: '512x512' }] : []
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [track?.id, isPlaying]);

  if (!track) {
    return (
      <div className="h-[88px] glass border-t border-white/5 flex items-center px-6 text-fg-mute" style={{ color: 'var(--color-fg-mute)' }}>
        <span className="text-sm">从专辑或搜索开始播放音乐</span>
      </div>
    );
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-[88px] glass border-t border-white/5 flex items-center px-3 gap-4 relative">
      <div className="flex items-center gap-3 min-w-0 w-[300px]">
        <button
          className="relative shrink-0 group cursor-pointer"
          onClick={() => setNowPlaying(true)}
          aria-label="打开正在播放"
        >
          <Cover albumId={track.album_id} hasCover={true} className="w-14 h-14" />
          <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition rounded-[10px]">
            <ChevronDown width={20} height={20} style={{ transform: 'rotate(180deg)' }} />
          </span>
        </button>
        <div className="min-w-0">
          <div className="text-[14px] font-medium truncate">{track.title}</div>
          <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{track.artist_name}</div>
        </div>
        <button
          className="btn-icon w-8 h-8 shrink-0"
          data-active={isFavorited}
          aria-label={isFavorited ? '取消收藏' : '收藏'}
          onClick={async () => {
            if (isFavorited) {
              await api.removeFavorite(track.id);
              setFavorited(false);
            } else {
              await api.addFavorite(track.id);
              setFavorited(true);
            }
          }}
        >
          <HeartIcon filled={isFavorited} width={16} height={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-1.5">
        <div className="flex items-center gap-1">
          <button className="btn-icon w-9 h-9" data-active={shuffle} onClick={toggleShuffle} aria-label="随机播放">
            <ShuffleIcon width={16} height={16} />
          </button>
          <button className="btn-icon w-9 h-9" onClick={prev} aria-label="上一首">
            <PrevIcon width={18} height={18} />
          </button>
          <button
            className="w-10 h-10 rounded-full bg-white text-black grid place-items-center hover:scale-105 active:scale-95 transition shadow-md"
            onClick={toggle}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={isPlaying ? 'pause' : 'play'}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="grid place-items-center"
              >
                {isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} style={{ transform: 'translateX(1px)' }} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button className="btn-icon w-9 h-9" onClick={() => next()} aria-label="下一首">
            <NextIcon width={18} height={18} />
          </button>
          <button className="btn-icon w-9 h-9" data-active={repeat !== 'off'} onClick={cycleRepeat} aria-label="循环模式">
            {repeat === 'one' ? <RepeatOneIcon width={16} height={16} /> : <RepeatIcon width={16} height={16} />}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full max-w-[640px]">
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-fg-mute)' }}>{fmtDuration(currentTime)}</span>
          <input
            type="range"
            className="range-slim flex-1"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={e => seek(Number(e.target.value))}
            style={{ ['--progress' as any]: `${pct}%` }}
          />
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-fg-mute)' }}>{fmtDuration(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-[300px] justify-end">
        <span className="text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border border-white/15" style={{ color: 'var(--color-fg-soft)' }}>
          {qualityLabel({ lossless: track.lossless, codec: track.codec, bitrate: track.bitrate, bit_depth: track.bit_depth, sample_rate: track.sample_rate })}
        </span>
        <button className="btn-icon w-9 h-9" onClick={toggleQueue} aria-label="队列">
          <QueueIcon width={18} height={18} />
        </button>
        <button className="btn-icon w-8 h-8" onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'}>
          {muted || volume === 0 ? <MuteIcon width={16} height={16} /> : <VolumeIcon width={16} height={16} />}
        </button>
        <input
          type="range"
          className="range-slim w-24"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={e => setVolume(Number(e.target.value))}
          style={{ ['--progress' as any]: `${(muted ? 0 : volume) * 100}%` }}
        />
      </div>
    </div>
  );
}
