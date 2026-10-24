/**
 * Global migration freeze for external effects.
 * Inputs remain explicit for auditable restoration, but callers cannot override
 * this policy. Change this constant only in the reviewed migration-resumption PR.
 */
export const MIGRATION_EFFECTS_ENABLED = false;

export function requestedFlag(value) {
  return value === true;
}

export function effectsAllowed(value) {
  return MIGRATION_EFFECTS_ENABLED && requestedFlag(value);
}
