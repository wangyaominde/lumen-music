import { create } from 'zustand';

interface UIState {
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  setNowPlaying: (b: boolean) => void;
  setQueueOpen: (b: boolean) => void;
  toggleNowPlaying: () => void;
  toggleQueue: () => void;
}

export const useUI = create<UIState>((set, get) => ({
  nowPlayingOpen: false,
  queueOpen: false,
  setNowPlaying: (b) => set({ nowPlayingOpen: b }),
  setQueueOpen: (b) => set({ queueOpen: b }),
  toggleNowPlaying: () => set({ nowPlayingOpen: !get().nowPlayingOpen }),
  toggleQueue: () => set({ queueOpen: !get().queueOpen })
}));
