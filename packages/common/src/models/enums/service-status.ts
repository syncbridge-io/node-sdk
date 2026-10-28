import { EnumType } from '@opra/common';

export enum ServiceStatus {
  stopped = 'stopped',
  starting = 'starting',
  started = 'started',
  unhealthy = 'unhealthy',
  stopping = 'stopping',
  invalid = 'invalid',
  /** Its packages are not installed for its configuration; init installs them */
  needsInit = 'needs-init',
  /** Its packages are being installed */
  initializing = 'initializing',
  /**
   * Its configuration lacks what only its user can give - a setting or a
   * component required, with no default: it waits for it
   */
  needsConfig = 'needs-config',
}

EnumType(ServiceStatus, {
  name: 'ServiceStatus',
  description: 'Status of any service',
});
