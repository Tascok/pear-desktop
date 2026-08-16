import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  untrack,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';

import {
  ErrorDisplay,
  LoadingKaomoji,
  NotFoundKaomoji,
  SyncedLine,
  PlainLyrics,
  PauseIndicator,
} from './components';
import { LyricsPicker } from './components/LyricsPicker';
import { reactiveOwner } from './reactive-root';
import { config, currentLyrics, setConfig } from './store';
import { selectors } from './utils';

import type { LineLyrics } from '../types';

export { config, setConfig };

export const [isVisible, setIsVisible] = createSignal<boolean>(false);

runWithOwner(reactiveOwner, () => {
  createEffect(() => {
    if (!config()?.enabled) return;
    const root = document.documentElement;

    // Set the line effect
    switch (config()?.lineEffect) {
      case 'fancy':
        root.style.setProperty('--lyrics-font-size', '3rem');
        root.style.setProperty('--lyrics-line-height', '1.333');
        root.style.setProperty('--lyrics-width', '100%');
        root.style.setProperty('--lyrics-padding', '2rem');
        root.style.setProperty(
          '--lyrics-animations',
          'lyrics-glow var(--lyrics-glow-duration) ease-in-out infinite alternate, lyrics-wobble var(--lyrics-wobble-duration) ease-in-out infinite alternate',
        );

        root.style.setProperty('--lyrics-inactive-font-weight', '700');
        root.style.setProperty('--lyrics-inactive-opacity', '0.33');
        root.style.setProperty('--lyrics-inactive-scale', '0.95');
        root.style.setProperty('--lyrics-inactive-offset', '0');

        root.style.setProperty('--lyrics-active-font-weight', '700');
        root.style.setProperty('--lyrics-active-opacity', '1');
        root.style.setProperty('--lyrics-active-scale', '1');
        root.style.setProperty('--lyrics-active-offset', '0');

        root.style.setProperty('--lyrics-word-active-scale', '1.12');
        root.style.setProperty('--lyrics-word-glow-color', 'rgba(255, 255, 255, 0.6)');
        break;
      case 'scale':
        root.style.setProperty(
          '--lyrics-font-size',
          'clamp(1.4rem, 1.1vmax, 3rem)',
        );
        root.style.setProperty(
          '--lyrics-line-height',
          'var(--ytmusic-body-line-height)',
        );
        root.style.setProperty('--lyrics-width', '83%');
        root.style.setProperty('--lyrics-padding', '0');
        root.style.setProperty('--lyrics-animations', 'none');

        root.style.setProperty('--lyrics-inactive-font-weight', '400');
        root.style.setProperty('--lyrics-inactive-opacity', '0.33');
        root.style.setProperty('--lyrics-inactive-scale', '1');
        root.style.setProperty('--lyrics-inactive-offset', '0');

        root.style.setProperty('--lyrics-active-font-weight', '700');
        root.style.setProperty('--lyrics-active-opacity', '1');
        root.style.setProperty('--lyrics-active-scale', '1.2');
        root.style.setProperty('--lyrics-active-offset', '0');

        root.style.setProperty('--lyrics-word-active-scale', '1.25');
        root.style.setProperty('--lyrics-word-glow-color', 'rgba(255, 255, 255, 0)');
        break;
      case 'offset':
        root.style.setProperty(
          '--lyrics-font-size',
          'clamp(1.4rem, 1.1vmax, 3rem)',
        );
        root.style.setProperty(
          '--lyrics-line-height',
          'var(--ytmusic-body-line-height)',
        );
        root.style.setProperty('--lyrics-width', '100%');
        root.style.setProperty('--lyrics-padding', '0');
        root.style.setProperty('--lyrics-animations', 'none');

        root.style.setProperty('--lyrics-inactive-font-weight', '400');
        root.style.setProperty('--lyrics-inactive-opacity', '0.33');
        root.style.setProperty('--lyrics-inactive-scale', '1');
        root.style.setProperty('--lyrics-inactive-offset', '0');

        root.style.setProperty('--lyrics-active-font-weight', '700');
        root.style.setProperty('--lyrics-active-opacity', '1');
        root.style.setProperty('--lyrics-active-scale', '1');
        root.style.setProperty('--lyrics-active-offset', '5%');

        root.style.setProperty('--lyrics-word-active-scale', '1.1');
        root.style.setProperty('--lyrics-word-glow-color', 'rgba(255, 255, 255, 0.3)');
        break;
      case 'focus':
        root.style.setProperty(
          '--lyrics-font-size',
          'clamp(1.4rem, 1.1vmax, 3rem)',
        );
        root.style.setProperty(
          '--lyrics-line-height',
          'var(--ytmusic-body-line-height)',
        );
        root.style.setProperty('--lyrics-width', '100%');
        root.style.setProperty('--lyrics-padding', '0');
        root.style.setProperty('--lyrics-animations', 'none');

        root.style.setProperty('--lyrics-inactive-font-weight', '400');
        root.style.setProperty('--lyrics-inactive-opacity', '0.33');
        root.style.setProperty('--lyrics-inactive-scale', '1');
        root.style.setProperty('--lyrics-inactive-offset', '0');

        root.style.setProperty('--lyrics-active-font-weight', '700');
        root.style.setProperty('--lyrics-active-opacity', '1');
        root.style.setProperty('--lyrics-active-scale', '1');
        root.style.setProperty('--lyrics-active-offset', '0');

        root.style.setProperty('--lyrics-word-active-scale', '1.06');
        root.style.setProperty('--lyrics-word-glow-color', 'rgba(255, 255, 255, 0.35)');
        break;
    }
  });
});

