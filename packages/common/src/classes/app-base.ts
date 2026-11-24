import type { PacketCapture } from '../interfaces/packet-capture.interface.js';
import { BaseElement } from './base-element.js';

export abstract class AppBase<
  TEvents extends AppBase.Events = AppBase.Events,
> extends BaseElement<TEvents> {
  dataDirectory?: string;
  /**
   * Opens a network interface's capture, as SyncBridge gives it: none
   * where it cannot (a test, an older SyncBridge)
   */
  packetCapture?: PacketCapture;
  constructor(init: AppBase.InitArgs) {
    super(init);
    this.dataDirectory = init.dataDirectory;
  }
}

const APP_BASE_TOKEN = Symbol.for(AppBase.name);
AppBase.prototype[APP_BASE_TOKEN] = true;

/**
 * @namespace
 */
export namespace AppBase {
  export interface Events extends BaseElement.Events {}

  export interface InitArgs extends BaseElement.InitArgs {
    dataDirectory?: string;
  }
}
