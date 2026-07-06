import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '../api/types';
import { api, streamUrl } from '../api';

type Repeat = 'off' | 'one' | 'all';
export type Quality = 'auto' | 'lossless' | 'aac256' | 'aac128';
type TranscodeQuality = 'aac256' | 'aac128';
type EffectiveQuality = 'lossless' | TranscodeQuality;

interface PlayerState {
  queue: Track[];
  index: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: Repeat;
  shuffle: boolean;
  quality: Quality;
  shuffleOrder: number[]; // queue indices in shuffled order
  shuffleCursor: number;

  playNow: (track: Track, queue?: Track[]) => void;
  playQueue: (queue: Track[], startIndex?: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setQuality: (q: Quality) => void;
  addNext: (tracks: Track[]) => void;
  enqueue: (tracks: Track[]) => void;
  removeAt: (idx: number) => void;
  clearQueue: () => void;

  // internal
  _setTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _setIsPlaying: (p: boolean) => void;
  _setBuffering: (b: boolean) => void;
}

export const audio = new Audio();
audio.preload = 'auto';
audio.crossOrigin = 'anonymous';

// --- Web Audio analyser (lazy, single instance) ---
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;

/**
 * Mobile browsers (iOS Safari especially) suspend the AudioContext when the
 * tab goes to background or the phone locks. Once `createMediaElementSource`
 * has rerouted our <audio> through that context, suspension means silence —
 * defeating the whole point of the lock-screen MediaSession controls.
 *
 * On those platforms we skip the analyser entirely. The audio element plays
 * straight to the speakers and the OS happily keeps it going in background.
 * The eq-bars visualizer just stays at its idle scale on mobile, which is a
 * fair trade for working background playback.
 */
export const isMobile = (() => {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod|Android|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent)) return true;
  // iPadOS reports as Mac in the UA but has touch
  return navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.userAgent);
})();

export const hasAnalyser = () => analyser !== null;

export function ensureAudioGraph() {
  if (isMobile) return; // see comment above
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return;
  }
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return;
  try {
    audioCtx = new Ctor();
    mediaSource = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    mediaSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  } catch {
    audioCtx = null;
    analyser = null;
    mediaSource = null;
    freqData = null;
  }
}

// Returns N normalized [0..1] band values, or zero-filled if graph not ready.
const emptyBands = (n: number) => new Array(n).fill(0);
export function getFrequencyBands(bands: number): number[] {
  if (!analyser || !freqData) return emptyBands(bands);
  analyser.getByteFrequencyData(freqData);
  const result = emptyBands(bands);
  const len = freqData.length;
  // Skip the lowest bin (often DC noise) and use a log-ish bucket distribution.
  const usable = len - 1;
  const bandSize = Math.max(1, Math.floor(usable / bands));
  for (let i = 0; i < bands; i++) {
    let sum = 0;
    const start = 1 + i * bandSize;
    const end = i === bands - 1 ? len : start + bandSize;
    for (let j = start; j < end; j++) sum += freqData[j];
    result[i] = sum / (end - start) / 255;
  }
  return result;
}

function shuffled(n: number, except?: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (except !== undefined) {
    const k = arr.indexOf(except);
    if (k > 0) [arr[0], arr[k]] = [arr[k], arr[0]];
  }
  return arr;
}

// --- Server transcode capability (lazy, memoized) ---
let serverTranscoding: boolean | null = null; // null = not asked yet / ask failed
let configPromise: Promise<void> | null = null;

function ensureConfig(): Promise<void> {
  if (serverTranscoding !== null) return Promise.resolve();
  if (!configPromise) {
    configPromise = api.getConfig()
      .then((cfg) => { serverTranscoding = cfg.transcoding; })
      .catch(() => {
        // e.g. 401 before login — behave as "no transcoding" for now and
        // re-ask on the next track load.
        configPromise = null;
      });
  }
  return configPromise;
}

// Tracks the most-recent track id we tried to play so stale `play()` promises
// from rapid track-switching can be ignored when they finally resolve/reject.
let loadGeneration = 0;

