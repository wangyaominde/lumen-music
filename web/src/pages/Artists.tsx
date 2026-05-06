import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';

export function ArtistsPage() {
  const [sort, setSort] = useState<'name' | 'albums' | 'tracks'>('name');
  const { data } = useQuery({ queryKey: ['artists', sort], queryFn: () => api.artists(sort) });

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6 md:py-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>音乐库</div>
          <h1 className="text-[24px] md:text-[28px] font-semibold mt-1">艺术家 <span className="text-[14px] md:text-[16px] font-normal ml-2" style={{ color: 'var(--color-fg-mute)' }}>{(data ?? []).length.toLocaleString()}</span></h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {([['name','名称'],['albums','专辑数'],['tracks','曲目数']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setSort(v)}
              className={`text-[12px] px-3 py-1.5 rounded-full border transition shrink-0 ${
                sort === v ? 'border-white/40 text-white bg-white/[0.06]' : 'border-transparent text-[var(--color-fg-soft)] hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {(data ?? []).map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.3), duration: 0.32 }}
          >
            <Link
              to={`/artists/${a.id}`}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.025] border border-white/5 hover:bg-white/[0.05] transition"
            >
              <div className="w-12 h-12 rounded-full grid place-items-center text-[16px] font-semibold"
                   style={{ background: 'linear-gradient(135deg, #c7a8ff, #ff8ec7)', color: '#1a1a1a' }}>
                {a.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium truncate">{a.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--color-fg-soft)' }}>
                  {a.album_count} 张专辑 · {a.track_count} 首
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
