import {
  carryProfile,
  decodeProfileSilent,
  ExtensionRegistry,
  initializeModelsDocument,
  type Profile,
  type ProfileCarryChange,
  profileMigrations,
  runProfileMigrations,
  type StackExecutor,
} from '@syncbridge/common';

export interface MigratedProfile {
  /** The profile carried to the classes as they are */
  profile: Profile;
  /** What their declarations changed (formerly, formerlyValues...) */
  changes: ProfileCarryChange[];
  /** The classes whose own migrateProfile ran */
  migrated: string[];
  /** What is wrong with it then, as SyncBridge checks it: none when valid */
  issues: StackExecutor.Issue[];
}

/**
 * A profile written for earlier versions of the classes - its writtenWith
 * telling which, or none told - carried to them as they are registered
 * now, as SyncBridge carries it: what they declare, then their own
 * migrateProfile, in this process; then checked.
 *
 *   const r = await migrateProfileTo(oldProfile);
 *   expect(r.issues).toEqual([]);
 *   expect(r.profile.values).toEqual({ host: 'lis', port: 2575 });
 */
export async function migrateProfileTo(
  profile: Profile,
): Promise<MigratedProfile> {
  await initializeModelsDocument();
  const { profile: carried, changes } = carryProfile(profile);
  const steps = profileMigrations(carried);
  const migrated = await runProfileMigrations(carried, steps, step => {
    const ext =
      step.kind === 'app'
        ? ExtensionRegistry.findApp(step.uri, step.version)
        : ExtensionRegistry.findComponent(step.uri, step.version);
    if (!ext) throw new Error(`${step.uri} ${step.version} is not registered`);
    return ext.getClass();
  });
  const decoded = decodeProfileSilent(migrated);
  return {
    profile: migrated,
    changes,
    migrated: steps.map(s => s.uri),
    issues: decoded.result
      ? []
      : decoded.issues.filter(
          i => i.severity !== 'warning' && i.severity !== 'info',
        ),
  };
}
