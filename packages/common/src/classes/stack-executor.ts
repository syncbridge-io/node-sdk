import type { ErrorIssue } from '@opra/common';
import { ValidationError } from 'valgen';
import { SbValidationError } from './sb-error.js';

type NotPromise<T> = T extends Promise<any> ? never : T;

export class StackExecutor {
  stack: string[] = [];
  issues: StackExecutor.Issue[] = [];

  async executeAsync(stack: string, fn: () => Promise<any>): Promise<boolean> {
    this.stack.push(stack);
    try {
      await fn();
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.stack.pop();
    }
    return !this.issues.find(
      i => !(i.severity === 'warning' || i.severity === 'info'),
    );
  }

  execute<T>(stack: string, fn: () => NotPromise<T>): boolean {
    this.stack.push(stack);
    try {
      fn();
    } catch (e: any) {
      this.handleError(e);
    } finally {
      this.stack.pop();
    }
    return !this.issues.find(
      i => !(i.severity === 'warning' || i.severity === 'info'),
    );
  }

  handleError(e: any) {
    const location = this.stack.join('/');
    if (e instanceof ValidationError) {
      e.issues.forEach(x => {
        const issue = new SbValidationError(x.message, x);
        issue.severity = x.severity ?? 'error';
        issue.location = location + (x.location ? '/' + x.location : '');
        issue.stack = x.stack;
        this.issues.push(issue);
      });
    } else {
      const issue = {
        message: e.message,
        severity: e.severity || 'error',
        location,
        stack: e.stack,
        ...e,
      };
      Object.setPrototypeOf(issue, Object.getPrototypeOf(e));
      this.issues.push(issue);
    }
  }
}

export namespace StackExecutor {
  export type Issue = ErrorIssue;
}
