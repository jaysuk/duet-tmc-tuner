/**
 * Shared plugin identifiers. Leaf module so any file can import them without pulling in index.ts.
 */

/** Manifest id (plugin.json `id`) — used for dwcPluginLoaded/Unloaded events + the dwcFiles manifest. */
export const PLUGIN_MANIFEST_ID = "DuetTmcTuner";

/** camelCase key for settings persistence and i18n (`plugins.duetTmcTuner.*`). */
export const PLUGIN_ID = "duetTmcTuner";

/** Route path for the standalone DWC page. */
export const ROUTE_PATH = "/Plugins/DuetTmcTuner";

/** localStorage key for the persisted UI selections. */
export const LS_STATE = "duetTmcTuner.state";
