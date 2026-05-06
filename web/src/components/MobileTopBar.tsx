import { useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useUI } from '../store/ui';
import { MenuIcon } from './icons';

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, '首页'],
  [/^\/albums\/?$/, '专辑'],
  [/^\/albums\/\d+/, '专辑'],
  [/^\/artists\/?$/, '艺术家'],
  [/^\/artists\/\d+/, '艺术家'],
  [/^\/search/, '搜索'],
  [/^\/favorites/, '收藏'],
  [/^\/playlists\/?$/, '播放列表'],
  [/^\/playlists\/\d+/, '播放列表'],
  [/^\/settings/, '设置']
];

function titleFor(path: string) {
  for (const [re, t] of TITLES) if (re.test(path)) return t;
  return 'Lumen';
}

export function MobileTopBar() {
  const setMobileOpen = useUI(s => s.setMobileNavOpen);
  const location = useLocation();
  const title = titleFor(location.pathname);

  return (
    <div
      className="md:hidden sticky top-0 z-30 glass border-b border-white/5 flex items-center gap-2 px-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}
    >
      <button
        className="btn-icon w-10 h-10 shrink-0"
        onClick={() => setMobileOpen(true)}
        aria-label="打开导航"
      >
        <MenuIcon width={20} height={20} />
      </button>
      <Link to="/" className="flex items-center gap-2 select-none">
        <motion.div
          className="w-6 h-6 rounded-full"
          style={{
            background: 'conic-gradient(from 90deg, #c7a8ff, #ff8ec7, #ffd596, #c7a8ff)',
            boxShadow: '0 0 14px rgba(199, 168, 255, 0.45)'
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 16, ease: 'linear' }}
        />
        <span className="text-[14px] font-semibold tracking-tight">{title}</span>
      </Link>
    </div>
  );
}
