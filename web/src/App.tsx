import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { NowPlaying } from './components/NowPlaying';
import { QueuePanel } from './components/QueuePanel';
import { HomePage } from './pages/Home';
import { AlbumsPage } from './pages/Albums';
import { AlbumPage } from './pages/Album';
import { ArtistsPage } from './pages/Artists';
import { ArtistPage } from './pages/Artist';
import { SearchPage } from './pages/Search';
import { FavoritesPage } from './pages/Favorites';
import { PlaylistsPage, PlaylistDetailPage } from './pages/Playlists';
import { SettingsPage } from './pages/Settings';
import { LoginPage } from './pages/Login';
import { useAuth } from './store/auth';
import { api, setUnauthorizedHandler } from './api';
import { audio } from './store/player';

export function App() {
  const phase = useAuth(s => s.phase);
  const setPhase = useAuth(s => s.setPhase);

  // Bootstrap: figure out if password is set + if we're authenticated.
  useEffect(() => {
    let cancelled = false;
    api.authStatus()
      .then(s => {
        if (cancelled) return;
        if (!s.configured) setPhase('setup');
        else if (!s.authenticated) setPhase('login');
        else setPhase('authenticated');
      })
      .catch(() => { if (!cancelled) setPhase('login'); });
    return () => { cancelled = true; };
  }, [setPhase]);

  // Globally route 401 → login screen (and stop any playback).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* */ }
      setPhase('login');
    });
    return () => setUnauthorizedHandler(null);
  }, [setPhase]);

  if (phase === 'loading') {
    return (
      <div className="h-full grid place-items-center" style={{ background: 'var(--color-bg)' }}>
        <div className="cover-shimmer w-12 h-12 rounded-full" />
      </div>
    );
  }
  if (phase === 'setup' || phase === 'login') return <LoginPage />;
  return <Shell />;
}

function Shell() {
  const location = useLocation();
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 flex min-h-0 relative">
        <Sidebar />
        <main className="flex-1 overflow-y-auto relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
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
