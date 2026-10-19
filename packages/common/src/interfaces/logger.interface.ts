export interface ILogger {
  fatal: LeveledLogMethod;
  critical: LeveledLogMethod;
  error: LeveledLogMethod;
  warn: LeveledLogMethod;
  info: LeveledLogMethod;
  trace: LeveledLogMethod;
  debug: LeveledLogMethod;
  level: string;

  child(options: Object): ILogger;
  close(): void | Promise<void>;
}

export interface LeveledLogMethod {
  (message: string, ...meta: any[]): ILogger;

  (message: any): ILogger;

  (infoObject: object): ILogger;
}
