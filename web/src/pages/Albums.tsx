import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../api';
import { AlbumGrid } from '../components/AlbumGrid';

const SORTS: { value: string; label: string }[] = [
  { value: 'recent', label: '最近添加' },
  { value: 'name', label: '名称' },
  { value: 'artist', label: '艺术家' },
  { value: 'year', label: '年代' },
  { value: 'random', label: '随机' }
];

export function AlbumsPage() {
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const pageSize = 60;
  const { data, isLoading } = useQuery({
    queryKey: ['albums', sort, page],
    queryFn: () => api.albums({ sort, page, pageSize })
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6 md:py-8">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>音乐库</div>
          <h1 className="text-[24px] md:text-[28px] font-semibold mt-1">专辑 <span className="text-[14px] md:text-[16px] font-normal ml-2" style={{ color: 'var(--color-fg-mute)' }}>{total.toLocaleString()}</span></h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap -mx-1 overflow-x-auto md:overflow-visible">
          {SORTS.map(s => (
            <button
              key={s.value}
              onClick={() => { setSort(s.value); setPage(1); }}
              className={`text-[12px] px-3 py-1.5 rounded-full border transition shrink-0 ${
                sort === s.value
                  ? 'border-white/40 text-white bg-white/[0.06]'
                  : 'border-transparent text-[var(--color-fg-soft)] hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </motion.div>

      <AlbumGrid albums={data?.items ?? []} loading={isLoading} />

      {totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-3 py-1.5 text-[12px] rounded-full border border-white/10 disabled:opacity-30"
          >
            上一页
          </button>
          <span className="text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-[12px] rounded-full border border-white/10 disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
