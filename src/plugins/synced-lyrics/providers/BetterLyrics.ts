import { TTML } from '../parsers/ttml';
import { netFetch } from '../renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const BETTER_LYRICS_API = 'https://lyrics-api.boidu.dev/getLyrics';

export class BetterLyrics implements LyricProvider {
  name = 'BetterLyrics';
  baseUrl = BETTER_LYRICS_API;

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const params = new URLSearchParams({
      s: info.alternativeTitle || info.title,
      a: info.artist,
    });

    if (info.songDuration) {
      params.set('d', info.songDuration.toString());
    }

    if (info.album) {
      params.set('al', info.album);
    }

    const url = `${this.baseUrl}?${params.toString()}`;

    const [, body] = await netFetch(url);

    let data: { ttml?: string; score?: number };
    try {
      data = JSON.parse(body) as { ttml?: string; score?: number };
    } catch {
      return null;
    }

    if (!data.ttml) {
      return null;
    }

    let ttmlLines;
    try {
      const parsed = TTML.parse(data.ttml);
      ttmlLines = parsed.lines;
    } catch (err) {
      console.error('[BetterLyrics] Failed to parse TTML:', err);
      return null;
    }

    if (!ttmlLines.length) {
      return null;
    }

    return {
      title: info.title,
      artists: [info.artist],
      lines: ttmlLines.map((line) => ({
        time: line.time,
        timeInMs: line.timeInMs,
        duration: line.duration,
        text: line.text,
        status: 'upcoming' as const,
        words: line.words,
        voice: line.voice,
      })),
    };
  }
}
