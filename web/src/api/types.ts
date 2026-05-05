export interface Stats {
  tracks: number;
  albums: number;
  artists: number;
  duration: number;
  lossless: number;
}

export interface AlbumSummary {
  id: number;
  name: string;
  album_artist: string;
  year: number | null;
  genre: string | null;
  track_count: number;
  duration: number;
  has_cover: number | boolean;
}

export interface AlbumDetail extends AlbumSummary {
  cover_path: string | null;
  artist_id: number | null;
  added_at: number;
}

export interface ArtistSummary {
  id: number;
  name: string;
  sort_name: string;
  album_count: number;
  track_count: number;
}

export interface Track {
  id: number;
  title: string;
  artist_name: string;
  album_id: number | null;
  album_name: string;
  album_artist: string;
  track_no: number | null;
  disc_no: number | null;
  duration: number | null;
  codec: string | null;
  container: string | null;
  lossless: number | boolean;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  file_size: number | null;
}

export interface SearchResult {
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export interface ScanState {
  running: boolean;
  total: number;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  failed: number;
  current: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export interface LibraryDir {
  id: number;
  path: string;
  added_at: number;
  last_scan: number | null;
}

export interface PlaylistSummary {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
  track_count: number;
  duration: number;
}

export interface Candidate {
  source: 'musicbrainz' | 'netease' | 'path';
  score: number;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  year: number | null;
  track_no: number | null;
  disc_no: number | null;
  genre: string | null;
  cover_url: string | null;
  external_id: string;
  duration_ms?: number | null;
  meta?: Record<string, unknown>;
}

export interface EnrichBatchState {
  running: boolean;
  total: number;
  done: number;
  improved: number;
  skipped: number;
  failed: number;
  current: string;
  startedAt: number | null;
  finishedAt: number | null;
}