type LyricsRendererChild =
  | { kind: 'LyricsPicker' }
  | { kind: 'LoadingKaomoji' }
  | { kind: 'NotFoundKaomoji' }
  | { kind: 'Error'; error: Error }
  | {
      kind: 'SyncedLine';
      line: LineLyrics;
      lineIndex: number;
    }
  | {
      kind: 'PlainLine';
      line: string;
    }
  | {
      kind: 'PauseIndicator';
      startTime: number;
      endTime: number;
    };

const lyricsPicker: LyricsRendererChild = { kind: 'LyricsPicker' };

export const [currentTime, setCurrentTime] = createSignal<number>(-1);
export const [currentIndex, setCurrentIndex] = createSignal<number>(0);

let activeScrollAnimationId: number | null = null;

// Smooth, organic easing — Apple Music style (no bounce)
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateScroll(element: HTMLElement, target: number, duration = 500) {
  if (activeScrollAnimationId !== null) {
    cancelAnimationFrame(activeScrollAnimationId);
  }

  const start = element.scrollTop;
  const change = target - start;

  if (Math.abs(change) < 1) {
    element.scrollTop = target;
    return;
  }

  // Use CSS scroll-behavior for smooth native scrolling when available
  if ('scrollBehavior' in element.style) {
    element.scrollTo({ top: target, behavior: 'smooth' });
    return;
  }

  const startTime = performance.now();

  const animate = (time: number) => {
    const elapsed = time - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);

    element.scrollTop = start + (change * eased);

    if (progress < 1) {
      activeScrollAnimationId = requestAnimationFrame(animate);
    } else {
      activeScrollAnimationId = null;
    }
  };

  activeScrollAnimationId = requestAnimationFrame(animate);
}

