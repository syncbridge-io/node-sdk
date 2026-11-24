/*
 * A host's own settings, kept by Console beside its workers'
 * configurations: a machine that takes the host's place gets them back.
 * Only what an admin sets - the machine's own (paths, ports, keys, its
 * identity) stays where it is. One document a host: the host tells its
 * hash and sends it when Console asks; its secret values sealed on the
 * way, kept enciphered. Asked by the host, with a token it signs
 * (HOST_TOKEN_HEADER).
 */

/** Where, under Console's API, a host's settings are kept */
export const HOST_SETTINGS_PATH = 'host/settings';

/** Where a package a host has came from: the registry, or a file uploaded */
export type HostPackageOrigin = 'registry' | 'upload';

/**
 * A package a host has installed. One from the registry is taken again
 * by its version; one uploaded is told, never kept - its files stay on
 * the host.
 */
export interface HostSettingsPackage {
  name: string;
  version: string;
  origin: HostPackageOrigin;
}

/** A plugin approved on a host: what was approved, for which version */
export interface HostSettingsApproval {
  plugin: string;
  version: string;
  permissions: string[];
  hosts: string[];
}

/** A host's settings, as one document */
export interface HostSettingsDocument {
  /**
   * The settings an admin set, by their keys ("logs.level",
   * "plugins.<name>.<setting>"...): those set by the machine's
   * environment left out. A secret value sealed.
   */
  settings: Record<string, unknown>;
  /** The packages installed: extensions and plugins */
  packages: HostSettingsPackage[];
  /** Each package's own way of updating, by its name */
  updatePolicies: Record<string, string>;
  /** The plugins approved */
  approvals: HostSettingsApproval[];
}

/** What a host tells of its settings: the hash of its document */
export interface HostSettingsSyncRequest {
  hash: string;
}

/** What Console answers: whether it keeps them; if so, whether to send */
export interface HostSettingsSyncResponse {
  /** Its workspace keeps its hosts' configurations: off, none is sent */
  enabled: boolean;
  /** Why not, when not */
  reason?: string;
  /** Console has not this document: to be sent */
  need: boolean;
  /** The key secret values are sealed for, on the way to Console */
  sealKey?: string;
}

/** The document sent: its secret values sealed for Console */
export interface HostSettingsPutRequest {
  hash: string;
  document: HostSettingsDocument;
}

/**
 * Where, under Console's API, a host taking a record's identity takes its
 * settings back (restore requested: HostWorkersSyncResponse.restore)
 */
export const HOST_SETTINGS_RESTORE_PATH = 'host/settings/restore';

/** The settings a host takes back: none kept, none */
export interface HostSettingsRestoreResponse {
  hash?: string;
  /** Its secret values sealed for the host */
  document?: HostSettingsDocument;
}
