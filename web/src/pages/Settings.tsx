import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { PlusIcon, RefreshIcon, TrashIcon } from '../components/icons';
import { useAuth } from '../store/auth';
import type { Role } from '../api/types';

const SparkleIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" />
    <path d="M19 15l.7 1.8L21 17.5l-1.8.7L18.5 20l-.7-1.8L16 17.5l1.8-.7z" />
  </svg>
);

export function SettingsPage() {
  const qc = useQueryClient();
  const isAdmin = useAuth(s => s.user?.role === 'admin');

  // Listeners only see "change my PIN" — no library / scan / scrape / users.
  if (!isAdmin) {
    return (
      <div className="px-4 sm:px-6 md:px-10 py-6 md:py-10 max-w-3xl">
        <div className="mb-8">
          <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>偏好</div>
          <h1 className="text-[28px] font-semibold mt-1">设置</h1>
        </div>
        <PasswordSection />
        <div className="mt-8 text-[12px] leading-relaxed" style={{ color: 'var(--color-fg-mute)' }}>
          仅管理员可以管理音乐库目录、扫描和元数据刮削。
        </div>
      </div>
    );
  }
  const { data: dirs } = useQuery({ queryKey: ['scan-dirs'], queryFn: api.scanDirs });
  const { data: status } = useQuery({
    queryKey: ['scan-status'],
    queryFn: api.scanStatus,
    refetchInterval: (q) => (q.state.data?.running ? 600 : false)
  });
  const [path, setPath] = useState('');

  const addDir = useMutation({
    mutationFn: (p: string) => api.addScanDir(p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scan-dirs'] }); setPath(''); },
    onError: (e: Error) => alert(e.message)
  });
  const removeDir = useMutation({
    mutationFn: (id: number) => api.removeScanDir(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-dirs'] })
  });
  const runScan = useMutation({
    mutationFn: () => api.runScan(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scan-status'] }),
    onError: (e: Error) => alert(e.message)
  });

  useEffect(() => {
    if (status && !status.running && status.finishedAt) {
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['recent-albums'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      qc.invalidateQueries({ queryKey: ['artists'] });
    }
  }, [status?.running, status?.finishedAt]);

  const pct = status && status.total > 0 ? (status.scanned / status.total) * 100 : 0;

  return (
    <div className="px-4 sm:px-6 md:px-10 py-6 md:py-10 max-w-3xl">
      <div className="mb-6 md:mb-8">
        <div className="text-[12px] uppercase tracking-[0.2em]" style={{ color: 'var(--color-fg-mute)' }}>偏好</div>
        <h1 className="text-[24px] md:text-[28px] font-semibold mt-1">设置</h1>
      </div>

      <div className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="text-[15px] font-semibold">音乐库目录</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-fg-soft)' }}>添加目录后点击扫描，元数据将被解析并存入索引。</div>
          </div>
          <button
            onClick={() => runScan.mutate()}
            disabled={status?.running}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black text-[13px] font-medium disabled:opacity-50 w-fit shrink-0"
          >
            <RefreshIcon width={14} height={14} />{status?.running ? '扫描中…' : '开始扫描'}
          </button>
        </div>

        <form
          className="flex items-center gap-2 mb-4"
          onSubmit={(e) => { e.preventDefault(); if (path.trim()) addDir.mutate(path.trim()); }}
        >
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/Users/you/Music 或 /Volumes/NAS/FLAC"
            className="flex-1 min-w-0 bg-black/30 border border-white/5 px-3 sm:px-4 py-2.5 rounded-lg outline-none focus:border-white/15 transition text-[13px] sm:text-[14px] font-mono"
          />
          <button className="px-3 sm:px-4 py-2.5 rounded-lg border border-white/15 hover:bg-white/[0.05] transition text-[13px] flex items-center gap-2 shrink-0"><PlusIcon width={14} height={14} />添加</button>
        </form>

        <div className="space-y-1">
          {(dirs ?? []).length === 0 && <div className="text-[12px] py-4 text-center" style={{ color: 'var(--color-fg-mute)' }}>还没有目录</div>}
          {(dirs ?? []).map(d => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-black/20">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-mono truncate">{d.path}</div>
                <div className="text-[11px]" style={{ color: 'var(--color-fg-mute)' }}>
                  {d.last_scan ? `上次扫描：${new Date(d.last_scan).toLocaleString()}` : '尚未扫描'}
                </div>
              </div>
              <button className="btn-icon w-8 h-8" onClick={() => removeDir.mutate(d.id)} aria-label="移除">
                <TrashIcon width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {status && (status.running || status.finishedAt) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[15px] font-semibold">{status.running ? '正在扫描' : '扫描完成'}</div>
              <div className="text-[12px] tabular-nums" style={{ color: 'var(--color-fg-soft)' }}>
                {status.scanned} / {status.total}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden mb-3">
              <motion.div
                className="h-full"
                style={{ background: 'linear-gradient(90deg, #c7a8ff, #ff8ec7)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>
              <span>新增 <b className="text-white">{status.added}</b></span>
              <span>更新 <b className="text-white">{status.updated}</b></span>
              <span>未变 <b className="text-white">{status.unchanged}</b></span>
              <span>移除 <b className="text-white">{status.removed}</b></span>
              {status.failed > 0 && <span>失败 <b className="text-red-400">{status.failed}</b></span>}
            </div>
            {status.current && (
              <div className="text-[11px] mt-3 truncate font-mono" style={{ color: 'var(--color-fg-mute)' }}>
                {status.current}
              </div>
            )}
            {status.error && <div className="text-[12px] text-red-400 mt-2">{status.error}</div>}
            {status.failures && status.failures.length > 0 && (
              <FailuresList failures={status.failures} totalFailed={status.failed} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <EnrichmentSection />

      <DuplicateCleanupSection />

      <UsersSection />

      <PasswordSection />

      <div className="mt-8 text-[12px] leading-relaxed" style={{ color: 'var(--color-fg-mute)' }}>
        支持的格式：FLAC · ALAC (M4A) · WAV · AIFF · MP3 · OGG · OPUS · APE · WavPack · DSD · DSF · DFF。
        浏览器原生可播 FLAC / ALAC / WAV / MP3 / OGG。APE / DSD 当前以原始字节流送出，需要客户端或后续转码支持。
      </div>
    </div>
  );
}

function PasswordSection() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 4) { setMsg({ kind: 'err', text: '新密码至少 4 位' }); return; }
    if (next !== next2) { setMsg({ kind: 'err', text: '两次新密码不一致' }); return; }
    setBusy(true);
    try {
      await api.authChangePin(cur, next);
      setMsg({ kind: 'ok', text: '密码已更新' });
      setCur(''); setNext(''); setNext2('');
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[15px] font-semibold">访问密码</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-fg-soft)' }}>
            修改后已登录的其他设备需要重新登录。
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
        <input
          type="password" value={cur} onChange={e => setCur(e.target.value)} placeholder="当前密码"
          className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 transition text-[13px]"
        />
        <input
          type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="新密码"
          className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 transition text-[13px]"
        />
        <input
          type="password" value={next2} onChange={e => setNext2(e.target.value)} placeholder="再次输入新密码"
          className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 transition text-[13px]"
        />
        <button
          type="submit" disabled={busy || !cur || !next || !next2}
          className="sm:col-span-3 mt-1 px-5 py-2 rounded-full bg-white text-black text-[13px] font-medium disabled:opacity-40 self-start w-fit"
        >
          {busy ? '保存中…' : '修改密码'}
        </button>
      </form>
      {msg && (
        <div className={`mt-3 text-[12px] ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</div>
      )}
    </div>
  );
}

function EnrichmentSection() {
  const qc = useQueryClient();
  const [minScore, setMinScore] = useState(0.78);
  const { data: status } = useQuery({
    queryKey: ['enrich-status'],
    queryFn: api.enrichStatus,
    refetchInterval: (q) => (q.state.data?.running ? 800 : false)
  });
  const run = useMutation({
    mutationFn: () => api.enrichRun({ minScore, onlyWeak: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrich-status'] }),
    onError: (e: Error) => alert(e.message)
  });
  useEffect(() => {
    if (status && !status.running && status.finishedAt) {
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['recent-albums'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      qc.invalidateQueries({ queryKey: ['artists'] });
    }
  }, [status?.running, status?.finishedAt]);

  const pct = status && status.total > 0 ? (status.done / status.total) * 100 : 0;

  return (
    <div className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <div className="text-[15px] font-semibold flex items-center gap-2"><SparkleIcon />元数据增强</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-fg-soft)' }}>
            自动从 MusicBrainz 与网易云查找候选并填补缺失。仅当置信度高于阈值时才自动应用。
          </div>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={status?.running}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black text-[13px] font-medium disabled:opacity-50 w-fit shrink-0"
        >
          <SparkleIcon />{status?.running ? '增强中…' : '改善缺失元数据'}
        </button>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[12px] w-16" style={{ color: 'var(--color-fg-soft)' }}>阈值</span>
        <input
          type="range"
          min={0.5}
          max={0.95}
          step={0.01}
          value={minScore}
          onChange={e => setMinScore(Number(e.target.value))}
          className="range-slim flex-1"
          style={{ ['--progress' as any]: `${((minScore - 0.5) / 0.45) * 100}%`, ['--track-color' as any]: 'var(--color-accent)' }}
        />
        <span className="text-[12px] tabular-nums w-10">{(minScore * 100).toFixed(0)}</span>
      </div>
      <AnimatePresence>
        {status && (status.running || status.finishedAt) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-4"
          >
            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden mb-3">
              <motion.div
                className="h-full"
                style={{ background: 'linear-gradient(90deg, #c7a8ff, #ff8ec7)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>
              <span>{status.done} / {status.total}</span>
              <span>已应用 <b className="text-white">{status.improved}</b></span>
              <span>跳过 <b className="text-white">{status.skipped}</b></span>
              {status.failed > 0 && <span>失败 <b className="text-red-400">{status.failed}</b></span>}
            </div>
            {status.current && (
              <div className="text-[11px] mt-2 truncate" style={{ color: 'var(--color-fg-mute)' }}>{status.current}</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const me = useAuth(s => s.user);
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState<Role>('listener');
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createUser(newName.trim(), newPin, newRole),
    onSuccess: () => {
      setNewName(''); setNewPin(''); setNewRole('listener'); setErr(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e: Error) => setErr(e.message)
  });
  const del = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e: Error) => alert(e.message)
  });
  const reset = useMutation({
    mutationFn: ({ id, pin }: { id: number; pin: string }) => api.resetUserPin(id, pin),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e: Error) => alert(e.message)
  });

  return (
    <div className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6 mt-6">
      <div className="mb-4">
        <div className="text-[15px] font-semibold">用户管理</div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-fg-soft)' }}>
          创建只能听歌的家庭账号。每个用户用唯一 PIN 登录，PIN 不能跟其他人重复。
        </div>
      </div>

      <div className="space-y-1 mb-5">
        {(users ?? []).map(u => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black/20 group">
            <div
              className="w-8 h-8 rounded-full grid place-items-center text-[12px] font-semibold shrink-0"
              style={{
                background: u.role === 'admin' ? 'linear-gradient(135deg,#c7a8ff,#ff8ec7)' : 'rgba(255,255,255,0.08)',
                color: u.role === 'admin' ? '#1a1a1a' : '#fff'
              }}
            >
              {u.username[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] truncate">
                {u.username}
                {me?.id === u.id && <span className="ml-2 text-[11px]" style={{ color: 'var(--color-fg-mute)' }}>（你）</span>}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--color-fg-mute)' }}>
                {u.role === 'admin' ? '管理员' : '听众'} · 创建于 {new Date(u.created_at).toLocaleDateString()}
              </div>
            </div>
            <button
              className="text-[11px] px-2 py-1 rounded-full border border-white/10 hover:bg-white/[0.05] md:opacity-0 md:group-hover:opacity-100 transition shrink-0"
              onClick={() => {
                const pin = prompt(`为「${u.username}」重置 PIN（4-12 位数字 / 字符）：`);
                if (pin && pin.trim()) reset.mutate({ id: u.id, pin: pin.trim() });
              }}
            >
              重置 PIN
            </button>
            {me?.id !== u.id && (
              <button
                className="btn-icon w-8 h-8 md:opacity-0 md:group-hover:opacity-100 shrink-0"
                onClick={() => { if (confirm(`删除用户「${u.username}」？`)) del.mutate(u.id); }}
                aria-label="删除"
              >
                <TrashIcon width={14} height={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-4">
        <div className="text-[12px] mb-2" style={{ color: 'var(--color-fg-soft)' }}>新建用户</div>
        <form
          className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2"
          onSubmit={(e) => { e.preventDefault(); if (newName.trim() && newPin) create.mutate(); }}
        >
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="用户名（如 妈妈）"
            className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 text-[13px] w-full sm:w-40"
          />
          <input
            value={newPin}
            onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="PIN（数字）"
            className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 text-[13px] w-full sm:w-40 font-mono"
            inputMode="numeric"
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as Role)}
            className="bg-black/30 border border-white/5 px-3 py-2 rounded-lg outline-none focus:border-white/15 text-[13px]"
          >
            <option value="listener">听众</option>
            <option value="admin">管理员</option>
          </select>
          <button
            type="submit"
            disabled={create.isPending || !newName.trim() || newPin.length < 4}
            className="px-4 py-2 rounded-lg bg-white text-black text-[13px] font-medium disabled:opacity-40 flex items-center gap-2"
          >
            <PlusIcon width={14} height={14} />创建
          </button>
        </form>
        {err && <div className="text-[12px] text-red-400 mt-2">{err}</div>}
      </div>
    </div>
  );
}

function FailuresList({ failures, totalFailed }: { failures: { path: string; error: string; at: number }[]; totalFailed: number }) {
  const [open, setOpen] = useState(false);
  const overflow = totalFailed - failures.length;
  return (
    <div className="mt-4 border-t border-white/5 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[12px] flex items-center gap-2 hover:text-white transition"
        style={{ color: 'var(--color-fg-soft)' }}
      >
        <span>{open ? '隐藏' : '展开'}失败明细</span>
        <span className="text-[11px]" style={{ color: 'var(--color-fg-mute)' }}>
          {failures.length}{overflow > 0 ? ` + ${overflow} more` : ''}
        </span>
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto space-y-1.5 text-[11px] font-mono">
          {failures.slice().reverse().map((f, i) => (
            <div key={i} className="px-2 py-1.5 rounded bg-black/30">
              <div className="truncate" title={f.path} style={{ color: 'var(--color-fg-soft)' }}>{f.path}</div>
              <div className="text-red-400 break-words mt-0.5">{f.error}</div>
            </div>
          ))}
          {overflow > 0 && (
            <div className="text-[11px] py-2 text-center" style={{ color: 'var(--color-fg-mute)' }}>
              还有 {overflow} 条失败未显示，请查看服务端日志（每条失败也会打印到 stderr）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DuplicateCleanupSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ mergedAlbums: number; movedTracks: number; groups: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    if (!confirm('扫描所有专辑找出名字相同 / 艺人接近的重复项，并把它们合并成一张。这个操作不可撤销，确定继续？')) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await api.cleanupDuplicateAlbums();
      setResult({ mergedAlbums: r.mergedAlbums, movedTracks: r.movedTracks, groups: r.groups });
      qc.invalidateQueries(); // refresh albums everywhere
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white/[0.025] border border-white/5 p-4 md:p-6 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div>
          <div className="text-[15px] font-semibold">清理重复专辑</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-fg-soft)' }}>
            过去因为 ID3 简繁混排或刮削切换，可能把一张专辑拆成了多个。这里一键合并：保留曲目最多的那张，其它并入它。
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-white/15 hover:bg-white/[0.05] transition text-[13px] disabled:opacity-50 w-fit shrink-0"
        >
          {busy ? '清理中…' : '开始清理'}
        </button>
      </div>
      {result && (
        <div className="text-[12px]" style={{ color: 'var(--color-fg-soft)' }}>
          {result.groups === 0
            ? <>没有发现重复专辑。</>
            : <>合并了 <b className="text-white">{result.groups}</b> 组，共 <b className="text-white">{result.mergedAlbums}</b> 张专辑被并入主专辑，<b className="text-white">{result.movedTracks}</b> 首曲目重新归位。</>
          }
        </div>
      )}
      {err && <div className="text-[12px] text-red-400 mt-2">{err}</div>}
    </div>
  );
}
