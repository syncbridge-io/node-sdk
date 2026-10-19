import fs from 'node:fs';
import process from 'node:process';
import { startWorker } from '../../src/index.js';

/*
 * A host starting a worker as SBT_HOST_OPTIONS (a JSON file) tells, and
 * writing its pid once its app runs: the test then kills this host
 */
const options = JSON.parse(
  fs.readFileSync(process.env.SBT_HOST_OPTIONS!, 'utf8'),
);
const worker = await startWorker(options);
await worker.waitForStatus(['started']);
process.stdout.write(`worker ${worker.pid}\n`);
setInterval(() => undefined, 1000);
