import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { updateBackdropColors, triggerBackdropBeat, initBackdrop, destroyBackdrop } from './backdrop';
import { disposeReactiveRoot } from './reactive-root';
import { setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { selectors, tabStates } from './utils';
import { fetchAnimatedArtwork } from './animated-artwork';

// hls.js is loaded at runtime via the injected CDN URL — the library is too
// large to bundle and Chromium on Linux needs it to play HLS .m3u8 streams.
let Hls: typeof import('hls.js').default | null = null;
async function ensureHls() {
  if (Hls) return Hls;
  try {
    Hls = (await import('hls.js')).default;
    return Hls;
  } catch {
    return null;
  }
}

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
let artworkController: AbortController | null = null;
let currentHls: import('hls.js').default | null = null;

function destroyHls() {
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
}

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

    // ─── Animated Artwork (iTunes / Apple Music API) ───
    const pearVideo = document.createElement('video');
    pearVideo.id = 'pear-animated-artwork';
    pearVideo.muted = true;
    pearVideo.playsInline = true;
    pearVideo.loop = true;
    pearVideo.style.display = 'none';
    const songImage = document.querySelector<HTMLElement>('#song-image');
    (songImage ?? document.body).appendChild(pearVideo);

    const loadVideoSource = async (src: string) => {
      const isM3u8 = src.includes('.m3u8');

      // .m3u8 (HLS) needs hls.js on Chromium; native HLS only works in Safari.
      if (isM3u8) {
        const hlsLib = await ensureHls();
        if (!hlsLib) return false;

        if (!hlsLib.isSupported()) return false;

        destroyHls();
        const hls = new hlsLib();
        currentHls = hls;
        hls.loadSource(src);
        hls.attachMedia(pearVideo);
        await new Promise<void>((resolve) => {
          hls.on(hlsLib.Events.MANIFEST_PARSED, () => resolve());
          hls.on(hlsLib.Events.ERROR, () => resolve());
        });
        return true;
      }

      // Direct video src (mp4/mov)
      destroyHls();
      if (pearVideo.src !== src) {
        pearVideo.src = src;
        pearVideo.load();
      }
      return true;
    };

    const applyAnimatedArtwork = async (info: SongInfo) => {
      // Cancel any previous pending request
      artworkController?.abort();
      artworkController = new AbortController();
      const { signal } = artworkController;

      // Sync play/pause with main player
      const mainVideo = document.querySelector<HTMLVideoElement>('video');
      const isPlaying = mainVideo ? !mainVideo.paused : false;

      try {
        const result = await fetchAnimatedArtwork(info, netFetch);
        if (signal.aborted) return;

        if (result.videoSrc) {
          // Animated artwork found — load via hls.js (m3u8) or direct src
          const loaded = await loadVideoSource(result.videoSrc);
          if (signal.aborted || !loaded) {
            if (!loaded) destroyHls();
            return;
          }
          pearVideo.style.display = '';
          if (isPlaying && pearVideo.paused) void pearVideo.play().catch(() => {});
          else if (!isPlaying && !pearVideo.paused) pearVideo.pause();

          // Update static album art to high-res iTunes version as fallback
          if (result.staticArtwork && info.imageSrc !== result.staticArtwork) {
            const img = document.querySelector('#song-image yt-img-shadow > img') as HTMLImageElement | null;
            if (img) img.src = result.staticArtwork;
          }
        } else if (result.staticArtwork && info.imageSrc !== result.staticArtwork) {
          // No animated artwork — upgrade to high-res static image
          const img = document.querySelector('#song-image yt-img-shadow > img') as HTMLImageElement | null;
          if (img) img.src = result.staticArtwork;
          destroyHls();
          pearVideo.style.display = 'none';
          pearVideo.removeAttribute('src');
        }
      } catch {
        // Fetch failed — keep current state
      }
    };

    // Listen for play/pause on the main player video
    const syncMainPlayer = () => {
      const mv = document.querySelector<HTMLVideoElement>('video');
      if (!mv || this._mainVideoListenersAdded) return;
      mv.addEventListener('play', () => {
        if (pearVideo.src || currentHls) {
          pearVideo.style.display = '';
          void pearVideo.play().catch(() => {});
        }
      });
      mv.addEventListener('pause', () => {
        if (pearVideo.src || currentHls) pearVideo.pause();
      });
      this._mainVideoListenersAdded = true;
      this._mainVideo = mv;
    };

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
      if (info && info.imageSrc) {
        updateBackdropColors(info.imageSrc);
        triggerBackdropBeat();
      }
      syncMainPlayer();
      applyAnimatedArtwork(info);
    });
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
    destroyHls();
    artworkController?.abort();
    artworkController = null;
    document.body.classList.remove('has-synced-lyrics-bg', 'webgl-active');
    disposeReactiveRoot();
  },
});
