import { EnumType } from '@opra/common';

export enum LogLevel {
  none = 'none',
  fatal = 'fatal',
  critical = 'critical',
  error = 'error',
  warn = 'warn',
  info = 'info',
  verbose = 'verbose',
  trace = 'trace',
  debug = 'debug',
}

EnumType(LogLevel, {
  name: 'LogLevel',
  description: 'Logging levels',
});
