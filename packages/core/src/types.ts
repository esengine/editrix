/**
 * Lifecycle scope of a registered service instance.
 */
export const enum ServiceScope {
  /** One instance per kernel (default). */
  Singleton = 'singleton',
  /** New instance per resolution. */
  Transient = 'transient',
}

/**
 * State machine states for a plugin's lifecycle.
 */
export const enum PluginState {
  /** Plugin descriptor known but not loaded. */
  Unloaded = 'unloaded',
  /** Dependencies checked and satisfied; ready to activate. */
  Resolved = 'resolved',
  /** `activate()` called, async initialization in progress. */
  Activating = 'activating',
  /** Plugin is running and its services are available. */
  Active = 'active',
  /** `deactivate()` called, cleanup in progress. */
  Deactivating = 'deactivating',
}
