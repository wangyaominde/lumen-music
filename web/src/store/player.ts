import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '../api/types';
import { streamUrl } from '../api';

type Repeat = 'off' | 'one' | 'all';

interface PlayerState {
  queue: Track[];
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: Repeat;
  shuffle: boolean;
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
  addNext: (tracks: Track[]) => void;
  enqueue: (tracks: Track[]) => void;
  removeAt: (idx: number) => void;
  clearQueue: () => void;

  // internal
  _setTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _setIsPlaying: (p: boolean) => void;
}

export const audio = new Audio();
audio.preload = 'auto';
audio.crossOrigin = 'anonymous';

// --- Web Audio analyser (lazy, single instance) ---
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;

export function ensureAudioGraph() {
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

function loadAndPlay(track: Track) {
  ensureAudioGraph();
  audio.src = streamUrl(track.id);
  audio.play().catch(() => {});
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      index: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.85,
      muted: false,
      repeat: 'off',
      shuffle: false,
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
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
      },

      next(auto = false) {
        const { queue, index, repeat, shuffle, shuffleOrder, shuffleCursor } = get();
        if (queue.length === 0) return;

        if (auto && repeat === 'one') {
          loadAndPlay(queue[index]);
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
          audio.currentTime = 0;
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
        if (Number.isFinite(t)) audio.currentTime = t;
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
            set({ queue: [], index: -1 });
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
        set({ queue: [], index: -1, currentTime: 0, duration: 0, isPlaying: false });
      },

      _setTime(t) { set({ currentTime: t }); },
      _setDuration(d) { set({ duration: d }); },
      _setIsPlaying(p) { set({ isPlaying: p }); }
    }),
    {
      name: 'lumen-player',
      partialize: (s) => ({
        volume: s.volume,
        muted: s.muted,
        repeat: s.repeat,
        shuffle: s.shuffle
      })
    }
  )
);

audio.addEventListener('timeupdate', () => {
  usePlayer.getState()._setTime(audio.currentTime);
});
audio.addEventListener('loadedmetadata', () => {
  usePlayer.getState()._setDuration(audio.duration || 0);
});
audio.addEventListener('durationchange', () => {
  usePlayer.getState()._setDuration(audio.duration || 0);
});
audio.addEventListener('play', () => usePlayer.getState()._setIsPlaying(true));
audio.addEventListener('pause', () => usePlayer.getState()._setIsPlaying(false));
audio.addEventListener('ended', () => usePlayer.getState().next(true));

audio.volume = usePlayer.getState().volume;
audio.muted = usePlayer.getState().muted;

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => usePlayer.getState().toggle());
  navigator.mediaSession.setActionHandler('pause', () => usePlayer.getState().toggle());
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayer.getState().prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayer.getState().next());
}

export function currentTrack(): Track | null {
  const s = usePlayer.getState();
  return s.queue[s.index] ?? null;
}
