import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';
import style from './style.css?inline';

import type { SyncedLyricsPluginConfig } from './types';

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  SyncedLyricsPluginConfig
>({
  name: () => t('plugins.synced-lyrics.name'),
  description: () => t('plugins.synced-lyrics.description'),
  authors: ['Non0reo', 'ArjixWasTaken', 'KimJammer', 'Strvm'],
  restartNeeded: true,
  addedVersion: '3.5.X',
  config: {
    enabled: false,
    preciseTiming: true,
    showLyricsEvenIfInexact: true,
    showTimeCodes: false,
    defaultTextString: '♪',
    lineEffect: 'fancy',
    romanization: true,
    providersOrder: [
      { id: 'LyricsPlus', name: 'LyricsPlus (Sílaba/Palavra)', resolution: 'SÍLABA', enabled: true },
      { id: 'MusixMatchWord', name: 'MusixMatch Word-by-Word', resolution: 'SÍLABA', enabled: true },
      { id: 'BetterLyrics', name: 'BetterLyrics (Sílaba/Palavra)', resolution: 'SÍLABA', enabled: true },
      { id: 'BetterLyricsPortato', name: 'BetterLyrics Portato (QRC)', resolution: 'SÍLABA', enabled: true },
      { id: 'BiniLyrics', name: 'BiniLyrics (Sílaba/Palavra)', resolution: 'SÍLABA', enabled: true },
      { id: 'BetterLyricsUnison', name: 'Unison (Sílaba/Palavra)', resolution: 'SÍLABA', enabled: true },
      { id: 'YTMusic', name: 'Legendas do YouTube', resolution: 'LINHA', enabled: true },
      { id: 'BetterLyricsUnisonLine', name: 'Unison (Linha)', resolution: 'LINHA', enabled: true },
      { id: 'LRCLib', name: 'LRCLib', resolution: 'LINHA', enabled: true },
      { id: 'LyricsGenius', name: 'Genius (sem sincronia)', resolution: 'LINHA', enabled: true },
    ],
  },

  menu,
  renderer,
  backend,
  stylesheets: [style],
});
