import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { SearchIcon } from '../components/icons';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SearchPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const { data } = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api.search(dq),
    enabled: dq.length > 0
  });

  const empty = useMemo(() => !data || (data.tracks.length + data.albums.length + data.artists.length === 0), [data]);

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6 md:mb-8 max-w-xl rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/5 focus-within:border-white/15 transition">
        <SearchIcon width={18} height={18} style={{ color: 'var(--color-fg-mute)' }} />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索曲目、专辑、艺术家..."
          className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[var(--color-fg-mute)]"
        />
      </div>

      {q && empty && <div className="py-10 text-center" style={{ color: 'var(--color-fg-mute)' }}>没有找到匹配的结果</div>}

      {data && data.artists.length > 0 && (
        <Section title="艺术家">
          <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {data.artists.map(a => (
              <Link key={a.id} to={`/artists/${a.id}`} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.025] border border-white/5 hover:bg-white/[0.05]">
                <div className="w-10 h-10 rounded-full grid place-items-center text-[14px] font-semibold"
                     style={{ background: 'linear-gradient(135deg, #c7a8ff, #ff8ec7)', color: '#1a1a1a' }}>
                  {a.name?.[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="text-[13px] font-medium truncate">{a.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-fg-soft)' }}>{a.album_count} 专辑</div>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {data && data.albums.length > 0 && (
        <Section title="专辑">
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 sm:gap-5">
            {data.albums.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.015 }}>
                <Link to={`/albums/${a.id}`} className="group block">
                  <Cover albumId={a.id} hasCover={a.has_cover} className="aspect-square w-full group-hover:scale-[1.02] transition-transform" />
                  <div className="mt-3">
                    <div className="text-[14px] font-medium truncate">{a.name}</div>
                    <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{a.album_artist}</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </Section>
      )}

      {data && data.tracks.length > 0 && (
        <Section title="曲目">
          <TrackList tracks={data.tracks as any} showAlbum />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 md:mb-10">
      <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">{title}</h2>
      {children}
    </div>
  );
}
