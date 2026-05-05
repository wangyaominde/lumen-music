import type {
  AlbumSummary, ArtistSummary, Candidate, EnrichBatchState, LibraryDir,
  PlaylistSummary, ScanState, SearchResult, Stats, Track
} from './types';

// Single subscriber that AuthProvider hooks up — when ANY API call returns
// 401 (session expired / nuked), it kicks the app back to the login screen.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function handle<T>(r: Response, url: string): Promise<T> {
  if (r.status === 401) {
    onUnauthorized?.();
    throw new Error('unauthorized');
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({} as any));
    throw new Error(err?.message ?? err?.error ?? `${r.status} ${url}`);
  }
  return r.json() as Promise<T>;
}

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  return handle<T>(r, url);
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  return handle<T>(r, url);
}
async function jdel<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
  return handle<T>(r, url);
}

export const api = {
  stats: () => jget<Stats>('/api/stats'),
  albums: (params: { sort?: string; q?: string; page?: number; pageSize?: number } = {}) => {
    const u = new URL('/api/albums', location.origin);
    if (params.sort) u.searchParams.set('sort', params.sort);
    if (params.q) u.searchParams.set('q', params.q);
    if (params.page) u.searchParams.set('page', String(params.page));
    if (params.pageSize) u.searchParams.set('pageSize', String(params.pageSize));
    return jget<{ items: AlbumSummary[]; total: number; page: number; pageSize: number }>(u.pathname + u.search);
  },
  album: (id: number) => jget<{ album: any; tracks: Track[] }>(`/api/albums/${id}`),
  artists: (sort: 'name' | 'albums' | 'tracks' = 'name') => jget<ArtistSummary[]>(`/api/artists?sort=${sort}`),
  artist: (id: number) => jget<{ artist: ArtistSummary; albums: AlbumSummary[]; topTracks: any[] }>(`/api/artists/${id}`),
  track: (id: number) => jget<Track & { has_cover: number }>(`/api/tracks/${id}`),
  search: (q: string) => jget<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
  recentAlbums: () => jget<AlbumSummary[]>('/api/recent/albums'),

  scanDirs: () => jget<LibraryDir[]>('/api/scan/dirs'),
  addScanDir: (path: string) => jpost<{ id: number; path: string }>('/api/scan/dirs', { path }),
  removeScanDir: (id: number) => jdel<{ ok: true }>(`/api/scan/dirs/${id}`),
  runScan: () => jpost<{ ok: true; started: true }>('/api/scan/run'),
  scanStatus: () => jget<ScanState>('/api/scan/status'),

  favorites: () => jget<Track[]>('/api/favorites'),
  favoriteIds: () => jget<number[]>('/api/favorites/ids'),
  addFavorite: (id: number) => jpost<{ ok: true }>(`/api/favorites/${id}`),
  removeFavorite: (id: number) => jdel<{ ok: true }>(`/api/favorites/${id}`),

  playlists: () => jget<PlaylistSummary[]>('/api/playlists'),
  createPlaylist: (name: string) => jpost<{ id: number; name: string }>('/api/playlists', { name }),
  playlist: (id: number) => jget<{ playlist: PlaylistSummary; tracks: any[] }>(`/api/playlists/${id}`),
  addTracksToPlaylist: (id: number, trackIds: number[]) => jpost<{ ok: true; added: number }>(`/api/playlists/${id}/tracks`, { trackIds }),
  removeFromPlaylist: (id: number, ptId: number) => jdel<{ ok: true }>(`/api/playlists/${id}/tracks/${ptId}`),
  deletePlaylist: (id: number) => jdel<{ ok: true }>(`/api/playlists/${id}`),

  lyrics: (id: number) => jget<{ source: string; content: string }>(`/api/lyrics/${id}`),

  enrichCandidates: (trackId: number) =>
    jget<{ track: any; candidates: Candidate[] }>(`/api/enrich/candidates/${trackId}`),
  enrichApply: (trackId: number, candidate: Candidate) =>
    jpost<{ ok: true }>(`/api/enrich/apply/${trackId}`, { candidate }),
  enrichRun: (opts: { minScore?: number; onlyWeak?: boolean } = {}) =>
    jpost<{ ok: true; started: true }>('/api/enrich/run', opts),
  enrichStatus: () => jget<EnrichBatchState>('/api/enrich/status'),
  enrichAlbum: (albumId: number, opts: { minScore?: number } = {}) =>
    jpost<{
      album: string;
      total: number;
      applied: number;
      skipped: number;
      noMatch: number;
      failed: number;
      results: Array<{ track_id: number; title: string; status: 'applied' | 'skipped' | 'no-match' | 'failed'; chosen?: Candidate; topScore?: number }>;
    }>(`/api/enrich/album/${albumId}`, opts),

  authStatus: () => jget<{ configured: boolean; authenticated: boolean }>('/api/auth/status'),
  authSetup: (password: string) => jpost<{ ok: true }>('/api/auth/setup', { password }),
  authLogin: (password: string) => jpost<{ ok: true }>('/api/auth/login', { password }),
  authLogout: () => jpost<{ ok: true }>('/api/auth/logout', {}),
  authChangePassword: (current: string, next: string) =>
    jpost<{ ok: true }>('/api/auth/password', { current, next })
};

export const coverUrl = (albumId: number | null | undefined, has?: number | boolean) =>
  albumId && has ? `/api/cover/album/${albumId}` : '';

export const trackCoverUrl = (trackId: number) => `/api/cover/track/${trackId}`;
export const streamUrl = (trackId: number) => `/api/stream/${trackId}`;