// Transcoded streams (?quality=…) are not seekable — seeking re-requests the
// stream with ?t=<seconds> and the element then reports time relative to that
// offset. `baseOffset` bridges the two: effective time = baseOffset + currentTime.
let baseOffset = 0;
let activeQuality: EffectiveQuality = 'lossless';

function setSource(trackId: number, quality: EffectiveQuality, offset: number) {
  // Tear down the previous load FIRST. Without this, rapid track switches
  // can leave the prior fetch + media decoder in mid-teardown when we kick
  // off the next one — after enough cycles the browser hits its 6-per-origin
  // concurrent-connection cap and new tracks just stop loading.
  try { audio.pause(); } catch { /* not in any state, fine */ }
  // empty src + load() is the spec-defined "reset" sequence for an
  // HTMLMediaElement; clears the network task and resource and keeps the
  // element addressable.
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* */ }
  activeQuality = quality;
  baseOffset = quality === 'lossless' ? 0 : offset;
  audio.src = quality === 'lossless'
    ? streamUrl(trackId)
    : streamUrl(trackId, { quality, t: offset });
}

function loadAndPlay(track: Track) {
  ensureAudioGraph();
  // Lazy capability probe: the answer lands before the next track if not this one.
  void ensureConfig();
  const gen = ++loadGeneration;
  resetRecovery();
  prefetchedThisTrack = false;
  setSource(track.id, effectiveQuality(track), 0);
  // Don't keep retrying on stale errors — only the latest load wins.
  audio.play().catch((err) => {
    if (gen !== loadGeneration) return; // a newer track is already underway
    // AbortError shows up legitimately when the user paused before we got
    // here; it's not actionable.
    if ((err as DOMException)?.name === 'AbortError') return;
    // Anything else: we'll surface via the audio element's own error event.
  });
}

// Re-request a transcoded stream from a new offset (transcode-mode "seek").
function reloadTranscoded(trackId: number, quality: TranscodeQuality, t: number, resume: boolean) {
  const gen = ++loadGeneration;
  resetRecovery();
  setSource(trackId, quality, t);
  // No timeupdate until data arrives — reflect the target position right away.
  usePlayer.setState({ currentTime: t });
  if (!resume) return;
  audio.play().catch((err) => {
    if (gen !== loadGeneration) return;
    if ((err as DOMException)?.name === 'AbortError') return;
  });
}

// --- Network resilience ---
// Cellular connections drop mid-song all the time (tunnels, parking garages).
// Instead of stopping silently, retry with backoff from the position we lost,
// and keep an ear out for connectivity returning after the budget runs out.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let onlineListener: (() => void) | null = null;
let recoveryWasPlaying = false;
let recoveryPosition = 0;

function cancelRecovery() {
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  if (onlineListener) { window.removeEventListener('online', onlineListener); onlineListener = null; }
}

function resetRecovery() {
  retryAttempt = 0;
  cancelRecovery();
}

function beginRecovery() {
  const track = currentTrack();
  if (!track) return;
  if (retryTimer !== null || onlineListener !== null) return; // already recovering
  if (retryAttempt === 0) {
    // Fresh incident — capture where we were and whether to resume. Later
    // attempts reset the element, so these would read as zero/paused then.
    recoveryWasPlaying = usePlayer.getState().isPlaying || !audio.paused;
    recoveryPosition = baseOffset + audio.currentTime;
  }
  scheduleRetry(track);
}

function scheduleRetry(track: Track) {
  // A failed attempt can surface twice (error event + play() rejection) —
  // never arm a second timer on top of a pending one.
  if (retryTimer !== null || onlineListener !== null) return;
  const gen = loadGeneration;
  if (retryAttempt >= RETRY_DELAYS_MS.length) {
    // Budget spent — self-heal the moment connectivity returns.
    onlineListener = () => {
      onlineListener = null;
      if (gen !== loadGeneration) return;
      retryAttempt = 0;
      scheduleRetry(track);
    };
    window.addEventListener('online', onlineListener, { once: true });
    return;
  }
  const delay = RETRY_DELAYS_MS[retryAttempt++];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (gen !== loadGeneration) return; // user moved on; recovery is moot
    retryLoad(track, gen);
  }, delay);
}

