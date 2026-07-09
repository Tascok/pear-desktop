import {
  enhanceWebRequest,
  type BetterSession,
} from '@jellybrick/electron-better-web-request';
import { contextBridge, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import { blockers } from './types';

export interface TrackerBlockerConfig {
  /**
   * Whether to enable the tracker blocker.
   * @default true
   */
  enabled: boolean;
  /**
   * When enabled, the tracker blocker will cache the blocklists.
   * @default true
   */
  cache: boolean;
  /**
   * Which tracker blocker to use.
   * @default blockers.InPlayer
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   * @default []
   */
  additionalBlockLists: string[];
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.InPlayer,
    additionalBlockLists: [],
    disableDefaultLists: false,
  } as TrackerBlockerConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.do-not-track.menu.blocker'),
        submenu: Object.values(blockers).map((blocker) => ({
          label: blocker,
          type: 'radio',
          checked: (config.blocker || blockers.WithBlocklists) === blocker,
          click() {
            setConfig({ blocker });
          },
        })),
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      if (config.blocker === blockers.WithBlocklists) {
        await loadTrackerBlockerEngine(
          window.webContents.session,
          config.cache,
          config.additionalBlockLists,
          config.disableDefaultLists,
        );
      }

      // Enable multiple webRequest listeners support
      const session = window.webContents.session as BetterSession;
      enhanceWebRequest(session);

      // Set up resolver for onBeforeRequest so ALL matching listeners are applied
      // and the request is cancelled if ANY listener cancels it
      session.webRequest.setResolver('onBeforeRequest', (listeners) => {
        return Promise.all(
          listeners.map((l) => Promise.resolve(l.apply())),
        ).then((results) => {
          // Merge: if any listener cancels, cancel; keep redirectURL if set
          const merged: Electron.CallbackResponse = { cancel: false };
          for (const result of results) {
            if (result?.cancel) merged.cancel = true;
            if (result?.redirectURL) {
              merged.redirectURL = result.redirectURL;
            }
          }
          return merged;
        });
      });

      // Block ad/tracker domains at the network level
      // This catches requests that the JSON pruner might miss
      const adDomains = [
        '*://*.doubleclick.net/*',
        '*://*.googlesyndication.com/*',
        '*://*.googleadservices.com/*',
        '*://*.googletagservices.com/*',
        '*://*.googletagmanager.com/*',
        '*://*.google-analytics.com/*',
        '*://*.pagead2.googlesyndication.com/*',
        '*://*.adservice.google.com/*',
        '*://*.s0.2mdn.net/*',
        '*://*.an-youtube-music-ads.googleusercontent.com/*',
      ];

      session.webRequest.onBeforeRequest(
        { urls: adDomains },
        (_details, callback) => {
          callback({ cancel: true });
        },
      );
    },
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        if (
          newConfig.blocker === blockers.WithBlocklists &&
          !isBlockerEnabled(this.mainWindow.webContents.session)
        ) {
          await loadTrackerBlockerEngine(
            this.mainWindow.webContents.session,
            newConfig.cache,
            newConfig.additionalBlockLists,
            newConfig.disableDefaultLists,
          );
        }
      }
    },
  },
  preload: {
    // see #1478
    script: `const _prunerFn = window._pruner;
    window._pruner = undefined;
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return _prunerFn(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => _prunerFn(o));
      },
    }); 0`,
    async start({ getConfig }) {
      const config = await getConfig();

      if (config.blocker === blockers.InPlayer && !isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      } else if (config.blocker === blockers.WithBlocklists) {
        await injectCliqzPreload();
      }
    },
    async onConfigChange(newConfig) {
      if (newConfig.blocker === blockers.InPlayer && !isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }
    },
  },
});
