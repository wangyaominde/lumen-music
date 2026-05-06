import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { fmtLongDuration } from '../lib/format';
import { useAuth } from '../store/auth';

const SparkleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" />
    <path d="M19 15l.7 1.8L21 17.5l-1.8.7L18.5 20l-.7-1.8L16 17.5l1.8-.7z" />
  </svg>
);

export function HomePage() {
  const qc = useQueryClient();
  const isAdmin = useAuth(s => s.user?.role === 'admin');
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const { data: recent } = useQuery({ queryKey: ['recent-albums'], queryFn: api.recentAlbums });
  const [onlyWeak, setOnlyWeak] = useState(true);

  const { data: enrichSt } = useQuery({
    queryKey: ['enrich-status'],
    queryFn: api.enrichStatus,
    refetchInterval: (q) => (q.state.data?.running ? 800 : false),
    enabled: isAdmin
  });

  const runEnrich = useMutation({
    mutationFn: () => api.enrichRun({ onlyWeak }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrich-status'] }),
    onError: (e: Error) => alert(e.message)
  });

  useEffect(() => {
    if (enrichSt && !enrichSt.running && enrichSt.finishedAt) {
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['recent-albums'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      qc.invalidateQueries({ queryKey: ['artists'] });
    }
  }, [enrichSt?.running, enrichSt?.finishedAt]);

  const pct = enrichSt && enrichSt.total > 0 ? (enrichSt.done / enrichSt.total) * 100 : 0;

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6 md:py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-6"
      >
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--color-fg-mute)' }}>
            欢迎回来
          </div>
          <h1 className="text-[26px] md:text-[34px] font-semibold tracking-tight">尽情聆听吧</h1>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: 'var(--color-fg-soft)' }}>
              <input
                type="checkbox"
                className="accent-[var(--color-accent)]"
                checked={onlyWeak}
                onChange={e => setOnlyWeak(e.target.checked)}
              />
              仅刮缺失元数据
            </label>
            <button
              onClick={() => runEnrich.mutate()}
              disabled={enrichSt?.running}
              className="flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-white text-black hover:scale-[1.02] active:scale-[0.98] transition shadow-md font-medium text-[13px] md:text-[14px] disabled:opacity-50 disabled:hover:scale-100"
            >
              <SparkleIcon size={16} />{enrichSt?.running ? '刮削中…' : '一键刮削整库'}
            </button>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {isAdmin && enrichSt && (enrichSt.running || enrichSt.finishedAt) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 mb-8"
          >
            <div className="flex items-center justify-between mb-2 text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>
              <span>{enrichSt.running ? '正在从 MusicBrainz / 网易云刮削…' : '刮削完成'}</span>
              <span className="tabular-nums">{enrichSt.done} / {enrichSt.total}</span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.05] overflow-hidden mb-2">
              <motion.div
                className="h-full"
                style={{ background: 'linear-gradient(90deg, #c7a8ff, #ff8ec7)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]" style={{ color: 'var(--color-fg-soft)' }}>
              <span>已应用 <b className="text-white">{enrichSt.improved}</b></span>
              <span>跳过 <b className="text-white">{enrichSt.skipped}</b></span>
              {enrichSt.failed > 0 && <span>失败 <b className="text-red-400">{enrichSt.failed}</b></span>}
            </div>
            {enrichSt.current && (
              <div className="text-[11px] mt-1.5 truncate" style={{ color: 'var(--color-fg-mute)' }}>{enrichSt.current}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-10">
          <Stat label="曲目" value={stats.tracks.toLocaleString()} />
          <Stat label="专辑" value={stats.albums.toLocaleString()} />
          <Stat label="艺术家" value={stats.artists.toLocaleString()} />
          <Stat label="无损" value={`${stats.lossless} / ${stats.tracks}`} sub={fmtLongDuration(stats.duration)} />
        </div>
      )}

      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg md:text-xl font-semibold">最近添加</h2>
        <Link to="/albums" className="text-[12px] hover:underline" style={{ color: 'var(--color-fg-soft)' }}>查看全部</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 sm:gap-5">
        {(recent ?? []).map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025, duration: 0.32 }}
          >
            <Link to={`/albums/${a.id}`} className="group block">
              <Cover albumId={a.id} hasCover={a.has_cover} className="aspect-square w-full group-hover:scale-[1.02] transition-transform" />
              <div className="mt-3">
                <div className="text-[14px] font-medium truncate group-hover:text-white">{a.name}</div>
                <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{a.album_artist}</div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl p-4 md:p-5 bg-white/[0.025] border border-white/5">
      <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-fg-mute)' }}>{label}</div>
      <div className="text-[22px] md:text-[28px] font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[12px] mt-1 truncate" style={{ color: 'var(--color-fg-soft)' }}>{sub}</div>}
    </div>
  );
}
