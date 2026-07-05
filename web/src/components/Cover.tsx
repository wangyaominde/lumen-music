import { useEffect, useState } from 'react';
import { coverUrl, type CoverSize } from '../api';
import { AlbumIcon } from './icons';

interface Props {
  albumId: number | null | undefined;
  hasCover?: boolean | number;
  alt?: string;
  className?: string;
  rounded?: string;
  /** Server-side cover variant: 96 for thumbs, 320 for grids (default), 800 for hero art. */
  size?: CoverSize;
}

export function Cover({ albumId, hasCover, alt, className = '', rounded = 'rounded-[10px]', size = 320 }: Props) {
  const url = coverUrl(albumId, hasCover, size);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [url]);

  return (
    <div className={`cover-wrap ${rounded} ${className}`} aria-label={alt}>
      {!url || errored ? (
        <div className="absolute inset-0 grid place-items-center text-fg-mute" style={{ color: 'var(--color-fg-mute)' }}>
          <AlbumIcon width={32} height={32} />
        </div>
      ) : (
        <>
          {!loaded && <div className={`absolute inset-0 cover-shimmer ${rounded}`} />}
          <img
            src={url}
            alt={alt ?? ''}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        </>
      )}
    </div>
  );
}