function retryLoad(track: Track, gen: number) {
  const pos = recoveryPosition;
  const q = activeQuality;
  if (q !== 'lossless') {
    setSource(track.id, q, pos);
  } else {
    setSource(track.id, 'lossless', 0);
    // Same URL restarts from byte 0 — jump back once metadata is in
    // (setting currentTime before that throws).
    const restore = () => {
      audio.removeEventListener('loadedmetadata', restore);
      if (gen !== loadGeneration) return;
      if (pos > 0 && Number.isFinite(pos)) {
        try { audio.currentTime = pos; } catch { /* */ }
      }
    };
    audio.addEventListener('loadedmetadata', restore);
  }
  if (!recoveryWasPlaying) return;
  usePlayer.getState()._setBuffering(true);
  audio.play().catch((err) => {
    if (gen !== loadGeneration) return;
    if ((err as DOMException)?.name === 'AbortError') return;
    scheduleRetry(track); // play() refused — burn the next attempt
  });
}

// Full detach (clear queue / remove last track): kill any pending recovery
// and forget transcode state so the next load starts clean.
function resetPlaybackState() {
  loadGeneration++;
  resetRecovery();
  baseOffset = 0;
  activeQuality = 'lossless';
}

// --- Next-track prefetch ---
// Near the end of a track, warm the HTTP cache with the first chunk of the
// next one so the gap between songs doesn't stall on cellular latency.
// Raw mode only: transcoded streams are no-store.
let prefetchedThisTrack = false;

