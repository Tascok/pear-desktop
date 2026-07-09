import { BetterLyrics, BetterLyricsPortato, BiniLyrics, MusixMatchWord } from './BetterLyricsUnified';
import { BetterLyricsUnison } from './BetterLyricsUnison';
import { ProviderNames } from './index';
import { LRCLib } from './LRCLib';
import { LyricsGenius } from './LyricsGenius';
import { LyricsPlus } from './LyricsPlus';
import { YTMusic } from './YTMusic';

export const providers = {
  // Syllable/Word providers
  [ProviderNames.BetterLyrics]: new BetterLyrics('BetterLyrics', 'syllable'),
  [ProviderNames.BetterLyricsPortato]: new BetterLyricsPortato(),
  [ProviderNames.BiniLyrics]: new BiniLyrics('BiniLyrics', 'syllable'),
  [ProviderNames.MusixMatchWord]: new MusixMatchWord(),
  [ProviderNames.LyricsPlus]: new LyricsPlus('LyricsPlus', 'syllable'),
  [ProviderNames.BetterLyricsUnison]: new BetterLyricsUnison('BetterLyricsUnison', 'syllable'),

  // Line providers (synced LRC)
  [ProviderNames.YTMusic]: new YTMusic(),
  [ProviderNames.BetterLyricsUnisonLine]: new BetterLyricsUnison('BetterLyricsUnisonLine', 'line'),
  [ProviderNames.LRCLib]: new LRCLib(),

  // Plain/unsynced fallback
  [ProviderNames.LyricsGenius]: new LyricsGenius(),
} as const;
