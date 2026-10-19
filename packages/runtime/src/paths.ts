import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `.js` when built, `.ts` when the source runs under a TypeScript loader */
const EXT = path.extname(fileURLToPath(import.meta.url));

/**
 * The URL of the module a worker preloads with `--import`, which installs
 * the resolve hooks of its plan (see loader.ts).
 */
export const LOADER_URL = new URL('./loader' + EXT, import.meta.url).href;

/** The entry module of a worker started with `startWorker` */
export const WORKER_URL = new URL('./worker' + EXT, import.meta.url).href;
