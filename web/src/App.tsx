import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { NowPlaying } from './components/NowPlaying';
import { QueuePanel } from './components/QueuePanel';
import { MobileTopBar } from './components/MobileTopBar';
import { HomePage } from './pages/Home';
import { AlbumsPage } from './pages/Albums';
import { AlbumPage } from './pages/Album';
import { ArtistsPage } from './pages/Artists';
import { ArtistPage } from './pages/Artist';
import { SearchPage } from './pages/Search';
import { FavoritesPage } from './pages/Favorites';
import { PlaylistsPage, PlaylistDetailPage } from './pages/Playlists';
import { useAuth } from './store/auth';
import { api, setUnauthorizedHandler } from './api';
import { audio, usePlayer } from './store/player';
import { useUI } from './store/ui';

// Settings (admin-heavy) and Login rarely sit on the hot path — split them
// out of the main bundle and load on demand.
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const LoginPage = lazy(() => import('./pages/Login').then(m => ({ default: m.LoginPage })));

// A lazy chunk that fails to load (deploy replaced hashed assets, flaky
// network) throws during render — without a boundary that unmounts the whole
// app. Reloading fetches the current index.html and heals it.
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="h-full grid place-items-center" style={{ background: 'var(--color-bg)' }}>
        <div className="text-center space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-fg-soft)' }}>页面加载失败，可能是网络问题或版本已更新</p>
          <button
            className="px-4 py-2 rounded-full text-sm"
            style={{ background: 'var(--color-surface-hi)', color: 'var(--color-fg)' }}
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const phase = useAuth(s => s.phase);
  const setPhase = useAuth(s => s.setPhase);

  const setUser = useAuth(s => s.setUser);

  // Bootstrap: figure out if any user exists + whether we're authenticated.
  useEffect(() => {
    let cancelled = false;
    api.authStatus()
      .then(s => {
        if (cancelled) return;
        setUser(s.user);
        if (!s.configured) setPhase('setup');
        else if (!s.authenticated) setPhase('login');
        else setPhase('authenticated');
      })
      .catch(() => { if (!cancelled) setPhase('login'); });
    return () => { cancelled = true; };
  }, [setPhase, setUser]);

  // Globally route 401 → login screen (and stop any playback).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* */ }
      setUser(null);
      setPhase('login');
    });
    return () => setUnauthorizedHandler(null);
  }, [setPhase, setUser]);

  // Global keyboard shortcuts:
  //   Space            play / pause
  //   ←  /  →          previous / next track
  //   Esc              close Now Playing (if open)
  // Skipped while typing in inputs / textareas / contenteditable surfaces, and
  // while focus is on a slider (so progress / volume range still work).
  useEffect(() => {
    if (phase !== 'authenticated') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      // ignore if any modifier is pressed (so e.g. Cmd+R reloads etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const player = usePlayer.getState();
      const ui = useUI.getState();

      if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        player.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        player.prev();
      } else if (e.key === 'Escape' && ui.nowPlayingOpen) {
        e.preventDefault();
        ui.setNowPlaying(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (phase === 'loading') {
    return (
      <div className="h-full grid place-items-center" style={{ background: 'var(--color-bg)' }}>
        <div className="cover-shimmer w-12 h-12 rounded-full" />
      </div>
    );
  }
  if (phase === 'setup' || phase === 'login') {
    return (
      <ChunkBoundary>
        {/* Keep the bootstrap shimmer up while the Login chunk downloads —
            a null fallback would flash a blank page on slow networks. */}
        <Suspense
          fallback={
            <div className="h-full grid place-items-center" style={{ background: 'var(--color-bg)' }}>
              <div className="cover-shimmer w-12 h-12 rounded-full" />
            </div>
          }
        >
          <LoginPage />
        </Suspense>
      </ChunkBoundary>
    );
  }
  return <Shell />;
}

function Shell() {
  const location = useLocation();
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 flex min-h-0 relative">
        <Sidebar />
        <main className="flex-1 overflow-y-auto relative min-w-0">
          <MobileTopBar />
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {/* Suspense INSIDE the motion wrapper so AnimatePresence exit
                  animations still see a mounted direct child. */}
              <Suspense fallback={null}>
                <ChunkBoundary>
                <Routes location={location}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/albums" element={<AlbumsPage />} />
                  <Route path="/albums/:id" element={<AlbumPage />} />
                  <Route path="/artists" element={<ArtistsPage />} />
                  <Route path="/artists/:id" element={<ArtistPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/favorites" element={<FavoritesPage />} />
                  <Route path="/playlists" element={<PlaylistsPage />} />
                  <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
                </ChunkBoundary>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
        <NowPlaying />
        <QueuePanel />
      </div>
      <PlayerBar />
    </div>
  );
}
