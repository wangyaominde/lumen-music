import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.LUMEN_DATA_DIR
  ? path.resolve(process.env.LUMEN_DATA_DIR)
  : path.resolve(ROOT_DIR, 'data');
export const COVERS_DIR = path.resolve(DATA_DIR, 'covers');
export const DB_PATH = path.resolve(DATA_DIR, 'library.db');
export const PORT = Number(process.env.PORT ?? 4477);
export const HOST = process.env.HOST ?? '0.0.0.0';

export const SUPPORTED_EXTENSIONS = new Set([
  '.flac', '.alac', '.m4a', '.mp4',
  '.wav', '.aiff', '.aif',
  '.mp3', '.ogg', '.opus',
  '.ape', '.wv',
  '.dsf', '.dff'
]);

export const LOSSLESS_CODECS = new Set([
  'FLAC', 'ALAC', 'WAV', 'PCM', 'AIFF', 'APE',
  'MONKEY', "MONKEY'S AUDIO",
  'WAVPACK', 'WV',
  'DSD', 'DSF', 'DFF'
]);
