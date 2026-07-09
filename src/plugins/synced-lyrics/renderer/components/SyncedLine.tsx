import {
  createEffect,
  For,
  Show,
  createSignal,
  createMemo,
} from 'solid-js';
import { type VirtualizerHandle } from 'virtua/solid';

import { type LineLyrics } from '@/plugins/synced-lyrics/types';

import { _ytAPI } from '..';
import { config, currentTime } from '../renderer';
import {
  canonicalize,
  convertChineseCharacter,
  romanize,
  simplifyUnicode,
} from '../utils';

interface SyncedLineProps {
  scroller: VirtualizerHandle;
  index: number;
  lineIndex: number;

  line: LineLyrics;
  status: 'upcoming' | 'current' | 'previous';
}

const EmptyLine = (props: SyncedLineProps) => {
  const states = createMemo(() => {
    const defaultText = config()?.defaultTextString ?? '';
    return Array.isArray(defaultText) ? defaultText : [defaultText];
  });

  const lineStatus = createMemo((): 'upcoming' | 'current' | 'previous' => {
    const time = currentTime();
    const start = props.line.timeInMs;
    const end = start + props.line.duration;
    if (time < start) return 'upcoming';
    if (time >= end) return 'previous';
    return 'current';
  });

  const index = createMemo(() => {
    const progress = currentTime() - props.line.timeInMs;
    const total = props.line.duration;

    const percentage = Math.min(1, progress / total);
    return Math.max(0, Math.floor((states().length - 1) * percentage));
  });

  return (
    <div
      class={`synced-line ${lineStatus()}`}
      onClick={() => {
        _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
      }}
    >
      <div class="description ytmusic-description-shelf-renderer" dir="auto">
        <yt-formatted-string
          text={{
            runs: [
              {
                text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
              },
            ],
          }}
        />

        <div class="text-lyrics">
          <span>
            <span>
              <Show
                fallback={
                  <yt-formatted-string
                    text={{ runs: [{ text: states()[0] }] }}
                  />
                }
                when={states().length > 1}
              >
                <yt-formatted-string
                  text={{
                    runs: [
                      {
                        text: states().at(
                          lineStatus() === 'current' ? index() : -1,
                        )!,
                      },
                    ],
                  }}
                />
              </Show>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};

function voiceClass(voice: string | undefined): string {
  if (!voice) return '';
  const v = voice.toLowerCase();
  if (v === 'v2' || v === 'vocal 2' || v === 'duet' || v === 'duo') return 'duet';
  if (v === 'v3' || v === 'vocal 3' || v === 'backing' || v === 'bg') return 'backing';
  return v;
}

function isLeadVoice(voice: string | undefined): boolean {
  if (!voice) return false;
  const v = voice.toLowerCase();
  return v === 'lead' || v === 'v1' || v === 'vocal 1' || v === 'solo';
}

export const SyncedLine = (props: SyncedLineProps) => {
  const text = createMemo(() => {
    let line = props.line.text;
    const convertChineseText = config()?.convertChineseCharacter;
    if (convertChineseText && convertChineseText !== 'disabled') {
      line = convertChineseCharacter(line, convertChineseText);
    }
    return line.trim();
  });

  const [romanization, setRomanization] = createSignal('');
  createEffect(() => {
    const input = canonicalize(text());
    if (!config()?.romanization) return;

    romanize(input).then((result) => {
      setRomanization(canonicalize(result));
    });
  });

  // Word-level timestamps from the provider. Empty = no word-by-word support.
  const displayWords = createMemo((): { word: string; timeInMs: number; duration?: number; isBackground?: boolean }[] => {
    return props.line.words ?? [];
  });

  const hasWords = createMemo(() => displayWords().length > 0);

  // Internal line status, computed from currentTime() — NOT from props.status,
  // because virtua's VList wraps the render callback in untrack(), so props.status
  // never updates. This memo reacts to currentTime() every 100ms.
  const lineStatus = createMemo((): 'upcoming' | 'current' | 'previous' => {
    const time = currentTime();
    const start = props.line.timeInMs;
    const end = start + props.line.duration;
    if (time < start) return 'upcoming';
    if (time >= end) return 'previous';
    return 'current';
  });

  // Per-word progress 0→1 — drives word-by-word highlight
  const wordProgress = createMemo(() => {
    const words = displayWords();
    if (!words.length) return [];
    const time = currentTime();
    const status = lineStatus();
    return words.map((w) => {
      if (status === 'previous') return 1;
      if (status === 'upcoming') return 0;
      const dur = (w.duration ?? 0) > 0 ? w.duration! : 300;
      if (dur <= 0) return time >= w.timeInMs ? 1 : 0;
      return Math.min(1, Math.max(0, (time - w.timeInMs) / dur));
    });
  });

  // Group consecutive words by isBackground so we can render bg as a centered block
  const wordGroups = createMemo(() => {
    const words = displayWords();
    const groups: { isBackground: boolean; words: typeof words; indices: number[] }[] = [];
    for (let i = 0; i < words.length; i++) {
      const isBg = !!words[i].isBackground;
      if (groups.length > 0 && groups[groups.length - 1].isBackground === isBg) {
        groups[groups.length - 1].words.push(words[i]);
        groups[groups.length - 1].indices.push(i);
      } else {
        groups.push({ isBackground: isBg, words: [words[i]], indices: [i] });
      }
    }
    return groups;
  });

  // Pre-calculate the exact spacing/punctuation between words from the original line text
  const wordTexts = createMemo((): string[] => {
    const words = displayWords();
    const fullText = text();
    const result: string[] = [];
    
    let currentIndex = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i].word;
      let pos = fullText.indexOf(w, currentIndex);
      if (pos === -1) {
        pos = fullText.indexOf(w);
      }
      
      if (pos === -1) {
        result.push(w + ' ');
        continue;
      }
      
      const endPos = pos + w.length;
      let nextPos = fullText.length;
      
      if (i + 1 < words.length) {
        const nextW = words[i + 1].word;
        const nPos = fullText.indexOf(nextW, endPos);
        if (nPos !== -1) {
          nextPos = nPos;
        }
      }
      
      const betweenText = fullText.substring(endPos, nextPos);
      result.push(w + betweenText);
      currentIndex = nextPos;
    }
    return result;
  });

  return (
    <Show fallback={<EmptyLine {...props} />} when={text()}>
      <div
        class={`synced-line ${lineStatus()}${props.line.voice && !isLeadVoice(props.line.voice) ? ` voice-${voiceClass(props.line.voice)}` : ''}`}
        onClick={() => {
          _ytAPI?.seekTo((props.line.timeInMs + 10) / 1000);
        }}
      >
        <div class="description ytmusic-description-shelf-renderer" dir="auto">
          <yt-formatted-string
            text={{
              runs: [
                {
                  text: config()?.showTimeCodes ? `[${props.line.time}] ` : '',
                },
              ],
            }}
          />

          <div
            class="text-lyrics"
            ref={(div: HTMLDivElement) => {
              div.style.setProperty(
                '--lyrics-duration',
                `${props.line.duration / 1000}s`,
                'important',
              );
            }}
          >
            <Show
              fallback={
                <span>
                  <span
                    class="no-word-timestamps"
                  >
                    <yt-formatted-string
                      text={{ runs: [{ text: text() }] }}
                    />
                  </span>
                </span>
              }
              when={hasWords()}
            >
              <For each={wordGroups()}>
                {(group) => {
                  // Create bgBlockRef here so it's accessible in both Show branches
                  let bgBlockRef: HTMLSpanElement | null = null;
                  const [naturalHeight, setNaturalHeight] = createSignal(0);
                  
                  const shouldShowBg = createMemo(() => {
                    if (!group.isBackground) return false;
                    const time = currentTime();
                    // Get first word start time and last word end time
                    const firstWord = group.words[0];
                    const lastWord = group.words[group.words.length - 1];
                    const startTime = firstWord.timeInMs - 1000; // 1 second before
                    const endTime = lastWord.timeInMs + (lastWord.duration || 0);
                    return time >= startTime && time <= endTime;
                  });

                  createEffect(() => {
                    if (bgBlockRef) {
                      // Measure natural height when first rendered
                      if (naturalHeight() === 0) {
                        // Temporarily show to measure height
                        bgBlockRef.style.opacity = '0';
                        bgBlockRef.style.height = 'auto';
                        const height = bgBlockRef.offsetHeight;
                        setNaturalHeight(height);
                        bgBlockRef.style.height = '0px';
                        bgBlockRef.style.marginTop = '0px';
                        bgBlockRef.style.marginBottom = '0px';
                      }

                      // Animate based on shouldShow
                      const show = shouldShowBg();
                      const height = naturalHeight();
                      if (show) {
                        bgBlockRef.style.height = `${height}px`;
                        bgBlockRef.style.marginTop = '6px';
                        bgBlockRef.style.marginBottom = '6px';
                        bgBlockRef.style.opacity = '0.8';
                        bgBlockRef.style.transform = 'translateY(0) scale(1)';
                      } else {
                        bgBlockRef.style.height = '0px';
                        bgBlockRef.style.marginTop = '0px';
                        bgBlockRef.style.marginBottom = '0px';
                        bgBlockRef.style.opacity = '0';
                        bgBlockRef.style.transform = 'translateY(10px) scale(0.9)';
                      }
                    }
                  });

                  return (
                    <>
                      <Show when={!group.isBackground}>
                        <span>
                          <For each={group.words}>
                            {(word, idx) => {
                              const globalIndex = group.indices[idx()];
                              let wordRef: HTMLSpanElement | null = null;
                              createEffect(() => {
                                const progress = wordProgress()[globalIndex];
                                if (wordRef) {
                                  wordRef.style.setProperty('--word-progress', String(progress));
                                  wordRef.style.setProperty('--word-glow', String(Math.sin(progress * Math.PI)));
                                  wordRef.style.setProperty('--word-duration', `${word.duration || 300}ms`);
                                  wordRef.classList.toggle('word-active', progress > 0 && progress < 1);
                                  wordRef.classList.toggle('word-done', progress >= 1);
                                }
                              });
                              return (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    _ytAPI?.seekTo((word.timeInMs + 10) / 1000);
                                  }}
                                  ref={(el) => { wordRef = el; }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <yt-formatted-string
                                    text={{ runs: [{ text: wordTexts()[globalIndex] }] }}
                                  />
                                </span>
                              );
                            }}
                          </For>
                        </span>
                      </Show>
                      {group.isBackground && (
                        <span 
                          class="bg-block" 
                          ref={(el) => { bgBlockRef = el; }}
                          style={{ 
                            'opacity': 0, 
                            'transform': 'translateY(10px) scale(0.9)',
                            'height': '0px',
                            'margin-top': '0px',
                            'margin-bottom': '0px',
                          }}
                        >
                          <For each={group.words}>
                            {(word, idx) => {
                              const globalIndex = group.indices[idx()];
                              let wordRef: HTMLSpanElement | null = null;
                              createEffect(() => {
                                const progress = wordProgress()[globalIndex];
                                if (wordRef) {
                                  wordRef.style.setProperty('--word-progress', String(progress));
                                  wordRef.style.setProperty('--word-glow', String(Math.sin(progress * Math.PI)));
                                  wordRef.style.setProperty('--word-duration', `${word.duration || 300}ms`);
                                  wordRef.classList.toggle('word-active', progress > 0 && progress < 1);
                                  wordRef.classList.toggle('word-done', progress >= 1);
                                }
                              });
                              return (
                                <span
                                  class="word-bg"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    _ytAPI?.seekTo((word.timeInMs + 10) / 1000);
                                  }}
                                  ref={(el) => { wordRef = el; }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <yt-formatted-string
                                    text={{ runs: [{ text: wordTexts()[globalIndex] }] }}
                                  />
                                </span>
                              );
                            }}
                          </For>
                        </span>
                      )}
                    </>
                  );
                }}
              </For>
            </Show>

            <Show
              when={
                config()?.romanization &&
                simplifyUnicode(text()) !== simplifyUnicode(romanization())
              }
            >
              <span class="romaji">
                <For each={romanization().split(' ')}>
                  {(word, index) => {
                    return (
                      <span
                        style={{
                          'transition-delay': `${index() * 0.05}s`,
                          'animation-delay': `${index() * 0.05}s`,
                        }}
                      >
                        <yt-formatted-string
                          text={{
                            runs: [{ text: `${word} ` }],
                          }}
                        />
                      </span>
                    );
                  }}
                </For>
              </span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
