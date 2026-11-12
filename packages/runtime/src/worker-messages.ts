import type { Profile } from '@syncbridge/common';

/** What a worker started with `startWorker` reports to its host */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'log'; level: string; source?: string; message: string }
  | { type: 'status'; status: string; message: string }
  | { type: 'component-status'; path: string; status: string; message: string }
  /** An element's glance and activity as last set; its path "" for the app */
  | {
      type: 'lines';
      path: string;
      glance?: { text: string; tone?: string };
      activity?: { text: string; tone?: string };
    }
  | { type: 'invalid'; issues: { message: string; location?: string }[] }
  /** Created without being started (`createOnly`), with its components' paths */
  | { type: 'created'; components: string[] }
  /** Its classes' own migrateProfile run (`migrate`): the profile they left */
  | { type: 'migrated'; profile: Profile }
  /** Its plan's classes loaded alone (`loadOnly`): their URIs */
  | { type: 'loaded'; classes: string[] }
  | { type: 'failed'; message: string }
  | { type: 'stopped' }
  /** The last message: everything sent before it was delivered */
  | { type: 'ended' };