export const LyricsRenderer = () => {
  const [scroller, setScroller] = createSignal<VirtualizerHandle>();
  const [stickyRef, setStickRef] = createSignal<HTMLElement | null>(null);

  const tab = document.querySelector<HTMLElement>(selectors.body.tabRenderer)!;

  let mouseCoord = 0;
  const mousemoveListener = (e: Event) => {
    if ('clientY' in e) {
      mouseCoord = (e as MouseEvent).clientY;
    }

    const { top } = tab.getBoundingClientRect();
    const { clientHeight: height } = stickyRef()!;
    const scrollOffset = scroller()?.scrollOffset ?? -1;

    const isInView = scrollOffset <= height;
    const isMouseOver = mouseCoord - top - 5 <= height;

    const showPicker = isInView || isMouseOver;

    if (showPicker) {
      // picker visible
      stickyRef()!.style.setProperty('--lyrics-picker-top', '0');
    } else {
      // picker hidden
      stickyRef()!.style.setProperty('--lyrics-picker-top', `-${height}px`);
    }
  };

  onMount(() => {
    const vList = document.querySelector<HTMLElement>('.synced-lyrics-vlist');

    tab.addEventListener('mousemove', mousemoveListener);
    vList?.addEventListener('scroll', mousemoveListener);
    vList?.addEventListener('scrollend', mousemoveListener);

    onCleanup(() => {
      tab.removeEventListener('mousemove', mousemoveListener);
      vList?.removeEventListener('scroll', mousemoveListener);
      vList?.removeEventListener('scrollend', mousemoveListener);
    });
  });

  const [children, setChildren] = createSignal<LyricsRendererChild[]>([
    { kind: 'LoadingKaomoji' },
  ]);

  createEffect(() => {
    const current = currentLyrics();
    if (!current) {
      setChildren(() => [{ kind: 'NotFoundKaomoji' }]);
      return;
    }

    const { state, data, error } = current;

    setChildren(() => {
      if (state === 'fetching') {
        return [{ kind: 'LoadingKaomoji' }];
      }

      if (state === 'error') {
        return [{ kind: 'Error', error: error! }];
      }

      if (data?.lines) {
        // Detect the most common voice — if >50% lines share a non-lead voice,
        // treat it as the actual lead so they don't get mis-positioned.
        const voiceCounts = new Map<string, number>();
        for (const l of data.lines) {
          const key = l.voice ?? '__none__';
          voiceCounts.set(key, (voiceCounts.get(key) ?? 0) + 1);
        }

        let primaryVoice: string | undefined;
        let maxCount = 0;
        for (const [v, c] of voiceCounts) {
          if (c > maxCount) {
            maxCount = c;
            primaryVoice = v === '__none__' ? undefined : v;
          }
        }

        const isPrimaryUnknown =
          primaryVoice !== undefined &&
          !/^(lead|v1|vocal[ -]?1|solo)$/i.test(primaryVoice);

        // Build children with pause indicators between lines with big gaps (>2s)
        const result: LyricsRendererChild[] = [];
        for (let i = 0; i < data.lines.length; i++) {
          const line = data.lines[i];
          result.push({
            kind: 'SyncedLine' as const,
            line: {
              ...line,
              voice:
                isPrimaryUnknown && line.voice === primaryVoice
                  ? undefined
                  : line.voice,
            },
            lineIndex: i,
          });
          
          // Check if there's a big enough gap after this line to add a pause indicator
          if (i < data.lines.length - 1) {
            const nextLine = data.lines[i + 1];
            const thisLineEnd = line.timeInMs + line.duration;
            const gap = nextLine.timeInMs - thisLineEnd;
            if (gap > 2000) { // more than 2 seconds gap
              result.push({
                kind: 'PauseIndicator' as const,
                startTime: thisLineEnd,
                endTime: nextLine.timeInMs,
              });
            }
          }
        }
        return result;
      }

      if (data?.lyrics) {
        const lines = data.lyrics.split('\n').filter((line) => line.trim());
        return lines.map((line) => ({
          kind: 'PlainLine' as const,
          line,
        }));
      }

      return [{ kind: 'NotFoundKaomoji' }];
    });
  });

  const scrollIndex = createMemo(() => {
    const time = currentTime();
    const data = currentLyrics()?.data;
    if (!data || !data.lines || data.lines.length === 0) return -1;

    // Find if we are currently inside a line
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (time >= line.timeInMs && time < line.timeInMs + line.duration) {
        return i;
      }
    }

    // If not inside any line, find the next line
    let nextLineIdx = -1;
    for (let i = 0; i < data.lines.length; i++) {
      if (data.lines[i].timeInMs > time) {
        nextLineIdx = i;
        break;
      }
    }

    if (nextLineIdx === -1) {
      return data.lines.length - 1;
    }

    if (nextLineIdx === 0) {
      const firstLine = data.lines[0];
      if (firstLine.timeInMs - time <= 1500) {
        return 0;
      }
      return -1;
    }

    const nextLine = data.lines[nextLineIdx];
    if (nextLine.timeInMs - time <= 1500) {
      return nextLineIdx;
    }

    return nextLineIdx - 1;
  });

  console.log('[Lyrics] scrollIndex changed:', scrollIndex(), 'currentTime:', currentTime());

  const [statuses, setStatuses] = createSignal<
    ('previous' | 'current' | 'upcoming')[]
  >([]);
  createEffect(() => {
    const data = currentLyrics()?.data;
    const activeIdx = scrollIndex();

    if (!data || !data.lines) return setStatuses([]);

    const previous = untrack(statuses);
    const current = data.lines.map((_, idx) => {
      if (idx === activeIdx) return 'current';
      if (idx < activeIdx) return 'previous';
      return 'upcoming';
    });

    if (previous.length !== current.length) return setStatuses(current);
    if (previous.every((status, idx) => status === current[idx])) return;

    setStatuses(current);
    return;
  });

  createEffect(() => {
    const activeIdx = scrollIndex();
    const data = currentLyrics()?.data;
    console.log('[Lyrics] scroll effect activeIdx=', activeIdx, 'lines=', data?.lines?.length, 'currentTime=', currentTime());
    if (activeIdx === -1) return;
    setCurrentIndex(activeIdx);
  });

  createEffect(() => {
    const current = currentLyrics();
    const lineIdx = currentIndex(); // index of current line in original data.lines array
    const childList = children();

    if (!scroller() || !current || !current.data?.lines) return;

    // Find the actual index in the VList data array ([lyricsPicker, ...children()])
    // that corresponds to the current line
    let vlistIndex = 0; // start at 0, but LyricsPicker is at index 0, so start checking from children()
    let found = false;
    for (let i = 0; i < childList.length; i++) {
      const child = childList[i];
      if (child.kind === 'SyncedLine' && child.lineIndex === lineIdx) {
        vlistIndex = i + 1; // +1 because of the lyricsPicker at index 0
        found = true;
        break;
      }
    }

    if (found) {
      const container = document.querySelector('.synced-lyrics-vlist') as HTMLElement;
      if (container) {
        const startScrollTop = container.scrollTop;
        scroller()!.scrollToIndex(vlistIndex, {
          align: 'center',
        });
        const targetScrollTop = container.scrollTop;
        container.scrollTop = startScrollTop;

        console.log('[Lyrics] animateScroll', { vlistIndex, startScrollTop, targetScrollTop });
        animateScroll(container, targetScrollTop);
      } else {
        console.warn('[Lyrics] .synced-lyrics-vlist not in DOM, using smooth scroll');
        scroller()!.scrollToIndex(vlistIndex, {
          smooth: true,
          align: 'center',
        });
      }
    } else {
      console.warn('[Lyrics] lineIdx', lineIdx, 'not found in children(), skipping scroll');
    }
  });

  return (
    <Show when={isVisible()}>
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        <VList
          {...{
            ref: setScroller,
            style: { 'scrollbar-width': 'none', 'z-index': 1, 'background': 'transparent' },
            class: 'synced-lyrics-vlist',
            keepMounted: [0],
            overscan: 4,
          }}
          data={[lyricsPicker, ...children()]}
        >
          {(props, idx) => {
            if (typeof props === 'undefined') return null;
            switch (props.kind) {
              case 'LyricsPicker':
                return <LyricsPicker setStickRef={setStickRef} />;
              case 'Error':
                return <ErrorDisplay {...props} />;
              case 'LoadingKaomoji':
                return <LoadingKaomoji />;
              case 'NotFoundKaomoji':
                return <NotFoundKaomoji />;
              case 'SyncedLine': {
                return (
                  <SyncedLine
                    {...props}
                    index={idx()}
                    scroller={scroller()!}
                    status={statuses()[props.lineIndex]}
                  />
                );
              }
              case 'PlainLine': {
                return <PlainLyrics {...props} />;
              }
              case 'PauseIndicator': {
                return <PauseIndicator {...props} />;
              }
            }
          }}
        </VList>
      </div>
    </Show>
  );
};
