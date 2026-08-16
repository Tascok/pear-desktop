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
    layoutObserverCallback: MutationCallback;
    refreshWebglActive: () => void;
    observer?: MutationObserver;
    layoutObserver?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
    lyricsTabSelected: boolean;
    playerPageOpen: boolean;
    _mainVideo?: HTMLVideoElement;
    _mainVideoListenersAdded: boolean;
  },
  SyncedLyricsPluginConfig
>({
  lyricsTabSelected: false,
  playerPageOpen: false,
  _mainVideoListenersAdded: false,

  onConfigChange(newConfig) {
    setConfig(newConfig);
  },

  /**
   * Toggle `webgl-active` on <body> only when BOTH conditions are met:
   *   1. The lyrics tab is the selected tab (aria-selected=true)
   *   2. The player page is open (ytmusic-app-layout has player-page-open)
   * If the user leaves the player page (e.g. goes to Home/Search), transparency
   * is removed even if the lyrics tab is still internally “selected”.
   */
  refreshWebglActive() {
    const shouldShow = this.lyricsTabSelected && this.playerPageOpen;
    document.body.classList.toggle('webgl-active', shouldShow);
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          this.lyricsTabSelected = header.ariaSelected === 'true';
          this.refreshWebglActive();
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  layoutObserverCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'player-page-open') {
        this.playerPageOpen = (mutation.target as HTMLElement).hasAttribute('player-page-open');
        this.refreshWebglActive();
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    // Cancel any previous RAF tick to prevent multiple loops running
    if (this.updateTimestampInterval) {
      cancelAnimationFrame(this.updateTimestampInterval as number);
      this.updateTimestampInterval = undefined;
    }

    const tick = () => {
      const video = document.querySelector('video');
      if (video) {
        setCurrentTime(video.currentTime * 1000);
      } else {
        console.warn('[Lyrics] RAF tick: no <video> element found (skipping tick)');
      }
      this.updateTimestampInterval = requestAnimationFrame(tick);
    };
    this.updateTimestampInterval = requestAnimationFrame(tick);

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      this.lyricsTabSelected = header.ariaSelected === 'true';

      // Also observe #layout for player-page-open changes
      const layout = document.querySelector<HTMLElement>('#layout');
      if (layout) {
        this.playerPageOpen = layout.hasAttribute('player-page-open');
        this.layoutObserver ??= new MutationObserver(this.layoutObserverCallback);
        this.layoutObserver.disconnect();
        this.layoutObserver.observe(layout, { attributes: true, attributeFilter: ['player-page-open'] });
      }

      this.refreshWebglActive();
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
    // 'has-synced-lyrics-bg' keeps the canvas alive globally;
    // 'webgl-active' is toggled dynamically by tabStates so transparency
    // only applies on the lyrics tab page, not on other screens.
    document.body.classList.add('has-synced-lyrics-bg');

    // ─── Animated Artwork (bls-video) ───
    // Mirror YouTube Music's #bls-video into our own <video> overlay,
    // synced to the main player's play/pause state (same approach as
    // the Better Lyrics extension).
    const pearVideo = document.createElement('video');
    pearVideo.id = 'pear-animated-artwork';
    pearVideo.muted = true;
    pearVideo.playsInline = true;
    pearVideo.loop = true;
    pearVideo.style.display = 'none';
    document.body.appendChild(pearVideo);

    const syncAnimatedArtwork = () => {
      const blsVideo = document.querySelector<HTMLVideoElement>('video#bls-video');
      if (!blsVideo) return;
      const src = blsVideo.currentSrc || blsVideo.querySelector('source')?.src || '';
      if (!src) return;
      if (pearVideo.src !== src) {
        pearVideo.src = src;
        pearVideo.load();
      }
      const mainVideo = document.querySelector<HTMLVideoElement>('video');
      const isPlaying = mainVideo ? !mainVideo.paused : false;
      if (isPlaying && pearVideo.paused) void pearVideo.play().catch(() => {});
      else if (!isPlaying && !pearVideo.paused) pearVideo.pause();
    };

    let blsObserver: MutationObserver | null = null;
    const setupBlsObserver = () => {
      if (blsObserver) return;
      blsObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes.length) {
            for (const node of m.addedNodes) {
              if (node instanceof Element && node.matches('video#bls-video')) {
                syncAnimatedArtwork();
                return;
              }
              if (node instanceof HTMLElement) {
                const v = node.querySelector('video#bls-video');
                if (v) { syncAnimatedArtwork(); return; }
              }
            }
          }
        }
      });
      blsObserver.observe(document.body, { childList: true, subtree: true });
    };

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
      if (info && info.imageSrc) {
        updateBackdropColors(info.imageSrc);
        triggerBackdropBeat();
      }
      setupBlsObserver();
      syncWithMainPlayer();
      syncAnimatedArtwork();
    });

    // Sync animated artwork play/pause with the main player video
    const syncWithMainPlayer = () => {
      const mv = document.querySelector<HTMLVideoElement>('video');
      if (!mv || this._mainVideoListenersAdded) return;
      mv.addEventListener('play', syncAnimatedArtwork);
      mv.addEventListener('pause', syncAnimatedArtwork);
      this._mainVideoListenersAdded = true;
      this._mainVideo = mv;
    };
  },

  stop() {
    if (this.updateTimestampInterval) {
      cancelAnimationFrame(this.updateTimestampInterval as number);
      this.updateTimestampInterval = undefined;
    }
    this.observer?.disconnect();
    this.layoutObserver?.disconnect();
    destroyBackdrop();
    const canvas = document.querySelector('#synced-lyrics-global-backdrop');
    if (canvas) {
      canvas.remove();
    }
    const pearVideo = document.getElementById('pear-animated-artwork');
    if (pearVideo) pearVideo.remove();
    document.body.classList.remove('has-synced-lyrics-bg', 'webgl-active');
    disposeReactiveRoot();
  },
});
