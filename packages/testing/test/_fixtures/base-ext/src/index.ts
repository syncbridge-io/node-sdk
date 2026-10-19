import { Component, ComponentBase } from '@syncbridge/common';

/** What an extension the package under test depends on brings */
@Component({ className: 'Clock' })
export class ClockComponent extends ComponentBase {
  now(): number {
    return Date.now();
  }
}
