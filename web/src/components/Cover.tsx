import { useEffect, useState } from 'react';
import { coverUrl } from '../api';
import { AlbumIcon } from './icons';

interface Props {
  albumId: number | null | undefined;
  hasCover?: boolean | number;
  alt?: string;
  className?: string;
  rounded?: string;
}

export function Cover({ albumId, hasCover, alt, className = '', rounded = 'rounded-[10px]' }: Props) {
  const url = coverUrl(albumId, hasCover);
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
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        </>
      )}
    </div>
  );
}
