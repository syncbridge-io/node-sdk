import { EnumType } from '@opra/common';

/** How a log channel's records are shown */
export enum LogChannelKind {
  /** Level and message, as the console */
  text = 'text',
  /** Direction and raw data, as device communication */
  transmit = 'transmit',
}

EnumType(LogChannelKind, {
  name: 'LogChannelKind',
  description: "How a log channel's records are shown",
});
