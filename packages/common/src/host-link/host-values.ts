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
  /**
   * Secrets defined, sealed to a workspace key the host does not hold
   * yet - its handoff pending: waiting for it
   */
  locked?: string[];
}

export interface HostValuesRequest {
  /** The revision of the values it has: none, it has none */
  revision?: number;
  /** What its workers use: kept by Console, replaced whole each time */
  uses?: HostValuesUses;
  /** The ids of the workspace keys it holds */
  keys?: string[];
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
  /** Changed: both trees of secrets, whole, sealed */
  secrets?: HostSecrets;
  /** Changed: the workspace keys granted to this host, each sealed to its seal key */
  keys?: HostKeyGrant[];
}

/**
 * A workspace's secrets and a host's own, by name, sealed (`sbseal1.`):
 * the workspace's to a workspace key - its private half held by the
 * workspace's hosts alone - the host's own to its seal key. Console
 * never opens them.
 */
export interface HostSecrets {
  workspace: Record<string, { key: string; sealed: string }>;
  host: Record<string, string>;
}

/** A workspace key granted to a host: its private half sealed to the host's seal key */
export interface HostKeyGrant {
  id: string;
  sealed: string;
}

/**
 * Where, under the host's API, Console asks a host - its own call
 * (HOST_CONSOLE_SERVICE_HEADER), for no user - to make a workspace key
 * (POST, `{}`, answered HostKeyMade), to hand one it holds to other hosts
 * (`<path>/handoff`, HostKeyHandoffRequest, answered HostKeyHandoff), or
 * to rotate it (`<path>/rotate`, HostKeyRotateRequest, answered
 * HostKeyRotated). A host refuses unless the key is one it holds.
 */
export const HOST_VALUES_KEY_PATH = 'settings/values/key';

/** A host to seal a workspace key's private half for */
export interface HostKeyRecipient {
  id: string;
  /** Its seal key: an X25519 key's SPKI, base64 */
  sealPublicKey: string;
}

/** A workspace key made: its public half, its private half sealed to the maker's own seal key */
export interface HostKeyMade {
  publicKey: string;
  sealed: string;
}

export interface HostKeyHandoffRequest {
  keyId: string;
  hosts: HostKeyRecipient[];
}

export interface HostKeyHandoff {
  grants: { hostId: string; sealed: string }[];
}

export interface HostKeyRotateRequest {
  keyId: string;
  /** Every secret sealed to the key, each to be sealed to the new one */
  secrets: { name: string; sealed: string }[];
  hosts: HostKeyRecipient[];
}

/** All of it, or a refusal: nothing done in part */
export interface HostKeyRotated {
  publicKey: string;
  grants: { hostId: string; sealed: string }[];
  secrets: { name: string; sealed: string }[];
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
