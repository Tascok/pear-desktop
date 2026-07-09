import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { updateBackdropColors, triggerBackdropBeat, initBackdrop, destroyBackdrop } from './backdrop';
import { disposeReactiveRoot } from './reactive-root';
import { setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { selectors, tabStates } from './utils';

import type { SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export let _ytAPI: MusicPlayer | null = null;
export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;
export let saveConfig: (config: Partial<SyncedLyricsPluginConfig>) => void = () => {};

export const renderer = createRenderer<
  {
    observerCallback: MutationCallback;
    observer?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig) {
    setConfig(newConfig);
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    if (!this.updateTimestampInterval) {
      const tick = () => {
        const video = document.querySelector('video');
        if (video) {
          setCurrentTime(video.currentTime * 1000);
        }
        this.updateTimestampInterval = requestAnimationFrame(tick);
      };
      this.updateTimestampInterval = requestAnimationFrame(tick);
    }

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch');
    saveConfig = (newConfig) => ctx.setConfig(newConfig);

    setConfig(await ctx.getConfig());

    let canvas = document.querySelector<HTMLCanvasElement>('#synced-lyrics-global-backdrop');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'synced-lyrics-global-backdrop';
      canvas.className = 'synced-lyrics-bg-canvas';
      document.body.appendChild(canvas);
    }
    initBackdrop(canvas);
    document.body.classList.add('has-synced-lyrics-bg', 'webgl-active');

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
      if (info && info.imageSrc) {
        updateBackdropColors(info.imageSrc);
        triggerBackdropBeat();
      }
    });
  },

  stop() {
    destroyBackdrop();
    const canvas = document.querySelector('#synced-lyrics-global-backdrop');
    if (canvas) {
      canvas.remove();
    }
    document.body.classList.remove('has-synced-lyrics-bg', 'webgl-active');
    disposeReactiveRoot();
  },
});
