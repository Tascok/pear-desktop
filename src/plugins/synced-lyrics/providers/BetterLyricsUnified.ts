import { LRC } from '../parsers/lrc';
import { QRC } from '../parsers/qrc';
import { TTML } from '../parsers/ttml';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

interface Waiter {
  resolve: (res: LyricResult | null) => void;
  timer: NodeJS.Timeout;
}

interface TurnstileMessage {
  type: 'turnstile-token' | 'turnstile-error' | 'turnstile-expired' | 'turnstile-timeout';
  token?: string;
  error?: string;
}

class UnifiedStreamManager {
  private activeVideoId: string | null = null;
  private cachedJwt: string | null = null;
  
  // Cache of parsed lyrics by videoId and source key
  private cache = new Map<string, Record<string, LyricResult>>();
  
  // Waiters for pending stream responses: videoId -> sourceKey -> list of waiters
  private waiters = new Map<string, Map<string, Waiter[]>>();

  private handleTurnstile(): Promise<string> {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://lyrics.api.dacubeking.com/challenge';
      iframe.style.position = 'fixed';
      iframe.style.bottom = '20px';
      iframe.style.right = '20px';
      iframe.style.width = '0px';
      iframe.style.height = '0px';
      iframe.style.border = 'none';
      iframe.style.zIndex = '999999';
      document.body.appendChild(iframe);

      const messageListener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as TurnstileMessage;
        if (!data || typeof data !== 'object') return;
        
        switch (data.type) {
          case 'turnstile-token':
            cleanup();
            if (data.token) {
              resolve(data.token);
            } else {
              reject(new Error('Turnstile token is missing in message'));
            }
            break;
          case 'turnstile-error':
            cleanup();
            reject(new Error(`Turnstile challenge error: ${data.error || 'unknown'}`));
            break;
          case 'turnstile-expired':
            iframe.contentWindow?.postMessage({ type: 'reset-turnstile' }, '*');
            break;
          case 'turnstile-timeout':
            cleanup();
            reject(new Error('Turnstile challenge timed out'));
            break;
        }
      };

      const cleanup = () => {
        window.removeEventListener('message', messageListener);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      };

