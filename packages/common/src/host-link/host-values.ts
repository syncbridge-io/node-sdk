/*
 * The values a host's workers name in their profiles (`${{ vars.NAME }}`,
 * value-refs): kept by Console for a workspace and for each of its hosts,
 * a host's own definition of a name over the workspace's. The host asks
 * for them when its link connects and when Console tells it they changed
 * (HOST_VALUES_CHANGED_PATH); and tells which names its workers use, which
 * of them it lacks, whenever that changes. Asked by the host, with a token
 * it signs (HOST_TOKEN_HEADER).
 */

/** Where, under Console's API, a host asks for its values */
export const HOST_VALUES_PATH = 'host/values';

/**
 * Where, under the host's API, Console tells it that its values changed:
 * POST, no body; the host then asks for them
 */
export const HOST_VALUES_CHANGED_PATH = 'settings/values/changed';

/** The names a host's workers use, qualified ("vars.HBYS_URL") */
export interface HostValuesUses {
  /** Every name its workers' profiles make, each once */
  variables: string[];
  /** Those of them neither the host nor its workspace defines */
  missing: string[];
}

export interface HostValuesRequest {
  /** The revision of the values it has: none, it has none */
  revision?: number;
  /** What its workers use: kept by Console, replaced whole each time */
  uses?: HostValuesUses;
}

/** A workspace's variables and a host's own, by name */
export interface HostVariables {
  workspace: Record<string, string>;
  host: Record<string, string>;
}

export interface HostValuesResponse {
  /**
   * The workspace's revision: one counter, raised by any change of its
   * values or of any of its hosts' values
   */
  revision: number;
  /** Whether the values changed since the revision the host told */
  changed: boolean;
  /** Changed: both trees, whole */
  variables?: HostVariables;
}

/** A variable as a host takes it: its own definition, else the workspace's */
export function hostVariable(
  variables: HostVariables | undefined,
  name: string,
): string | undefined {
  if (!variables) return;
  if (Object.prototype.hasOwnProperty.call(variables.host, name))
    return variables.host[name];
  if (Object.prototype.hasOwnProperty.call(variables.workspace, name))
    return variables.workspace[name];
}
