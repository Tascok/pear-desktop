import { createMemo, createSignal, runWithOwner } from 'solid-js';
import { createStore } from 'solid-js/store';

import { getSongInfo } from '@/providers/song-info-front';

import { reactiveOwner } from './reactive-root';

import {
  type ProviderName,
  providerNames,
  type ProviderState,
} from '../providers';
import { providers } from '../providers/renderer';

import type { LyricProvider, SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';

export const [config, setConfig] = createSignal<SyncedLyricsPluginConfig | null>(null);

type LyricsStore = {
  provider: ProviderName;
  current: ProviderState;
  lyrics: Record<ProviderName, ProviderState>;
};

const initialData = () =>
  providerNames.reduce(
    (acc, name) => {
      acc[name] = { state: 'fetching', data: null, error: null };
      return acc;
    },
    {} as LyricsStore['lyrics'],
  );

export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  provider: providerNames[0],
  lyrics: initialData(),
  get current(): ProviderState {
    return this.lyrics[this.provider];
  },
});

export const currentLyrics = runWithOwner(reactiveOwner, () =>
  createMemo(() => {
    const provider = lyricsStore.provider;
    return lyricsStore.lyrics[provider];
  }),
)!;

export const selectBestProvider = () => {
  const cfg = config();
  const order = cfg?.providersOrder;
  if (!order || order.length === 0) {
    const bias = (p: ProviderName) =>
      (lyricsStore.lyrics[p]?.state === 'done' ? 1 : -1) +
      (lyricsStore.lyrics[p]?.data?.lines?.length ? 2 : -1) +
      (lyricsStore.lyrics[p]?.data?.lines?.some((l) => l.words && l.words.length > 0) ? 3 : -1) +
      (lyricsStore.lyrics[p]?.data?.lyrics ? 1 : -1);

    const sorted = [...providerNames].sort((a, b) => bias(b) - bias(a));
    setLyricsStore('provider', sorted[0]);
    return;
  }

  // 1. First choice: active provider in list that is done and has word-level data (lines with words array)
  for (const entry of order) {
    if (!entry.enabled) continue;
    const providerState = lyricsStore.lyrics[entry.id as ProviderName];
    if (
      providerState &&
      providerState.state === 'done' &&
      providerState.data?.lines?.length &&
      providerState.data.lines.some((l) => l.words && l.words.length > 0)
    ) {
      setLyricsStore('provider', entry.id as ProviderName);
      return;
    }
  }

  // 2. Second choice: active provider in list that is done and has lines/lyrics (line-level fallback)
  for (const entry of order) {
    if (!entry.enabled) continue;
    const providerState = lyricsStore.lyrics[entry.id as ProviderName];
    if (
      providerState &&
      providerState.state === 'done' &&
      (providerState.data?.lines?.length || providerState.data?.lyrics)
    ) {
      setLyricsStore('provider', entry.id as ProviderName);
      return;
    }
  }

  // 3. Third choice: first active provider in list that is still fetching
  for (const entry of order) {
    if (!entry.enabled) continue;
    const providerState = lyricsStore.lyrics[entry.id as ProviderName];
    if (providerState && providerState.state === 'fetching') {
      setLyricsStore('provider', entry.id as ProviderName);
      return;
    }
  }

  // 4. Fourth choice: fallback to first enabled provider
  for (const entry of order) {
    if (entry.enabled) {
      setLyricsStore('provider', entry.id as ProviderName);
      return;
    }
  }

  setLyricsStore('provider', providerNames[0]);
};

type VideoId = string;

type SearchCacheData = Record<ProviderName, ProviderState>;
interface SearchCache {
  state: 'loading' | 'done';
  data: SearchCacheData;
}

const searchCache = new Map<VideoId, SearchCache>();
export const fetchLyrics = (info: SongInfo) => {
  if (searchCache.has(info.videoId)) {
    const cache = searchCache.get(info.videoId)!;

    if (cache.state === 'loading') {
      setTimeout(() => {
        fetchLyrics(info);
      });
      return;
    }

    if (getSongInfo().videoId === info.videoId) {
      setLyricsStore('lyrics', () => {
        return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
      });
      selectBestProvider();
    }

    return;
  }

  const cache: SearchCache = {
    state: 'loading',
    data: initialData(),
  };

  searchCache.set(info.videoId, cache);
  if (getSongInfo().videoId === info.videoId) {
    setLyricsStore('lyrics', () => {
      return JSON.parse(JSON.stringify(cache.data)) as typeof cache.data;
    });
    selectBestProvider();
  }

  const tasks: Promise<void>[] = [];

  for (
    const [providerName, provider] of Object.entries(providers) as [
    ProviderName,
    LyricProvider,
  ][]
    ) {
    const pCache = cache.data[providerName];

    tasks.push(
      provider
        .search(info)
        .then((res) => {
          pCache.state = 'done';
          pCache.data = res;

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: {
                  state: 'done',
                  data: res ? { ...res } : null,
                  error: null,
                },
              };
            });
            selectBestProvider();
          }
        })
        .catch((error: Error) => {
          pCache.state = 'error';
          pCache.error = error;

          console.error(error);

          if (getSongInfo().videoId === info.videoId) {
            setLyricsStore('lyrics', (old) => {
              return {
                ...old,
                [providerName]: { state: 'error', error, data: null },
              };
            });
            selectBestProvider();
          }
        }),
    );
  }

  Promise.allSettled(tasks).then(() => {
    cache.state = 'done';
    searchCache.set(info.videoId, cache);
  });
};

export const retrySearch = (provider: ProviderName, info: SongInfo) => {
  setLyricsStore('lyrics', (old) => {
    const pCache = {
      state: 'fetching',
      data: null,
      error: null,
    };

    return {
      ...old,
      [provider]: pCache,
    };
  });

  providers[provider]
    .search(info)
    .then((res) => {
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'done', data: res, error: null },
        };
      });
      selectBestProvider();
    })
    .catch((error) => {
      setLyricsStore('lyrics', (old) => {
        return {
          ...old,
          [provider]: { state: 'error', data: null, error },
        };
      });
      selectBestProvider();
    });
};
