import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';
import { TrackList } from '../components/TrackList';
import { fmtLongDuration } from '../lib/format';
import { PlayIcon, PlusIcon, TrashIcon } from '../components/icons';
import { usePlayer } from '../store/player';

export function PlaylistsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: (n: string) => api.createPlaylist(n),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] })
  });
  const del = useMutation({
    mutationFn: (id: number) => api.deletePlaylist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] })
  });

  return (
    <div className="px-10 py-10">
      <div className="mb-8">
        <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>音乐库</div>
        <h1 className="text-[28px] font-semibold mt-1">播放列表</h1>
      </div>
      <form
        className="flex items-center gap-3 mb-8 max-w-md"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) { create.mutate(name.trim()); setName(''); } }}
      >
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="新建播放列表..."
          className="flex-1 bg-white/[0.04] border border-white/5 px-4 py-2.5 rounded-full outline-none focus:border-white/15 transition text-[14px]"
        />
        <button className="px-5 py-2.5 rounded-full bg-white text-black text-[14px] font-medium flex items-center gap-2"><PlusIcon width={14} height={14} />创建</button>
      </form>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {(data ?? []).map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="group flex items-center gap-4 p-4 rounded-2xl bg-white/[0.025] border border-white/5 hover:bg-white/[0.05] transition"
          >
            <div className="w-12 h-12 rounded-lg grid place-items-center text-white"
                 style={{ background: 'linear-gradient(135deg, #6e54b5, #c7a8ff)' }}>
              <PlayIcon width={20} height={20} />
            </div>
            <Link to={`/playlists/${p.id}`} className="flex-1 min-w-0">
              <div className="text-[14px] font-medium truncate">{p.name}</div>
              <div className="text-[11px]" style={{ color: 'var(--color-fg-soft)' }}>
                {p.track_count} 首 · {fmtLongDuration(p.duration ?? 0)}
              </div>
            </Link>
            <button
              className="btn-icon w-8 h-8 opacity-0 group-hover:opacity-100"
              onClick={() => { if (confirm('删除该播放列表？')) del.mutate(p.id); }}
              aria-label="删除"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function PlaylistDetailPage() {
  const { id } = useParams();
  const pid = Number(id);
  const { data } = useQuery({ queryKey: ['playlist', pid], queryFn: () => api.playlist(pid), enabled: !!pid });
  const playQueue = usePlayer(s => s.playQueue);

  if (!data) return <div className="px-10 py-10"><div className="cover-shimmer h-[160px] rounded-2xl" /></div>;
  const tracks = data.tracks as any[];
  return (
    <div className="px-10 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>播放列表</div>
          <h1 className="text-[34px] font-semibold mt-1">{data.playlist.name}</h1>
          <div className="text-[13px] mt-1" style={{ color: 'var(--color-fg-soft)' }}>
            {tracks.length} 首 · {fmtLongDuration(tracks.reduce((s, t) => s + (t.duration ?? 0), 0))}
          </div>
        </div>
        {tracks.length > 0 && (
          <button
            onClick={() => playQueue(tracks)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black hover:scale-[1.02] active:scale-[0.98] transition shadow-md font-medium text-[14px]"
          >
            <PlayIcon width={16} height={16} />播放
          </button>
        )}
      </div>
      <TrackList tracks={tracks} showAlbum numberByIndex />
    </div>
  );
}
