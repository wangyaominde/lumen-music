import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../store/ui';
import { usePlayer } from '../store/player';
import { coverUrl } from '../api';
import { Cover } from './Cover';
import {
  ChevronDown, PlayIcon, PauseIcon, PrevIcon, NextIcon,
  ShuffleIcon, RepeatIcon, RepeatOneIcon, HeartIcon, ListIcon,
  VolumeIcon, MuteIcon
} from './icons';
import { fmtDuration, qualityLabel } from '../lib/format';
import { extractPalette, rgba } from '../lib/color';
import { activeLrcIndex, parseLrc, type LrcLine } from '../lib/lrc';
import { api } from '../api';

export function NowPlaying() {
  const open = useUI(s => s.nowPlayingOpen);
  const setOpen = useUI(s => s.setNowPlaying);
  const toggleQueue = useUI(s => s.toggleQueue);
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

  const track = queue[index];
  const [palette, setPalette] = useState<{ p: [number, number, number]; s: [number, number, number]; fg: [number, number, number] } | null>(null);
  const [favorited, setFavorited] = useState(false);
  const [lrc, setLrc] = useState<LrcLine[] | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!track?.album_id) { setPalette(null); return; }
    let cancelled = false;
    extractPalette(coverUrl(track.album_id, true))
      .then(pal => { if (!cancelled) setPalette({ p: pal.primary, s: pal.secondary, fg: pal.fg }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [track?.album_id]);

  useEffect(() => {
    if (!track) { setLrc(null); return; }
    let cancelled = false;
    api.lyrics(track.id)
      .then(r => { if (!cancelled) setLrc(parseLrc(r.content)); })
      .catch(() => { if (!cancelled) setLrc(null); });
    return () => { cancelled = true; };
  }, [track?.id]);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    api.favoriteIds().then(ids => { if (!cancelled) setFavorited(ids.includes(track.id)); });
    return () => { cancelled = true; };
  }, [track?.id]);

  // (Global keyboard shortcuts now live in App.tsx so they work on every page.)

  const lrcIdx = useMemo(() => (lrc ? activeLrcIndex(lrc, currentTime + 0.15) : -1), [lrc, currentTime]);

  useEffect(() => {
    if (!lyricsRef.current || lrcIdx < 0) return;
    const el = lyricsRef.current.querySelector<HTMLElement>(`[data-lrc-idx="${lrcIdx}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [lrcIdx]);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          initial={{ y: '100%', pointerEvents: 'none' as const }}
          animate={{ y: 0, pointerEvents: 'auto' as const }}
          exit={{ y: '100%', pointerEvents: 'none' as const }}
          transition={{ type: 'tween', duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ background: 'var(--color-bg)' }}
        >
          {/* Animated gradient background */}
          <div className="absolute inset-0 -z-10">
            <div
              className="absolute inset-0 drift"
              style={palette ? {
                background: `radial-gradient(circle at 30% 30%, ${rgba(palette.p, 0.85)} 0%, transparent 55%), radial-gradient(circle at 70% 70%, ${rgba(palette.s, 0.7)} 0%, transparent 55%), #050507`
              } : { background: 'radial-gradient(circle at 30% 30%, rgba(120,90,200,0.7), transparent 55%), #050507' }}
            />
            {track.album_id && (
              <img
                src={coverUrl(track.album_id, true)}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-25 drift"
                style={{ filter: 'blur(70px) saturate(1.6)', transform: 'scale(1.15)' }}
              />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55))' }} />
          </div>

          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-5 relative z-10">
            <button onClick={() => setOpen(false)} className="btn-icon w-10 h-10" aria-label="收起">
              <ChevronDown width={20} height={20} />
            </button>
            <div className="text-center">
              <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.6)' }}>正在播放</div>
              <div className="text-[13px] mt-0.5">{track.album_name}</div>
            </div>
            <button onClick={toggleQueue} className="btn-icon w-10 h-10" aria-label="队列">
              <ListIcon width={20} height={20} />
            </button>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-12 px-12 pb-12 h-[calc(100%-72px)]">
            <div className="flex flex-col items-center justify-center min-h-0">
              <motion.div
                key={track.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                className="relative shrink-0"
                style={{ filter: 'drop-shadow(0 36px 72px rgba(0,0,0,0.55))' }}
              >
                <Cover
                  albumId={track.album_id}
                  hasCover={true}
                  alt={track.album_name}
                  className="w-[min(38vh,360px)] h-[min(38vh,360px)]"
                  rounded="rounded-2xl"
                />
              </motion.div>

              <div className="mt-8 w-full max-w-[640px] text-center">
                <motion.div
                  key={`title-${track.id}`}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.45 }}
                  className="text-[28px] font-semibold tracking-tight"
                >
                  {track.title}
                </motion.div>
                <div className="mt-1 text-[15px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {track.artist_name} · {track.album_name}
                </div>

                <div className="mt-7 flex items-center gap-3">
                  <span className="text-[11px] tabular-nums w-10 text-right" style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtDuration(currentTime)}</span>
                  <input
                    type="range"
                    className="range-slim flex-1"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={e => seek(Number(e.target.value))}
                    style={{ ['--progress' as any]: `${pct}%`, ['--track-color' as any]: 'rgba(255,255,255,0.95)' }}
                  />
                  <span className="text-[11px] tabular-nums w-10" style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtDuration(duration)}</span>
                </div>

                <div className="mt-5 flex items-center justify-center gap-2">
                  <button className="btn-icon w-11 h-11" data-active={shuffle} onClick={toggleShuffle} aria-label="随机播放">
                    <ShuffleIcon width={18} height={18} />
                  </button>
                  <button className="btn-icon w-12 h-12" onClick={prev} aria-label="上一首">
                    <PrevIcon width={22} height={22} />
                  </button>
                  <button
                    className="w-16 h-16 rounded-full grid place-items-center bg-white text-black hover:scale-105 active:scale-95 transition shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
                    onClick={toggle}
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={isPlaying ? 'pause' : 'play'}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ duration: 0.12 }}
                      >
                        {isPlaying ? <PauseIcon width={26} height={26} /> : <PlayIcon width={26} height={26} style={{ transform: 'translateX(2px)' }} />}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                  <button className="btn-icon w-12 h-12" onClick={() => next()} aria-label="下一首">
                    <NextIcon width={22} height={22} />
                  </button>
                  <button className="btn-icon w-11 h-11" data-active={repeat !== 'off'} onClick={cycleRepeat} aria-label="循环">
                    {repeat === 'one' ? <RepeatOneIcon width={18} height={18} /> : <RepeatIcon width={18} height={18} />}
                  </button>
                </div>

                <div className="mt-6 flex items-center justify-center gap-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <span className="px-2.5 py-1 rounded-full border border-white/15">
                    {qualityLabel({ lossless: track.lossless, codec: track.codec, bitrate: track.bitrate, bit_depth: track.bit_depth, sample_rate: track.sample_rate })}
                  </span>
                  <button
                    className="btn-icon w-9 h-9"
                    data-active={favorited}
                    onClick={async () => {
                      if (favorited) { await api.removeFavorite(track.id); setFavorited(false); }
                      else { await api.addFavorite(track.id); setFavorited(true); }
                    }}
                    aria-label="收藏"
                  >
                    <HeartIcon filled={favorited} width={18} height={18} />
                  </button>
                  <button className="btn-icon w-9 h-9" onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'}>
                    {muted || volume === 0 ? <MuteIcon width={16} height={16} /> : <VolumeIcon width={16} height={16} />}
                  </button>
                  <input
                    type="range"
                    className="range-slim w-28"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={e => setVolume(Number(e.target.value))}
                    style={{ ['--progress' as any]: `${(muted ? 0 : volume) * 100}%`, ['--track-color' as any]: 'rgba(255,255,255,0.95)' }}
                  />
                </div>
              </div>
            </div>

            <div ref={lyricsRef} className="overflow-y-auto pr-2 lg:flex hidden flex-col" style={{ maskImage: 'linear-gradient(180deg, transparent 0%, black 12%, black 88%, transparent 100%)', WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, black 12%, black 88%, transparent 100%)' }}>
              {lrc && lrc.length > 0 ? (
                <div className="flex flex-col gap-3 py-[40%]">
                  {lrc.map((l, i) => (
                    <div
                      key={i}
                      data-lrc-idx={i}
                      className="text-[18px] leading-snug transition-all duration-300"
                      style={{
                        opacity: i === lrcIdx ? 1 : 0.45,
                        transform: i === lrcIdx ? 'translateX(8px)' : 'none',
                        fontWeight: i === lrcIdx ? 600 : 400,
                        color: i === lrcIdx ? '#fff' : 'rgba(255,255,255,0.6)',
                        textShadow: i === lrcIdx ? '0 0 24px rgba(255,255,255,0.15)' : 'none'
                      }}
                    >
                      {l.text || '♪'}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 grid place-items-center text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <div>
                    <div className="mb-2">没有同步歌词</div>
                    <div className="text-[11px]">把同名 .lrc 文件放在歌曲旁边即可显示</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
