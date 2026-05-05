import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../api';
import { Cover } from '../components/Cover';

export function ArtistPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const { data } = useQuery({ queryKey: ['artist', artistId], queryFn: () => api.artist(artistId), enabled: !!artistId });
  if (!data) return <div className="px-10 py-10"><div className="cover-shimmer h-[160px] rounded-2xl" /></div>;

  return (
    <div className="px-10 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-6 mb-10"
      >
        <div className="w-32 h-32 rounded-full grid place-items-center text-[48px] font-semibold shrink-0"
             style={{ background: 'linear-gradient(135deg, #c7a8ff, #ff8ec7)', color: '#1a1a1a', boxShadow: '0 18px 48px rgba(199,168,255,0.35)' }}>
          {data.artist.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>艺术家</div>
          <h1 className="text-[40px] font-semibold leading-tight">{data.artist.name}</h1>
          <div className="text-[13px] mt-1" style={{ color: 'var(--color-fg-soft)' }}>
            {data.artist.album_count} 张专辑 · {data.artist.track_count} 首曲目
          </div>
        </div>
      </motion.div>

      <div className="mb-4 text-xl font-semibold">专辑</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
        {data.albums.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
          >
            <Link to={`/albums/${a.id}`} className="group block">
              <Cover albumId={a.id} hasCover={a.has_cover} className="aspect-square w-full group-hover:scale-[1.02] transition-transform" />
              <div className="mt-3">
                <div className="text-[14px] font-medium truncate group-hover:text-white">{a.name}</div>
                <div className="text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>{a.year ?? ''}</div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