function peekNextTrack(): Track | null {
  const { queue, index, repeat, shuffle, shuffleOrder, shuffleCursor } = usePlayer.getState();
  if (queue.length === 0 || repeat === 'one') return null;
  if (shuffle) {
    const cur = shuffleCursor + 1;
    if (cur >= shuffleOrder.length) return null; // wrap reshuffles — unpredictable
    return queue[shuffleOrder[cur]] ?? null;
  }
  const nextIdx = index + 1;
  if (nextIdx >= queue.length) return repeat === 'all' ? queue[0] : null;
  return queue[nextIdx];
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      index: -1,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
      repeat: 'off',
      shuffle: false,
      // Lossless by default — audio quality is never silently degraded.
      // AAC transcoding is strictly opt-in via Settings.
      quality: 'lossless',
      shuffleOrder: [],
      shuffleCursor: 0,

      playNow(track, queue) {
        const q = queue ?? [track];
        const idx = Math.max(0, q.findIndex(t => t.id === track.id));
        set({
          queue: q,
          index: idx,
          shuffleOrder: get().shuffle ? shuffled(q.length, idx) : [],
          shuffleCursor: 0
        });
        loadAndPlay(q[idx]);
      },

      playQueue(queue, startIndex = 0) {
        if (queue.length === 0) return;
        const idx = Math.min(startIndex, queue.length - 1);
        set({
          queue,
          index: idx,
          shuffleOrder: get().shuffle ? shuffled(queue.length, idx) : [],
          shuffleCursor: 0
        });
        loadAndPlay(queue[idx]);
      },

      toggle() {
        ensureAudioGraph();
        if (audio.paused) {
          audio.play().catch(() => {});
        } else {
          // An explicit pause ends any in-flight network recovery — otherwise
          // a pending retry (or the armed 'online' listener, hours later)
          // would force playback back on against the user's intent.
          audio.pause();
          recoveryWasPlaying = false;
          resetRecovery();
        }
      },

      next(auto = false) {
        const { queue, index, repeat, shuffle, shuffleOrder, shuffleCursor } = get();
        if (queue.length === 0) return;

        if (auto && repeat === 'one') {
          // Rewind in place instead of tearing down and re-downloading.
          const q = activeQuality;
          if (q === 'lossless') {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          } else {
            reloadTranscoded(queue[index].id, q, 0, true);
          }
          return;
        }

        let nextIdx: number;
        if (shuffle) {
          const cur = shuffleCursor + 1;
          if (cur >= shuffleOrder.length) {
            if (repeat === 'all') {
              const order = shuffled(queue.length);
              set({ shuffleOrder: order, shuffleCursor: 0 });
              nextIdx = order[0];
            } else {
              audio.pause();
              return;
            }
          } else {
            set({ shuffleCursor: cur });
            nextIdx = shuffleOrder[cur];
          }
        } else {
          nextIdx = index + 1;
          if (nextIdx >= queue.length) {
            if (repeat === 'all') nextIdx = 0;
            else { audio.pause(); return; }
          }
        }
        set({ index: nextIdx });
        loadAndPlay(queue[nextIdx]);
      },

      prev() {
        const { queue, index, currentTime, shuffle, shuffleOrder, shuffleCursor } = get();
        if (queue.length === 0) return;
        if (currentTime > 3) {
          get().seek(0);
          return;
        }
        let prevIdx: number;
        if (shuffle) {
          const cur = Math.max(0, shuffleCursor - 1);
          set({ shuffleCursor: cur });
          prevIdx = shuffleOrder[cur] ?? index;
        } else {
          prevIdx = Math.max(0, index - 1);
        }
        set({ index: prevIdx });
        loadAndPlay(queue[prevIdx]);
      },

      seek(t) {
        if (!Number.isFinite(t)) return;
        const q = activeQuality;
        if (q !== 'lossless') {
          // Transcoded streams aren't seekable — re-request from the offset.
          const track = currentTrack();
          if (!track) return;
          // ffmpeg -ss at/past EOF yields a zero-byte stream and a fatal
          // media error instead of 'ended' — stop just short of the end so
          // the track finishes (and advances) naturally.
          const dur = resolveDuration();
          const target = Number.isFinite(dur) && dur > 1
            ? Math.min(Math.max(0, t), dur - 0.5)
            : Math.max(0, t);
          reloadTranscoded(track.id, q, target, get().isPlaying);
          return;
        }
        audio.currentTime = t;
      },

      setVolume(v) {
        const vol = Math.min(1, Math.max(0, v));
        audio.volume = vol;
        if (vol > 0 && get().muted) audio.muted = false;
        set({ volume: vol, muted: vol === 0 ? false : get().muted });
      },

      toggleMute() {
        const m = !get().muted;
        audio.muted = m;
        set({ muted: m });
      },

      cycleRepeat() {
        const r = get().repeat;
        const next: Repeat = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
        set({ repeat: next });
      },

      toggleShuffle() {
        const s = !get().shuffle;
        const { queue, index } = get();
        set({
          shuffle: s,
          shuffleOrder: s ? shuffled(queue.length, index) : [],
          shuffleCursor: 0
        });
      },

      setQuality(q) {
        set({ quality: q });
      },

      addNext(tracks) {
        const { queue, index } = get();
        const newQueue = [...queue.slice(0, index + 1), ...tracks, ...queue.slice(index + 1)];
        set({ queue: newQueue });
      },

      enqueue(tracks) {
        const { queue, shuffle } = get();
        const newQueue = [...queue, ...tracks];
        set({ queue: newQueue, shuffleOrder: shuffle ? shuffled(newQueue.length, get().index) : [] });
        if (get().index === -1 && tracks.length > 0) {
          set({ index: 0 });
          loadAndPlay(newQueue[0]);
        }
      },

      removeAt(idx) {
        const { queue, index } = get();
        if (idx < 0 || idx >= queue.length) return;
        const newQueue = queue.filter((_, i) => i !== idx);
        let newIndex = index;
        if (idx === index) {
          if (newQueue.length === 0) {
            audio.pause();
            audio.removeAttribute('src');
            resetPlaybackState();
            set({ queue: [], index: -1, isBuffering: false });
            return;
          }
          newIndex = Math.min(index, newQueue.length - 1);
          set({ queue: newQueue, index: newIndex });
          loadAndPlay(newQueue[newIndex]);
          return;
        }
        if (idx < index) newIndex = index - 1;
        set({ queue: newQueue, index: newIndex });
      },

      clearQueue() {
        audio.pause();
        audio.removeAttribute('src');
        resetPlaybackState();
        set({ queue: [], index: -1, currentTime: 0, duration: 0, isPlaying: false, isBuffering: false });
      },

      _setTime(t) { set({ currentTime: t }); },
      _setDuration(d) { set({ duration: d }); },
      _setIsPlaying(p) { set({ isPlaying: p }); },
      _setBuffering(b) { set({ isBuffering: b }); }
    }),
    {
      name: 'lumen-player',
      partialize: (s) => ({
        volume: s.volume,
        muted: s.muted,
        repeat: s.repeat,
        shuffle: s.shuffle,
        quality: s.quality
      })
    }
  )
);

