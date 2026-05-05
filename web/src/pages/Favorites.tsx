import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../api';
import { TrackList } from '../components/TrackList';
import { fmtLongDuration } from '../lib/format';
import { usePlayer } from '../store/player';
import { PlayIcon } from '../components/icons';

export function FavoritesPage() {
  const { data } = useQuery({ queryKey: ['favorites'], queryFn: api.favorites });
  const playQueue = usePlayer(s => s.playQueue);
  const tracks = (data ?? []) as any[];
  const totalDur = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);

  return (
    <div className="px-10 py-10">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>收藏</div>
          <h1 className="text-[34px] font-semibold mt-1">心动单曲</h1>
          <div className="text-[13px] mt-1" style={{ color: 'var(--color-fg-soft)' }}>{tracks.length} 首 · {fmtLongDuration(totalDur)}</div>
        </div>
        {tracks.length > 0 && (
          <button
            onClick={() => playQueue(tracks)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black hover:scale-[1.02] active:scale-[0.98] transition shadow-md font-medium text-[14px]"
          >
            <PlayIcon width={16} height={16} />播放
          </button>
        )}
      </motion.div>
      {tracks.length === 0 ? (
        <div className="py-20 text-center" style={{ color: 'var(--color-fg-mute)' }}>还没有收藏，从播放栏点击 ❤ 即可收藏</div>
      ) : (
        <TrackList tracks={tracks as any} showAlbum numberByIndex />
      )}
    </div>
  );
}
