import { create } from 'zustand';

type AuthPhase =
  | 'loading'      // checking /api/auth/status
  | 'setup'        // server has no password yet, show setup screen
  | 'login'        // server has password, user not authenticated
  | 'authenticated';

interface AuthState {
  phase: AuthPhase;
  setPhase: (p: AuthPhase) => void;
}

export const useAuth = create<AuthState>((set) => ({
  phase: 'loading',
  setPhase: (p) => set({ phase: p })
}));
