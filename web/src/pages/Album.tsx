import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api, coverUrl } from '../api';
import { Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { fmtLongDuration } from '../lib/format';
import { usePlayer } from '../store/player';
import { extractPalette, rgba } from '../lib/color';
import { PlayIcon, PlusIcon, ShuffleIcon } from '../components/icons';

const SparkleIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" />
    <path d="M19 15l.7 1.8L21 17.5l-1.8.7L18.5 20l-.7-1.8L16 17.5l1.8-.7z" />
  </svg>
);

export function AlbumPage() {
  const { id } = useParams();
  const albumId = Number(id);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['album', albumId], queryFn: () => api.album(albumId), enabled: !!albumId });
  const playQueue = usePlayer(s => s.playQueue);
  const enqueue = usePlayer(s => s.enqueue);
  const toggleShuffle = usePlayer(s => s.toggleShuffle);
  const shuffle = usePlayer(s => s.shuffle);
  const [palette, setPalette] = useState<{ p: [number, number, number]; s: [number, number, number] } | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<{ applied: number; skipped: number; noMatch: number; failed: number; total: number; consolidated?: number } | null>(null);

  const runScrape = async () => {
    if (!albumId || scraping) return;
    setScraping(true);
    setScrapeResult(null);
    try {
      const r = await api.enrichAlbum(albumId);
      setScrapeResult(r);
      qc.invalidateQueries({ queryKey: ['album', albumId] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      qc.invalidateQueries({ queryKey: ['artists'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setScraping(false);
    }
  };

  const album = data?.album;
  const tracks = data?.tracks ?? [];

  useEffect(() => {
    if (!album?.id || !album.has_cover) return setPalette(null);
    let cancelled = false;
    extractPalette(coverUrl(album.id, true)).then(pal => {
      if (cancelled) return;
      setPalette({ p: pal.primary, s: pal.secondary });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [album?.id, album?.has_cover]);

  if (!album) {
    return <div className="px-4 sm:px-6 md:px-10 py-6 md:py-10"><div className="cover-shimmer h-[260px] rounded-2xl" /></div>;
  }

  return (
    <div className="relative">
      <motion.div
        key={`bg-${album.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-x-0 top-0 h-[420px] pointer-events-none -z-10"
        style={palette ? {
          background: `linear-gradient(180deg, ${rgba(palette.p, 0.55)} 0%, ${rgba(palette.s, 0.25)} 50%, transparent 100%)`
        } : { background: 'linear-gradient(180deg, rgba(80,60,140,0.4), transparent)' }}
      />
      <div className="px-4 sm:px-6 md:px-10 py-6 md:py-10">
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 sm:items-end mb-6 md:mb-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="shrink-0 self-center sm:self-end"
          >
            <Cover
              albumId={album.id}
              hasCover={album.has_cover}
              alt={album.name}
              className="w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] md:w-[240px] md:h-[240px] shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
              rounded="rounded-xl"
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="min-w-0 pb-1 sm:pb-2 text-center sm:text-left"
          >
            <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>专辑</div>
            <h1 className="text-[26px] md:text-[40px] font-semibold tracking-tight leading-tight mt-1 break-words" title={album.name}>{album.name}</h1>
            <div className="mt-2 md:mt-3 text-[14px] md:text-[15px]" style={{ color: 'var(--color-fg-soft)' }}>
              <span className="font-medium text-white">{album.album_artist}</span>
              {album.year ? <span> · {album.year}</span> : null}
              {album.genre ? <span> · {album.genre}</span> : null}
            </div>
            <div className="text-[12px] md:text-[13px] mt-1" style={{ color: 'var(--color-fg-mute)' }}>
              {tracks.length} 首 · {fmtLongDuration(album.duration ?? 0)}
            </div>
          </motion.div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 mb-5 md:mb-6 flex-wrap">
          <button
            onClick={() => playQueue(tracks)}
            className="flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-white text-black hover:scale-[1.02] active:scale-[0.98] transition shadow-md font-medium text-[13px] md:text-[14px]"
          >
            <PlayIcon width={16} height={16} />播放
          </button>
          <button
            onClick={() => { if (!shuffle) toggleShuffle(); playQueue(tracks); }}
            className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-full border border-white/15 hover:bg-white/[0.05] transition text-[13px] md:text-[14px]"
          >
            <ShuffleIcon width={16} height={16} />随机
          </button>
          <button
            onClick={() => enqueue(tracks)}
            className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-full border border-white/15 hover:bg-white/[0.05] transition text-[13px] md:text-[14px]"
          >
            <PlusIcon width={16} height={16} />加入队列
          </button>
          <button
            onClick={runScrape}
            disabled={scraping}
            className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-full border border-white/15 hover:bg-white/[0.05] transition text-[13px] md:text-[14px] disabled:opacity-50 ml-auto sm:ml-0"
            title="使用 MusicBrainz 自动刮削并填补缺失元数据"
          >
            <SparkleIcon />{scraping ? '刮削中…' : '刮削元数据'}
          </button>
        </div>

        <AnimatePresence>
          {scrapeResult && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-5 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between text-[13px]"
            >
              <div>
                <span className="font-medium">刮削完成</span>
                <span className="ml-3" style={{ color: 'var(--color-fg-soft)' }}>
                  共 {scrapeResult.total} 首 · 已应用 <b className="text-white">{scrapeResult.applied}</b>
                  {scrapeResult.skipped > 0 && <> · 信心不足跳过 <b className="text-white">{scrapeResult.skipped}</b></>}
                  {scrapeResult.noMatch > 0 && <> · 无匹配 <b className="text-white">{scrapeResult.noMatch}</b></>}
                  {scrapeResult.failed > 0 && <> · 失败 <b className="text-red-400">{scrapeResult.failed}</b></>}
                  {scrapeResult.consolidated && scrapeResult.consolidated > 0 ? <> · 同目录归并 <b className="text-white">{scrapeResult.consolidated}</b></> : null}
                </span>
              </div>
              <button onClick={() => setScrapeResult(null)} className="text-[12px] hover:underline" style={{ color: 'var(--color-fg-mute)' }}>关闭</button>
            </motion.div>
          )}
        </AnimatePresence>

        <TrackList tracks={tracks} />
      </div>
    </div>
  );
}
