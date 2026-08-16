import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { updateBackdropColors, triggerBackdropBeat, initBackdrop, destroyBackdrop } from './backdrop';
import { disposeReactiveRoot } from './reactive-root';
import { setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { selectors, tabStates } from './utils';
import { fetchAnimatedArtwork } from './animated-artwork';

// hls.js is loaded at runtime via CDN injection — the renderer is a single IIFE
// that cannot dynamically import npm packages at runtime.
// Global reference set by loadHlsScript().
declare global {
  interface Window {
    Hls?: {
      default: typeof import('hls.js').default;
      isSupported: () => boolean;
    };
  }
}

let Hls: typeof import('hls.js').default | null = null;

async function loadHlsScript(): Promise<void> {
  if (window.Hls) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.0/dist/hls.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load hls.js from CDN'));
    document.head.appendChild(s);
  });
}

async function ensureHls() {
  if (Hls) return Hls;
  try {
    await loadHlsScript();
    if (!window.Hls) {
      console.warn('[pear-animated-artwork] hls.js script loaded but window.Hls undefined');
      return null;
    }
    Hls = window.Hls.default;
    console.log('[pear-animated-artwork] hls.js loaded from CDN, isSupported:', Hls.isSupported());
    return Hls;
  } catch (e) {
    console.warn('[pear-animated-artwork] hls.js CDN failed — cannot play .m3u8', e);
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
    _videoTimeUpdateHandler?: () => void;
    _ytVideoTimeFallback?: () => void;
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
    console.log('[Lyrics] videoDataChange called');
    // Cancel any previous RAF tick to prevent multiple loops running
    if (this.updateTimestampInterval) {
      cancelAnimationFrame(this.updateTimestampInterval as number);
      this.updateTimestampInterval = undefined;
    }
    // Detach any previous video listener
    if (this._mainVideo && this._videoTimeUpdateHandler) {
      this._mainVideo.removeEventListener('timeupdate', this._videoTimeUpdateHandler);
      this._mainVideo.removeEventListener('seeked', this._videoTimeUpdateHandler);
      this._videoTimeUpdateHandler = undefined;
    }
    if (this._ytVideoTimeFallback && typeof window !== 'undefined') {
      window.removeEventListener('yt-video-data-change', this._ytVideoTimeFallback);
      this._ytVideoTimeFallback = undefined;
    }

    const updateTime = () => {
      // Exclude #pear-animated-artwork to get the main YouTube player video
      const video = document.querySelector('video:not(#pear-animated-artwork)') as HTMLVideoElement | null;
      const videoTime = video?.currentTime ?? NaN;
      const ytTime = typeof _ytAPI?.getCurrentTime === 'function' ? _ytAPI.getCurrentTime() : undefined;
      if (video && Number.isFinite(videoTime)) {
        setCurrentTime(videoTime * 1000);
      } else {
        // Fallback to ytAPI if available
        try {
          const t = ytTime;
          if (typeof t === 'number' && Number.isFinite(t)) {
            setCurrentTime(t * 1000);
          }
        } catch {
          /* ignore */
        }
      }
      console.log('[Lyrics] updateTime probe', { hasVideo: !!video, videoTime, ytTime });
    };

    const tick = () => {
      updateTime();
      this.updateTimestampInterval = requestAnimationFrame(tick);
    };
    this.updateTimestampInterval = requestAnimationFrame(tick);
    console.log('[Lyrics] RAF tick started');

    // Listen for HTML5 timeupdate events on the <video> element as a
    // fallback/second source — covers seek and frame-level changes even
    // when RAF is throttled (background tabs, low-power mode, etc.).
    const tryAttachVideoListeners = () => {
      // Exclude #pear-animated-artwork to get the main YouTube player video
      const video = document.querySelector('video:not(#pear-animated-artwork)') as HTMLVideoElement | null;
      if (!video) return false;
      this._mainVideo = video;
      this._videoTimeUpdateHandler = updateTime;
      video.addEventListener('timeupdate', updateTime);
      video.addEventListener('seeked', updateTime);
      console.log('[Lyrics] Attached HTML5 video time listeners');
      return true;
    };
    if (!tryAttachVideoListeners()) {
      // Retry every 500ms for up to ~10s, then give up gracefully
      let attempts = 0;
      const tryLater = () => {
        if (tryAttachVideoListeners() || ++attempts > 20) return;
        setTimeout(tryLater, 500);
      };
      setTimeout(tryLater, 500);
    }

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

      if (isM3u8) {
        const hlsLib = await ensureHls();
        if (!hlsLib) {
          console.warn('[pear-animated-artwork] hls.js failed to load — cannot play .m3u8');
          return false;
        }
        if (!hlsLib.isSupported()) {
          console.warn('[pear-animated-artwork] HLS not supported in this environment');
          return false;
        }

        destroyHls();
        const hls = new hlsLib({
          // Never cap quality to player pixel size — keeps highest available level
          capLevelToPlayerSize: false,
          // Never downgrade on FPS drops — quality should only follow real bandwidth
          fpsController: undefined as unknown as typeof import('hls.js').FPSController | undefined,
          // Aggressive initial bandwidth estimate (5 Mbps) — starts at high quality
          abrEwmaDefaultEstimate: 5_000_000,
          abrEwmaDefaultEstimateMax: 20_000_000,
          abrBandWidthFactor: 0.9,    // slightly aggressive when estimating
          abrBandWidthUpFactor: 1.1,  // recover faster when bandwidth improves
          abrMaxWithRealBitrate: true,
          // Generous buffer — prevents rebuffer-triggered quality drops
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          highBufferWatchdogPeriod: 2,
          // Disable FPS-based level capping entirely
          ignoreDevicePixelRatio: true,
          maxDevicePixelRatio: 4,
        });
        currentHls = hls;
        hls.loadSource(src);
        hls.attachMedia(pearVideo);
        console.log('[pear-animated-artwork] loading HLS stream:', src, 'with quality config');
        await new Promise<void>((resolve) => {
          hls.on(hlsLib.Events.MANIFEST_PARSED, () => {
            console.log('[pear-animated-artwork] HLS manifest parsed — stream ready');
            pearVideo.classList.add('pear-animated-artwork--active');
            resolve();
          });
          hls.on(hlsLib.Events.ERROR, (_event, data) => {
            console.error('[pear-animated-artwork] HLS error:', data);
            resolve();
          });
        });
        return true;
      }

      // Direct video src (mp4/mov)
      destroyHls();
      if (pearVideo.src !== src) {
        pearVideo.src = src;
        pearVideo.load();
      }
      pearVideo.classList.add('pear-animated-artwork--active');
      console.log('[pear-animated-artwork] loading direct video:', src);
      return true;
    };

    const applyAnimatedArtwork = async (info: SongInfo) => {
      // Cancel any previous pending request
      artworkController?.abort();
      artworkController = new AbortController();
      const { signal } = artworkController;

      // Sync play/pause with main player
      const mainVideo = document.querySelector<HTMLVideoElement>('video:not(#pear-animated-artwork)');
      const isPlaying = mainVideo ? !mainVideo.paused : false;

      try {
        const result = await fetchAnimatedArtwork(info, netFetch);
        if (signal.aborted) return;

        console.log('[pear-animated-artwork] result for', info.title, '->', {
          videoSrc: result.videoSrc ? result.videoSrc.slice(0, 80) + '…' : undefined,
          staticArtwork: result.staticArtwork?.slice(0, 80) + '…',
        });

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

          // High-res iTunes static art sits underneath the animated overlay
          if (result.staticArtwork && info.imageSrc !== result.staticArtwork) {
            const img = document.querySelector('#song-image yt-img-shadow > img') as HTMLImageElement | null;
            if (img) img.src = result.staticArtwork;
          }
        } else {
          // No Motion Art — hide the overlay and use the upgraded static art
          if (result.staticArtwork && info.imageSrc !== result.staticArtwork) {
            const img = document.querySelector('#song-image yt-img-shadow > img') as HTMLImageElement | null;
            if (img) img.src = result.staticArtwork;
            console.log('[pear-animated-artwork] upgraded static art (no Motion Art)');
          }
          destroyHls();
          pearVideo.classList.remove('pear-animated-artwork--active');
          pearVideo.style.display = 'none';
          pearVideo.removeAttribute('src');
        }
      } catch {
        // Fetch failed — keep current state
      }
    };

    // Listen for play/pause on the main player video
    const syncMainPlayer = () => {
      const mv = document.querySelector<HTMLVideoElement>('video:not(#pear-animated-artwork)');
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
    if (this._mainVideo && this._videoTimeUpdateHandler) {
      this._mainVideo.removeEventListener('timeupdate', this._videoTimeUpdateHandler);
      this._mainVideo.removeEventListener('seeked', this._videoTimeUpdateHandler);
      this._videoTimeUpdateHandler = undefined;
    }
    if (this._ytVideoTimeFallback && typeof window !== 'undefined') {
      window.removeEventListener('yt-video-data-change', this._ytVideoTimeFallback);
      this._ytVideoTimeFallback = undefined;
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
