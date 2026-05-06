import { create } from 'zustand';

interface UIState {
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  mobileNavOpen: boolean;
  setNowPlaying: (b: boolean) => void;
  setQueueOpen: (b: boolean) => void;
  setMobileNavOpen: (b: boolean) => void;
  toggleNowPlaying: () => void;
  toggleQueue: () => void;
  toggleMobileNav: () => void;
}

export const useUI = create<UIState>((set, get) => ({
  nowPlayingOpen: false,
  queueOpen: false,
  mobileNavOpen: false,
  setNowPlaying: (b) => set({ nowPlayingOpen: b }),
  setQueueOpen: (b) => set({ queueOpen: b }),
  setMobileNavOpen: (b) => set({ mobileNavOpen: b }),
  toggleNowPlaying: () => set({ nowPlayingOpen: !get().nowPlayingOpen }),
  toggleQueue: () => set({ queueOpen: !get().queueOpen }),
  toggleMobileNav: () => set({ mobileNavOpen: !get().mobileNavOpen })
}));