      window.addEventListener('message', messageListener);
    });
  }

  private async verifyToken(turnstileToken: string): Promise<string> {
    const res = await fetch('https://lyrics.api.dacubeking.com/verify-turnstile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: turnstileToken }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Verify Turnstile failed');
    const data = (await res.json()) as { jwt: string };
    return data.jwt;
  }

  private resolveWaiter(videoId: string, sourceKey: string, result: LyricResult | null) {
    const videoWaiters = this.waiters.get(videoId);
    if (videoWaiters) {
      const sourceWaiters = videoWaiters.get(sourceKey);
      if (sourceWaiters) {
        for (const w of sourceWaiters) {
          clearTimeout(w.timer);
          w.resolve(result);
        }
        videoWaiters.delete(sourceKey);
      }
    }
  }

  private resolveAllWaiters(videoId: string) {
    const videoWaiters = this.waiters.get(videoId);
    if (videoWaiters) {
      for (const sourceWaiters of videoWaiters.values()) {
        for (const w of sourceWaiters) {
          clearTimeout(w.timer);
          w.resolve(null);
        }
      }
      this.waiters.delete(videoId);
    }
  }

  private saveResult(videoId: string, sourceKey: string, result: LyricResult) {
    let songCache = this.cache.get(videoId);
    if (!songCache) {
      songCache = {};
      this.cache.set(videoId, songCache);
    }
    songCache[sourceKey] = result;
    this.resolveWaiter(videoId, sourceKey, result);
  }

  private async startStream(info: SearchSongInfo, videoId: string): Promise<void> {
    if (!this.cachedJwt) {
      try {
        const turnstileToken = await this.handleTurnstile();
        this.cachedJwt = await this.verifyToken(turnstileToken);
      } catch (e) {
        console.error('[BetterLyricsUnified] Failed to obtain auth token:', e);
        this.resolveAllWaiters(videoId);
        return;
      }
    }

    const body = new URLSearchParams();
    body.append('videoId', videoId);
    if (info.title) body.append('song', info.title);
    if (info.artist) body.append('artist', info.artist);
    if (info.songDuration) body.append('duration', String(Math.round(info.songDuration)));
    body.append('alwaysFetchMetadata', 'true');
    body.append('token', this.cachedJwt);

    try {
      const response = await fetch('https://lyrics.api.dacubeking.com/v2/lyrics', {
        method: 'POST',
        body,
      });

      if (response.status === 403) {
        this.cachedJwt = null;
        console.warn('[BetterLyricsUnified] Token expired or invalid, retrying once...');
        return this.startStream(info, videoId);
      }

      if (!response.ok) {
        console.error('[BetterLyricsUnified] Stream request failed:', response.status);
        this.resolveAllWaiters(videoId);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[BetterLyricsUnified] Reader not available');
        this.resolveAllWaiters(videoId);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split(/\n\n|\r\n\r\n/);
          buffer = messages.pop() || '';
          for (const message of messages) {
            this.processMessage(message, videoId, info);
          }
        }
        if (done) {
          if (buffer.trim()) {
            this.processMessage(buffer, videoId, info);
          }
          break;
        }
      }
    } catch (e) {
      console.error('[BetterLyricsUnified] Stream error:', e);
    } finally {
      this.resolveAllWaiters(videoId);
    }
  }

  private processMessage(message: string, videoId: string, info: SearchSongInfo) {
    let currentEvent = '';
    let dataBuffer = '';
    const lines = message.split(/\r?\n/);

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.substring(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('data:')) {
        dataBuffer += line.substring(line.indexOf(':') + 1).trim();
      }
    }

    if (dataBuffer) {
      try {
        if (dataBuffer === '[DONE]') return;
        const data = JSON.parse(dataBuffer) as {
          provider?: string;
          results?: {
            wordByWord?: string;
            synced?: string;
            plain?: string;
            lyrics?: string;
          };
        };

        if (currentEvent === 'provider' && data.provider && data.results) {
          const provider = data.provider;
          const results = data.results;

          if (provider === 'musixmatch') {
            if (results.wordByWord) {
              const parsed = LRC.parse(results.wordByWord);
              this.saveResult(videoId, 'musixmatch-richsync', {
                title: info.title,
                artists: [info.artist],
                lines: parsed.lines.map((l) => ({ ...l, status: 'upcoming' })),
              });
            }
            if (results.synced) {
              const parsed = LRC.parse(results.synced);
              this.saveResult(videoId, 'musixmatch-synced', {
                title: info.title,
                artists: [info.artist],
                lines: parsed.lines.map((l) => ({ ...l, status: 'upcoming' })),
              });
            }
          } else if (provider === 'qq' && results.lyrics) {
            try {
              const decoded = JSON.parse(results.lyrics) as { lyrics: string };
              const parsed = QRC.parse(decoded.lyrics);
              this.saveResult(videoId, 'portato-richsynced', {
                title: info.title,
                artists: [info.artist],
                lines: parsed.lines.map((l) => ({ ...l, status: 'upcoming' })),
              });
            } catch (e) {
              console.error('[BetterLyricsUnified] Failed to parse Portato lyrics:', e);
            }
          } else if (provider === 'golyrics' && results.lyrics) {
            let ttml = results.lyrics;
            try {
              const parsedJson = JSON.parse(ttml) as { ttml?: string };
              if (parsedJson.ttml) ttml = parsedJson.ttml;
            } catch {}
            const parsed = TTML.parse(ttml);
            this.saveResult(videoId, 'bLyrics-richsynced', {
              title: info.title,
              artists: [info.artist],
              lines: parsed.lines.map((l) => ({
                ...l,
                status: 'upcoming',
                words: l.words,
              })),
            });
          } else if (provider === 'binimum' && results.lyrics) {
            const parsed = TTML.parse(results.lyrics);
            this.saveResult(videoId, 'binimum-richsynced', {
              title: info.title,
              artists: [info.artist],
              lines: parsed.lines.map((l) => ({
                ...l,
                status: 'upcoming',
                words: l.words,
              })),
            });
          } else if (provider === 'lrclib') {
            if (results.synced) {
              const parsed = LRC.parse(results.synced);
              this.saveResult(videoId, 'lrclib-synced', {
                title: info.title,
                artists: [info.artist],
                lines: parsed.lines.map((l) => ({ ...l, status: 'upcoming' })),
              });
            }
            if (results.plain) {
              this.saveResult(videoId, 'lrclib-plain', {
                title: info.title,
                artists: [info.artist],
                lyrics: results.plain,
              });
            }
          }
        }
      } catch (e) {
        console.error('[BetterLyricsUnified] JSON parse error:', e);
      }
    }
  }

  public async getLyrics(info: SearchSongInfo, targetSource: string): Promise<LyricResult | null> {
    const videoId = info.videoId;
    if (!videoId) return null;

    const songCache = this.cache.get(videoId);
    if (songCache?.[targetSource]) {
      return songCache[targetSource];
    }

    if (this.activeVideoId !== videoId) {
      if (this.activeVideoId) {
        this.resolveAllWaiters(this.activeVideoId);
      }
      this.activeVideoId = videoId;
      this.startStream(info, videoId);
    }

    return new Promise((resolve) => {
      let videoWaiters = this.waiters.get(videoId);
      if (!videoWaiters) {
        videoWaiters = new Map();
        this.waiters.set(videoId, videoWaiters);
      }

      let sourceWaiters = videoWaiters.get(targetSource);
      if (!sourceWaiters) {
        sourceWaiters = [];
        videoWaiters.set(targetSource, sourceWaiters);
      }

      const timer = setTimeout(() => {
        const currentWaiters = this.waiters.get(videoId)?.get(targetSource);
        if (currentWaiters) {
          const idx = currentWaiters.indexOf(waiterObj);
          if (idx !== -1) {
            currentWaiters.splice(idx, 1);
            resolve(null);
          }
        }
      }, 10000);

      const waiterObj: Waiter = { resolve, timer };
      sourceWaiters.push(waiterObj);
    });
  }
}

