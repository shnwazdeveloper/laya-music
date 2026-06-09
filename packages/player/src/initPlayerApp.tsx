import React from 'react';

import App from './App';
import { initLogStream } from './hooks/useLogStream';
import { startAdvancedThemeWatcher } from './services/advancedThemeDirService';
import { applyAdvancedThemeFromSettingsIfAny } from './services/advancedThemeService';
import { initBridgeHandler } from './services/bridge/bridgeHandler';
import { registerBuiltInCoreSettings } from './services/coreSettings';
import { initDiscordHandler } from './services/discordHandler';
import { initDiscoveryService } from './services/discoveryService';
import { initHttpApiHandler } from './services/httpApi';
import {
  applyLanguageFromSettings,
  initLanguageWatcher,
} from './services/languageService';
import { Logger } from './services/logger';
import { loadMarketplaceThemes } from './services/marketplaceThemeDirService';
import { initMcpHandler } from './services/mcp';
import { initMpdHandler } from './services/mpd';
import { providersStoreReady } from './services/providersHost';
import { ytdlpEnsureInstalled } from './services/tauri/commands';
import { bootstrapBuiltInProviders } from './services/youtubeMusicProvider';
import { initializeFavoritesStore } from './stores/favoritesStore';
import { initializePlaylistStore } from './stores/playlistStore';
import { initializeQueueStore } from './stores/queueStore';
import { initializeSettingsStore } from './stores/settingsStore';
import { initializeShortcutsStore } from './stores/shortcutsStore';
import { hydrateThemeStore } from './stores/themeStore';
import { useUpdaterStore } from './stores/updaterStore';

export const initPlayerApp = async (
  root: ReturnType<typeof import('react-dom/client').createRoot>,
) => {
  initLogStream();

  await initializeSettingsStore()
    .then(() => initializeShortcutsStore())
    .then(() => initializeQueueStore())
    .then(() => initializeFavoritesStore())
    .then(() => initializePlaylistStore())
    .then(() => providersStoreReady)
    .then(() => registerBuiltInCoreSettings())
    .then(() => initDiscoveryService())
    .then(() => initMcpHandler())
    .then(() => initMpdHandler())
    .then(() => initHttpApiHandler())
    .then(() => initBridgeHandler())
    .then(() => initDiscordHandler())
    .then(() => applyLanguageFromSettings())
    .then(() => initLanguageWatcher())
    .then(() => startAdvancedThemeWatcher())
    .then(() => loadMarketplaceThemes())
    .then(() => hydrateThemeStore())
    .then(() => applyAdvancedThemeFromSettingsIfAny())
    .then(() =>
      ytdlpEnsureInstalled().catch((error) => {
        Logger.streaming.error(
          `yt-dlp setup failed before provider bootstrap: ${String(error)}`,
        );
        return false;
      }),
    )
    .then(() => bootstrapBuiltInProviders())
    .then(() => {
      void useUpdaterStore.getState().checkForUpdate();
    });

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};
