import type { SVGProps } from 'react';

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const;

type P = SVGProps<SVGSVGElement>;

export const PlayIcon = (p: P) => (
  <svg {...base} {...p}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" /></svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const PrevIcon = (p: P) => (
  <svg {...base} {...p}><polygon points="19 4 9 12 19 20 19 4" fill="currentColor" stroke="none" /><rect x="5" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const NextIcon = (p: P) => (
  <svg {...base} {...p}><polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" /><rect x="17" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const ShuffleIcon = (p: P) => (
  <svg {...base} {...p}><path d="M16 3h5v5" /><path d="M21 3l-7.5 7.5" /><path d="M21 21h-5v-5" /><path d="M3 3l18 18" /><path d="M21 16l-3.5-3.5" /><path d="M3 21l7.5-7.5" /></svg>
);
export const RepeatIcon = (p: P) => (
  <svg {...base} {...p}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
);
export const RepeatOneIcon = (p: P) => (
  <svg {...base} {...p}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /><text x="11" y="14" fontFamily="Inter,sans-serif" fontSize="6" fontWeight="700" fill="currentColor" stroke="none">1</text></svg>
);
export const VolumeIcon = (p: P) => (
  <svg {...base} {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><path d="M15.54 8.46a5 5 0 0 1 0 7.08" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
);
export const MuteIcon = (p: P) => (
  <svg {...base} {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
export const HeartIcon = (p: P & { filled?: boolean }) => (
  <svg {...base} {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill={p.filled ? 'currentColor' : 'none'} /></svg>
);
export const ListIcon = (p: P) => (
  <svg {...base} {...p}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
);
export const HomeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-5h-2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const AlbumIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg>
);
export const ArtistIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>
);
export const SettingsIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
export const RefreshIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 2v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" /></svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base} {...p}><polyline points="6 9 12 15 18 9" /></svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
);
export const QueueIcon = (p: P) => (
  <svg {...base} {...p}><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="9" y2="18" /><polyline points="17 14 21 18 17 22" /><line x1="21" y1="18" x2="13" y2="18" /></svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base} {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
export const HiResBadge = ({ className }: { className?: string }) => (
  <span className={className}>Hi-Res</span>
);
