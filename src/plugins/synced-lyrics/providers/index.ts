import * as z from 'zod';

import type { LyricResult } from '../types';

export enum ProviderNames {
  // Syllable/Word providers (TTML-based, word-level when available)
  BetterLyrics = 'BetterLyrics',
  BetterLyricsPortato = 'BetterLyricsPortato',
  BiniLyrics = 'BiniLyrics',
  MusixMatchWord = 'MusixMatchWord',
  LyricsPlus = 'LyricsPlus',
  BetterLyricsUnison = 'BetterLyricsUnison',

  // Line providers (synced LRC)
  YTMusic = 'YTMusic',
  BetterLyricsUnisonLine = 'BetterLyricsUnisonLine',
  LRCLib = 'LRCLib',

  // Plain/unsynced fallback
  LyricsGenius = 'LyricsGenius',
}

export const ProviderNameSchema = z.nativeEnum(ProviderNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export const providerNames = Object.values(ProviderNames);

export type ProviderState = {
  state: 'fetching' | 'done' | 'error';
  data: LyricResult | null;
  error: Error | null;
};