// In transcode mode the element's duration is unreliable (Infinity/NaN while
// streaming, or just the remainder after a ?t= offset) — fall back to the
// library's known duration so the seek bar and lyrics keep working.
function resolveDuration(): number {
  return Number.isFinite(audio.duration) && baseOffset === 0
    ? audio.duration
    : (currentTrack()?.duration ?? 0);
}

// Watchdog needs to know when the element last showed signs of life.
let lastMediaActivity = 0;

audio.addEventListener('timeupdate', () => {
  lastMediaActivity = performance.now();
  usePlayer.getState()._setTime(baseOffset + audio.currentTime);
});
audio.addEventListener('progress', () => {
  lastMediaActivity = performance.now();
});
audio.addEventListener('loadedmetadata', () => {
  usePlayer.getState()._setDuration(resolveDuration());
});
audio.addEventListener('durationchange', () => {
  usePlayer.getState()._setDuration(resolveDuration());
});
audio.addEventListener('play', () => usePlayer.getState()._setIsPlaying(true));
audio.addEventListener('pause', () => {
  usePlayer.getState()._setIsPlaying(false);
  usePlayer.getState()._setBuffering(false);
});
audio.addEventListener('waiting', () => usePlayer.getState()._setBuffering(true));
audio.addEventListener('playing', () => {
  // Playback actually resumed — the incident (if any) is over.
  resetRecovery();
  usePlayer.getState()._setBuffering(false);
});
audio.addEventListener('ended', () => usePlayer.getState().next(true));

// Surface load / decode errors to the console so "playback freezes" becomes
// debuggable instead of a silent stop. MEDIA_ERR_ codes:
//   1 ABORTED   2 NETWORK   3 DECODE   4 SRC_NOT_SUPPORTED
audio.addEventListener('error', () => {
  const err = audio.error;
  if (!err) return;
  const codes = ['', 'ABORTED', 'NETWORK', 'DECODE', 'SRC_NOT_SUPPORTED'];
  console.warn(`[lumen] audio error: code=${err.code} (${codes[err.code] ?? '?'}) src=${audio.src}`, err.message);
  // Network / decode failures mid-stream are usually transient on cellular.
  if (err.code === MediaError.MEDIA_ERR_NETWORK || err.code === MediaError.MEDIA_ERR_DECODE) {
    beginRecovery();
  }
});

// Starvation watchdog: Chrome fires 'stalled' spuriously, so never trust it
// alone. While the store says we're playing, poll for the combination of
// "element wants to play, has no runway, and showed no progress/timeupdate
// for 8s" — that's a real silent stall, so run the recovery path.
const WATCHDOG_POLL_MS = 5000;
const STARVED_AFTER_MS = 8000;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function startWatchdog() {
  if (watchdogTimer !== null) return;
  lastMediaActivity = performance.now();
  watchdogTimer = setInterval(() => {
    if (audio.paused) return;
    if (audio.readyState >= audio.HAVE_FUTURE_DATA) return;
    if (performance.now() - lastMediaActivity < STARVED_AFTER_MS) return;
    beginRecovery();
  }, WATCHDOG_POLL_MS);
}
function stopWatchdog() {
  if (watchdogTimer === null) return;
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

usePlayer.subscribe((state, prev) => {
  if (state.isPlaying === prev.isPlaying) return;
  if (state.isPlaying) startWatchdog();
  else stopWatchdog();
});

audio.volume = usePlayer.getState().volume;
audio.muted = usePlayer.getState().muted;

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => usePlayer.getState().toggle());
  navigator.mediaSession.setActionHandler('pause', () => usePlayer.getState().toggle());
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayer.getState().prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayer.getState().next());
  try {
    navigator.mediaSession.setActionHandler('seekto', (details: any) => {
      if (typeof details?.seekTime === 'number') usePlayer.getState().seek(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details: any) => {
      const offset = typeof details?.seekOffset === 'number' ? details.seekOffset : 10;
      usePlayer.getState().seek(Math.max(0, baseOffset + audio.currentTime - offset));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details: any) => {
      const offset = typeof details?.seekOffset === 'number' ? details.seekOffset : 10;
      const dur = resolveDuration();
      const target = baseOffset + audio.currentTime + offset;
      usePlayer.getState().seek(dur > 0 ? Math.min(dur, target) : target);
    });
  } catch { /* older browsers without these handlers */ }
}

