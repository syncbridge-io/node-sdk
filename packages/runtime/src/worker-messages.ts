/** What a worker started with `startWorker` reports to its host */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'log'; level: string; source?: string; message: string }
  | { type: 'status'; status: string; message: string }
  | { type: 'component-status'; path: string; status: string; message: string }
  | { type: 'invalid'; issues: { message: string; location?: string }[] }
  /** Created without being started (`createOnly`), with its components' paths */
  | { type: 'created'; components: string[] }
  /** Its plan's classes loaded alone (`loadOnly`): their URIs */
  | { type: 'loaded'; classes: string[] }
  | { type: 'failed'; message: string }
  | { type: 'stopped' };
