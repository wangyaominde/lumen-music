import { create } from 'zustand';
import type { Role } from '../api/types';

// "Light" user — only what the UI needs. Avoids requiring created_at/updated_at
// for shapes returned by /api/auth/status (which omits them).
interface SessionUser {
  id: number;
  username: string;
  role: Role;
}

type AuthPhase =
  | 'loading'
  | 'setup'         // server has no users yet → first-run, will create admin
  | 'login'         // server configured, user not authenticated
  | 'authenticated';

interface AuthState {
  phase: AuthPhase;
  user: SessionUser | null;
  setPhase: (p: AuthPhase) => void;
  setUser: (u: SessionUser | null) => void;
  isAdmin: () => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  phase: 'loading',
  user: null,
  setPhase: (p) => set({ phase: p }),
  setUser: (u) => set({ user: u }),
  isAdmin: () => get().user?.role === 'admin'
}));
