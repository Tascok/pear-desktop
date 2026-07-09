import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

interface LyricsPlusSyllabus {
  time: number;
  text: string;
  duration?: number;
}

interface LyricsPlusLine {
  time: number;
  duration?: number;
  text?: string;
  syllabus?: LyricsPlusSyllabus[];
  element?: {
    singer?: string;
  };
}

interface LyricsPlusResponse {
  lyrics?: LyricsPlusLine[];
}

export class LyricsPlus implements LyricProvider {
  constructor(
    public name: string = 'LyricsPlus',
    private resolution: 'syllable' | 'line' = 'syllable',
  ) {}

  baseUrl = 'https://lyricsplus.binimum.org';

  baseUrls = [
    'https://lyricsplus.binimum.org',
    'https://lyricsplus.prjktla.my.id',
  ];

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const song = info.alternativeTitle || info.title;
    if (!song || !info.artist) return null;

    const queryParams = new URLSearchParams({
      title: song,
      artist: info.artist,
    });

    if (info.album) {
      queryParams.append('album', info.album);
    }
    if (info.songDuration) {
      queryParams.append('duration', info.songDuration.toString());
    }

    // Include sources to query
    queryParams.append('source', 'apple,lyricsplus,musixmatch,spotify,musixmatch-word');

    for (const baseUrl of this.baseUrls) {
      try {
        const url = `${baseUrl}/v2/lyrics/get?${queryParams.toString()}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!response.ok) continue;

        const data = (await response.json()) as LyricsPlusResponse;
        if (!data || !data.lyrics) continue;

        const formatTime = (ms: number): string => {
          const totalSec = Math.floor(ms / 1000);
          const minutes = Math.floor(totalSec / 60);
          const seconds = totalSec % 60;
          const millis = ms % 1000;
          return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
        };

        const lines = data.lyrics.map((item) => {
          const timeInMs = item.time;
          const duration = item.duration || 0;
          const text = item.text || '';
          
          let words: { timeInMs: number; word: string; duration?: number; isBackground?: boolean }[] | undefined = undefined;
          if (this.resolution !== 'line' && Array.isArray(item.syllabus)) {
            const parsedWords = item.syllabus.map((s) => ({
              timeInMs: s.time,
              word: s.text,
              duration: s.duration,
              isBackground: item.element?.singer === 'bg' || undefined,
            }));

            let inParentheses = false;
            words = parsedWords.map((w) => {
              const currentWord = w.word;
              const hasOpenParen = currentWord.includes('(');
              const hasCloseParen = currentWord.includes(')');
              
              if (hasOpenParen) inParentheses = true;
              const isBg = inParentheses || !!w.isBackground || undefined;
              if (hasCloseParen) inParentheses = false;
              
              return { ...w, isBackground: isBg };
            });
          }

          return {
            time: formatTime(timeInMs),
            timeInMs,
            duration,
            text,
            status: 'upcoming' as const,
            words,
          };
        });

        return {
          title: song,
          artists: [info.artist],
          lines,
        };
      } catch (error) {
        console.error(`[LyricsPlus] Error fetching from ${baseUrl}:`, error);
      }
    }

    return null;
  }
}
