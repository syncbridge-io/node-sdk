import type { ILogger } from '../interfaces/index.js';

export class ConsoleLogger implements ILogger {
  level = 'info';

  critical(...args: any[]): ILogger {
    console.warn(...args);
    return this;
  }

  debug(...args: any[]): ILogger {
    console.debug(...args);
    return this;
  }

  error(...args: any[]): ILogger {
    console.error(...args);
    return this;
  }

  fatal(...args: any[]): ILogger {
    console.error(...args);
    return this;
  }

  info(...args: any[]): ILogger {
    console.info(...args);
    return this;
  }

  trace(...args: any[]): ILogger {
    console.info(...args);
    return this;
  }

  warn(...args: any[]): ILogger {
    console.warn(...args);
    return this;
  }

  child(): ILogger {
    return this;
  }

  close(): void | Promise<void> {
    return undefined;
  }
}