// Keep the lock-screen progress bar in sync. Throttle the call: spec says it's
// fine to call once per second; calling on every timeupdate is wasteful.
let lastPositionUpdate = 0;
audio.addEventListener('timeupdate', () => {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const now = performance.now();
  if (now - lastPositionUpdate < 750) return;
  lastPositionUpdate = now;
  const dur = resolveDuration();
  const pos = baseOffset + audio.currentTime;
  // setPositionState throws on NaN/Infinity or position > duration.
  if (!Number.isFinite(dur) || dur <= 0 || !Number.isFinite(pos)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(0, pos), dur)
    });
  } catch { /* */ }
});

// Prefetch trigger: once per track, when less than 20s remain. Only Chromium
// stores and reuses partial (206) responses from its HTTP cache — on Safari
// and Firefox the prefetched bytes would be thrown away, which on cellular is
// worse than useless.
const cachesPartialResponses = typeof (window as any).chrome !== 'undefined';
audio.addEventListener('timeupdate', () => {
  if (prefetchedThisTrack || !cachesPartialResponses) return;
  const dur = resolveDuration();
  if (!Number.isFinite(dur) || dur <= 0) return;
  if (dur - (baseOffset + audio.currentTime) >= 20) return;
  const cur = currentTrack();
  const next = peekNextTrack();
  if (!next || next.id === cur?.id) return;
  // Gate on the mode the NEXT track would load in — its transcoded stream
  // would be no-store, so only raw loads benefit from a warmed cache.
  if (effectiveQuality(next) !== 'lossless') return;
  prefetchedThisTrack = true;
  // The first 1.5MB is plenty to start playback; the server marks stream
  // responses cacheable, so this lands in the browser HTTP cache.
  fetch(streamUrl(next.id), {
    headers: { Range: 'bytes=0-1572863' },
    credentials: 'include'
  }).catch(() => {});
});

export function currentTrack(): Track | null {
  const s = usePlayer.getState();
  return s.queue[s.index] ?? null;
}

// Resolve the user's quality preference against what the server can do —
// globally (ffmpeg present?) AND per track. The server only transcodes
// lossless source formats and silently serves raw bytes (ignoring ?t) for
// everything else, so requesting transcode mode for an MP3 would corrupt the
// client's baseOffset time model and break seeking. `transcodable` comes from
// the server in track payloads; when the field is missing (stale cache, old
// server) we assume raw, which always plays correctly.
export function effectiveQuality(track?: Track | null): EffectiveQuality {
  if (track && !track.transcodable) return 'lossless';
  const pref = usePlayer.getState().quality;
  if (pref === 'lossless' || serverTranscoding !== true) return 'lossless';
  if (pref === 'aac256' || pref === 'aac128') return pref;
  // 'auto': never silently downgrade — stay lossless unless the device's own
  // OS data-saver is switched on (an explicit "I want less data" signal from
  // the user), in which case fall back to high-bitrate AAC.
  const saveData = typeof navigator !== 'undefined'
    && (navigator as any).connection?.saveData === true;
  return saveData ? 'aac256' : 'lossless';
}
