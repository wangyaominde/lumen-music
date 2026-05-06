import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import type { Candidate } from '../api/types';
import { api } from '../api';
import { CloseIcon } from './icons';

interface Props {
  trackId: number | null;
  onClose: () => void;
}

const SOURCE_LABEL: Record<Candidate['source'], string> = {
  musicbrainz: 'MusicBrainz',
  netease: '网易云',
  path: '路径推断'
};

const SOURCE_TINT: Record<Candidate['source'], string> = {
  musicbrainz: 'rgba(135,196,255,0.18)',
  netease: 'rgba(255,138,138,0.18)',
  path: 'rgba(180,180,180,0.16)'
};

export function EnrichDialog({ trackId, onClose }: Props) {
  const qc = useQueryClient();
  const [data, setData] = useState<{ track: any; candidates: Candidate[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<number | null>(0);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    setData(null);
    setPicked(0);
    setError(null);
    setLoading(true);
    api.enrichCandidates(trackId)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [trackId]);

  const candidates = data?.candidates ?? [];
  const cur = data?.track;

  const apply = async () => {
    if (!trackId || picked === null) return;
    const c = candidates[picked];
    if (!c) return;
    setApplying(true);
    try {
      await api.enrichApply(trackId, c);
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const open = trackId !== null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.96, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="relative w-[min(880px,94vw)] max-h-[88vh] sm:max-h-[82vh] flex flex-col glass rounded-2xl border border-white/10 shadow-[0_36px_120px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5 gap-2">
              <div className="min-w-0">
                <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>改善元数据</div>
                <div className="text-[14px] sm:text-[16px] font-semibold mt-0.5 truncate">{cur ? `${cur.artist_name} – ${cur.title}` : ''}</div>
              </div>
              <button className="btn-icon w-9 h-9 shrink-0" onClick={onClose} aria-label="关闭"><CloseIcon width={16} height={16} /></button>
            </div>
            <div className="px-4 sm:px-6 py-4 border-b border-white/5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[12px]">
                <Field label="标题" value={cur?.title} />
                <Field label="艺术家" value={cur?.artist_name} />
                <Field label="专辑" value={cur?.album_name} />
                <Field label="年代" value={cur?.year ?? '—'} />
              </div>
            </div>
            <div className="overflow-y-auto px-2 py-2 flex-1">
              {loading && (
                <div className="py-12 text-center text-sm" style={{ color: 'var(--color-fg-mute)' }}>查询 MusicBrainz 与网易云中…</div>
              )}
              {error && <div className="py-6 px-4 text-sm text-red-400">{error}</div>}
              {!loading && candidates.length === 0 && !error && (
                <div className="py-12 text-center text-sm" style={{ color: 'var(--color-fg-mute)' }}>未找到候选项</div>
              )}
              {candidates.map((c, i) => {
                const active = picked === i;
                return (
                  <button
                    key={`${c.source}:${c.external_id}:${i}`}
                    onClick={() => setPicked(i)}
                    className={`w-full text-left grid grid-cols-[64px_1fr_auto] sm:grid-cols-[80px_1fr_auto] gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-xl transition mb-1 ${
                      active ? 'bg-white/[0.07] ring-1 ring-white/20' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full"
                        style={{ background: SOURCE_TINT[c.source], color: '#fff' }}
                      >
                        {SOURCE_LABEL[c.source]}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium truncate">{c.title || '—'}</div>
                      <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>
                        {c.artist || '—'} · {c.album || '—'}{c.year ? ` · ${c.year}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      {c.cover_url && (
                        <img src={c.cover_url} alt="" className="hidden sm:block w-10 h-10 rounded-md object-cover bg-white/5" referrerPolicy="no-referrer" />
                      )}
                      <ScoreBar value={c.score} />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-white/5">
              <button onClick={onClose} className="px-4 py-2 rounded-full text-[13px] border border-white/10 hover:bg-white/[0.04]">取消</button>
              <button
                onClick={apply}
                disabled={picked === null || applying || candidates.length === 0}
                className="px-5 py-2 rounded-full bg-white text-black text-[13px] font-medium disabled:opacity-40"
              >
                {applying ? '应用中…' : '应用所选'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="uppercase tracking-[0.16em] text-[10px]" style={{ color: 'var(--color-fg-mute)' }}>{label}</div>
      <div className="truncate">{value || '—'}</div>
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="text-right">
      <div className="text-[11px] tabular-nums">{pct}</div>
      <div className="w-14 h-1 mt-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #c7a8ff, #ff8ec7)' }} />
      </div>
    </div>
  );
}
