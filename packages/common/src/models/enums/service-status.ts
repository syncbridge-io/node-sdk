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
}

EnumType(ServiceStatus, {
  name: 'ServiceStatus',
  description: 'Status of any service',
});
