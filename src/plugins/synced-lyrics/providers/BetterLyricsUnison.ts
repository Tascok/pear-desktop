import { LRC } from '../parsers/lrc';
import { TTML } from '../parsers/ttml';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

export class BetterLyricsUnison implements LyricProvider {
  constructor(
    public name: string = 'BetterLyricsUnison',
    private resolution: 'syllable' | 'line' = 'syllable',
  ) {}

  baseUrl = 'https://unison.boidu.dev';

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    // Try videoId first, then fall back to song+artist search
    const urls: string[] = [];
    if (info.videoId) {
      urls.push(`${this.baseUrl}/lyrics?v=${info.videoId}`);
    }
    const song = info.alternativeTitle || info.title;
    if (song && info.artist) {
      urls.push(`${this.baseUrl}/lyrics?song=${encodeURIComponent(song)}&artist=${encodeURIComponent(info.artist)}`);
    }

    if (urls.length === 0) return null;

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const data = (await response.json()) as {
          success?: boolean;
          lyrics?: string;
          format?: 'ttml' | 'lrc' | 'plain';
          syncType?: 'richsync' | 'linesync' | 'plain';
        };

        if (!data || !data.lyrics || data.success === false) continue;

        let result: LyricResult | null = null;

        if (data.format === 'ttml') {
          const parsed = TTML.parse(data.lyrics);
          result = {
            title: info.title,
            artists: [info.artist],
            lines: parsed.lines.map((line) => ({
              time: line.time,
              timeInMs: line.timeInMs,
              duration: line.duration,
              text: line.text,
              status: 'upcoming' as const,
              words: this.resolution === 'line' ? undefined : line.words,
              voice: line.voice,
            })),
          };
        } else if (data.format === 'lrc') {
          const parsed = LRC.parse(data.lyrics);
          // If we're syllable resolution but LRC has no word timestamps, skip it
          if (this.resolution !== 'line' && !parsed.lines.some((l) => l.words.length > 0)) {
            continue;
          }
          result = {
            title: info.title,
            artists: [info.artist],
            lines: parsed.lines.map((line) => ({
              ...line,
              status: 'upcoming' as const,
              words: this.resolution === 'line' ? undefined : line.words,
            })),
          };
        } else {
          // Plain text — only use if line-level or fallback
          result = {
            title: info.title,
            artists: [info.artist],
            lyrics: data.lyrics,
          };
        }

        return result;
      } catch (e) {
        console.error('[BetterLyricsUnison] Error fetching lyrics:', e);
        continue;
      }
    }

    return null;
  }
}
