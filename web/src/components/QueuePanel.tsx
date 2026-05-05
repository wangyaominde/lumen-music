import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { fmtDuration } from '../lib/format';
import { Cover } from './Cover';
import { CloseIcon, TrashIcon } from './icons';

export function QueuePanel() {
  const open = useUI(s => s.queueOpen);
  const setOpen = useUI(s => s.setQueueOpen);
  const queue = usePlayer(s => s.queue);
  const index = usePlayer(s => s.index);
  const playQueue = usePlayer(s => s.playQueue);
  const removeAt = usePlayer(s => s.removeAt);
  const clearQueue = usePlayer(s => s.clearQueue);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          className="absolute right-3 bottom-[100px] z-30 w-[360px] max-h-[60vh] glass rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.5)] flex flex-col"
        >
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
              <button
                key={`${t.id}-${i}`}
                className={`group w-full flex items-center gap-3 px-2 py-2 rounded-lg row-hover text-left ${
                  i === index ? 'bg-white/[0.06]' : ''
                }`}
                onClick={() => playQueue(queue, i)}
              >
                <Cover albumId={t.album_id} hasCover={true} className="w-10 h-10 shrink-0" rounded="rounded-md" />
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] truncate ${i === index ? 'text-[var(--color-accent)]' : ''}`}>{t.title}</div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--color-fg-soft)' }}>{t.artist_name}</div>
                </div>
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--color-fg-mute)' }}>{fmtDuration(t.duration ?? 0)}</div>
                <button
                  className="btn-icon w-7 h-7 opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                  aria-label="移除"
                >
                  <CloseIcon width={12} height={12} />
                </button>
              </button>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
