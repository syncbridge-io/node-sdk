import { isPlainObject } from '@jsopen/objects';
import type { ErrorIssue } from '@opra/common';

export class SbError extends Error implements ErrorIssue {
  declare readonly cause?: Error;
  severity: ErrorIssue['severity'] = 'error';
  code?: string;
  [index: string]: any;

  constructor(message?: string | Error, options?: SbErrorOptions) {
    super(typeof message === 'object' ? message.message || '' : message);
    if (message && typeof message === 'object') {
      if (message instanceof Error) {
        this.stack = message.stack;
        Object.defineProperty(this, 'cause', {
          value: message,
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
      for (const k of Object.keys(message)) {
        if (message[k] !== undefined) {
          Object.defineProperty(this, k, {
            value: message[k],
            writable: true,
            configurable: true,
            enumerable:
              !message[k] ||
              typeof message[k] !== 'object' ||
              isPlainObject(message[k]),
          });
        }
      }
    }
    if (options) {
      for (const k of Object.keys(options)) {
        if (options[k] !== undefined) {
          Object.defineProperty(this, k, {
            value: options[k],
            writable: true,
            configurable: true,
            enumerable:
              !options[k] ||
              typeof options[k] !== 'object' ||
              isPlainObject(options[k]),
          });
        }
      }
    }
  }

  toJSON(): any {
    const out: any = {
      message: this.message,
    };
    for (const k of Object.keys(this)) {
      out[k] = this[k];
    }
    return out;
  }
}

export interface SbErrorOptions extends Partial<ErrorIssue> {
  cause?: Error;
}

/**
 *
 */
export class SbValidationError extends SbError {}