export const streamManager = new UnifiedStreamManager();

export class BetterLyrics implements LyricProvider {
  constructor(
    public name: string = 'BetterLyrics',
    private resolution: 'syllable' | 'line' = 'syllable',
  ) {}

  baseUrl = 'https://lyrics.api.dacubeking.com';

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const res = await streamManager.getLyrics(info, 'bLyrics-richsynced');
    if (!res) return null;

    return {
      ...res,
      lines: res.lines?.map((l) => ({
        ...l,
        words: this.resolution === 'line' ? undefined : l.words,
      })),
    };
  }
}

export class BetterLyricsPortato implements LyricProvider {
  name = 'BetterLyricsPortato';
  baseUrl = 'https://lyrics.api.dacubeking.com';
  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    return streamManager.getLyrics(info, 'portato-richsynced');
  }
}

export class BiniLyrics implements LyricProvider {
  constructor(
    public name: string = 'BiniLyrics',
    private resolution: 'syllable' | 'line' = 'syllable',
  ) {}

  baseUrl = 'https://lyrics.api.dacubeking.com';

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const res = await streamManager.getLyrics(info, 'binimum-richsynced');
    if (!res) return null;

    return {
      ...res,
      lines: res.lines?.map((l) => ({
        ...l,
        words: this.resolution === 'line' ? undefined : l.words,
      })),
    };
  }
}

export class MusixMatchWord implements LyricProvider {
  name = 'MusixMatchWord';
  baseUrl = 'https://lyrics.api.dacubeking.com';
  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    return streamManager.getLyrics(info, 'musixmatch-richsync');
  }
}
