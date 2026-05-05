import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { AlbumSummary } from '../api/types';
import { Cover } from './Cover';

interface Props {
  albums: AlbumSummary[];
  loading?: boolean;
}

export function AlbumGrid({ albums, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}>
            <div className="cover-shimmer aspect-square rounded-[10px]" />
            <div className="cover-shimmer h-3 mt-3 rounded w-3/4" />
            <div className="cover-shimmer h-3 mt-1.5 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (albums.length === 0) {
    return <div className="text-sm py-12 text-center" style={{ color: 'var(--color-fg-mute)' }}>没有专辑。请先在“设置”中添加音乐目录并扫描。</div>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
      {albums.map((a, i) => (
        <motion.div
          key={a.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.015, 0.4), duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Link to={`/albums/${a.id}`} className="group block">
            <Cover
              albumId={a.id}
              hasCover={a.has_cover}
              alt={a.name}
              className="aspect-square w-full transition-transform duration-300 group-hover:scale-[1.02] group-hover:shadow-[0_18px_36px_rgba(0,0,0,0.4)]"
            />
            <div className="mt-3 px-0.5">
              <div className="text-[14px] font-medium truncate group-hover:text-white transition" title={a.name}>{a.name}</div>
              <div className="text-[12px] truncate" style={{ color: 'var(--color-fg-soft)' }} title={a.album_artist}>
                {a.album_artist}{a.year ? ` · ${a.year}` : ''}
              </div>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
