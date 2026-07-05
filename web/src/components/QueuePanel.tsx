import { memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Track } from '../api/types';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { fmtDuration } from '../lib/format';
import { Cover } from './Cover';
import { CloseIcon, TrashIcon } from './icons';

interface RowProps {
  track: Track;
  index: number;
  active: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
}

// Memo'd so switching tracks only re-renders the rows whose highlight flips.
const QueueRow = memo(function QueueRow({ track: t, index: i, active, onPlay, onRemove }: RowProps) {
  return (
    <button
      className={`group w-full flex items-center gap-3 px-2 py-2 rounded-lg row-hover text-left cv-auto ${
        active ? 'bg-white/[0.06]' : ''
      }`}
      onClick={() => onPlay(i)}
    >
      <Cover albumId={t.album_id} hasCover={true} size={96} className="w-10 h-10 shrink-0" rounded="rounded-md" />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] truncate ${active ? 'text-[var(--color-accent)]' : ''}`}>{t.title}</div>
        <div className="text-[11px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{t.artist_name}</div>
      </div>
      <div className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--color-fg-mute)' }}>{fmtDuration(t.duration ?? 0)}</div>
      <button
        className="btn-icon w-7 h-7 md:opacity-0 md:group-hover:opacity-100 shrink-0"
        onClick={(e) => { e.stopPropagation(); onRemove(i); }}
        aria-label="移除"
      >
        <CloseIcon width={12} height={12} />
      </button>
    </button>
  );
});

export function QueuePanel() {
  const open = useUI(s => s.queueOpen);
  const setOpen = useUI(s => s.setQueueOpen);
  const queue = usePlayer(s => s.queue);
  const index = usePlayer(s => s.index);
  const playQueue = usePlayer(s => s.playQueue);
  const removeAt = usePlayer(s => s.removeAt);
  const clearQueue = usePlayer(s => s.clearQueue);

  const onPlay = useCallback((i: number) => playQueue(queue, i), [playQueue, queue]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Mobile backdrop (bottom sheet) */}
          <motion.div
            key="qp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
          />
          <motion.aside
            key="qp"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="
              fixed md:absolute z-50 md:z-30 flex flex-col glass shadow-[0_32px_80px_rgba(0,0,0,0.5)]
              left-0 right-0 bottom-0 max-h-[78vh] rounded-t-2xl rounded-b-none
              md:left-auto md:right-3 md:bottom-[100px] md:w-[360px] md:max-h-[60vh] md:rounded-2xl
            "
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Drag handle (mobile only, decorative) */}
            <div className="md:hidden pt-2 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="text-sm font-semibold">播放队列 · {queue.length}</div>
              <div className="flex items-center gap-1">
                <button className="btn-icon w-8 h-8" onClick={clearQueue} aria-label="清空队列">
                  <TrashIcon width={14} height={14} />
                </button>
                <button className="btn-icon w-8 h-8" onClick={() => setOpen(false)} aria-label="关闭">
                  <CloseIcon width={14} height={14} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-2 py-2">
              {queue.length === 0 && (
                <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--color-fg-mute)' }}>队列为空</div>
              )}
              {queue.map((t, i) => (
                <QueueRow
                  key={`${t.id}-${i}`}
                  track={t}
                  index={i}
                  active={i === index}
                  onPlay={onPlay}
                  onRemove={removeAt}
                />
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
