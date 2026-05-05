import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { AlbumIcon, ArtistIcon, HeartIcon, HomeIcon, ListIcon, SearchIcon, SettingsIcon } from './icons';
import { api } from '../api';
import { useAuth } from '../store/auth';
import { audio, usePlayer } from '../store/player';

const LogoutIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const items = [
  { to: '/', label: '首页', icon: HomeIcon, end: true },
  { to: '/albums', label: '专辑', icon: AlbumIcon },
  { to: '/artists', label: '艺术家', icon: ArtistIcon },
  { to: '/search', label: '搜索', icon: SearchIcon },
  { to: '/favorites', label: '收藏', icon: HeartIcon },
  { to: '/playlists', label: '播放列表', icon: ListIcon },
  { to: '/settings', label: '设置', icon: SettingsIcon }
];

export function Sidebar() {
  const setPhase = useAuth(s => s.setPhase);
  const clearQueue = usePlayer(s => s.clearQueue);
  const qc = useQueryClient();

  const logout = async () => {
    if (!confirm('确认退出登录？')) return;
    try { await api.authLogout(); } catch { /* even if it fails, clear locally */ }
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* */ }
    clearQueue();
    qc.clear();
    setPhase('login');
  };

  return (
    <aside className="w-60 shrink-0 flex flex-col h-full glass border-r border-white/5">
      <div className="px-5 pt-6 pb-4 select-none">
        <div className="flex items-center gap-2.5">
          <motion.div
            className="w-8 h-8 rounded-full"
            style={{
              background: 'conic-gradient(from 90deg, #c7a8ff, #ff8ec7, #ffd596, #c7a8ff)',
              boxShadow: '0 0 24px rgba(199, 168, 255, 0.45)'
            }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 16, ease: 'linear' }}
          />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Lumen</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-fg-mute" style={{ color: 'var(--color-fg-mute)' }}>无损音乐</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] transition-colors ${
                isActive
                  ? 'text-white bg-white/[0.06]'
                  : 'text-[var(--color-fg-soft)] hover:text-white hover:bg-white/[0.03]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-pill"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--color-accent)]"
                    transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  />
                )}
                <Icon width={18} height={18} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-white/5">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] hover:bg-white/[0.04] transition"
          style={{ color: 'var(--color-fg-soft)' }}
        >
          <LogoutIcon />
          <span>退出登录</span>
        </button>
        <div className="px-3 pt-2 text-[11px] select-none" style={{ color: 'var(--color-fg-mute)' }}>
          v0.1 · 偏好无损 FLAC / WAV / ALAC
        </div>
      </div>
    </aside>
  );
}
