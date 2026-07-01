export interface TTMLWord {
  timeInMs: number;
  word: string;
  duration: number;
  isBackground?: boolean;
}

export interface TTMLLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: TTMLWord[];
  voice?: string;   // 'lead' | 'backing' | 'duet' | etc
}

export interface TTMLLyrics {
  lines: TTMLLine[];
}

/**
 * Parse a TTML timestamp string into milliseconds.
 * Supports formats:
 *  - HH:MM:SS.mmm  (hours:minutes:seconds.milliseconds)
 *  - MM:SS.mmm     (minutes:seconds.milliseconds)
 *  - MM:SS.cc      (minutes:seconds.centiseconds)
 *  - SS.mmm        (seconds.milliseconds)
 */
function parseTTMLTime(time: string): number {
  if (!time) return 0;

  // Normalize: replace comma with dot for decimal separator
  time = time.replace(',', '.');

  // MM:SS.cc (2-digit fractional = centiseconds) or MM:SS.mmm (3-digit = milliseconds)
  const mmss = time.match(/^(\d+):(\d+)\.(\d+)$/);
  if (mmss) {
    const minutes = parseInt(mmss[1], 10);
    const seconds = parseInt(mmss[2], 10);
    let frac = mmss[3];
    // If 2 digits, treat as centiseconds -> * 10 for ms; if 3 digits, already ms
    if (frac.length === 2) frac += '0';
    while (frac.length < 3) frac += '0';
    const ms = parseInt(frac.slice(0, 3), 10);
    return (minutes * 60 + seconds) * 1000 + ms;
  }

  // HH:MM:SS.mmm (3-digit fractional = milliseconds)
  const hhmmss = time.match(/^(\d+):(\d+):(\d+)\.(\d+)$/);
  if (hhmmss) {
    const hours = parseInt(hhmmss[1], 10);
    const minutes = parseInt(hhmmss[2], 10);
    const seconds = parseInt(hhmmss[3], 10);
    let frac = hhmmss[4];
    if (frac.length === 2) frac += '0';
    while (frac.length < 3) frac += '0';
    const ms = parseInt(frac.slice(0, 3), 10);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms;
  }

  // HH:MM:SS (no fractional)
  const hhmm = time.match(/^(\d+):(\d+):(\d+)$/);
  if (hhmm) {
    const hours = parseInt(hhmm[1], 10);
    const minutes = parseInt(hhmm[2], 10);
    const seconds = parseInt(hhmm[3], 10);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  // MM:SS (no fractional)
  const msOnly = time.match(/^(\d+):(\d+)$/);
  if (msOnly) {
    const minutes = parseInt(msOnly[1], 10);
    const seconds = parseInt(msOnly[2], 10);
    return (minutes * 60 + seconds) * 1000;
  }

  // Plain seconds (SS.mmm or SS)
  const sec = parseFloat(time);
  if (!isNaN(sec)) {
    return Math.round(sec * 1000);
  }

  return 0;
}

/**
 * Merge consecutive TTML words that were split across spans but form a single
 * word in the original text.  E.g. ["ha", "ving"] → ["having"] when the
 * original line text contains "having".
 */
function mergeSplitWords(words: TTMLWord[], fullText: string): TTMLWord[] {
  const result: TTMLWord[] = [];
  // Create a version of fullText without extra spaces to check
  const normalizedFullText = fullText.replace(/\s+/g, '');

  for (let i = 0; i < words.length; i++) {
    let merged = { ...words[i] };

    while (i + 1 < words.length) {
      // Don't merge if isBackground differs!
      if (!!merged.isBackground !== !!words[i+1].isBackground) break;

      const nextWord = words[i + 1];
      const combinedText = merged.word + nextWord.word;
      
      // Smart check: either combined is exactly in original text without space,
      // OR there's no space between them in normalized full text
      const originalHasCombined = fullText.includes(combinedText);
      const normalizedHasCombined = normalizedFullText.includes(combinedText);
      
      // Also check if original text doesn't have space between merged.word and nextWord
      const combinedWithSpace = merged.word + ' ' + nextWord.word;
      const originalHasSpace = fullText.includes(combinedWithSpace);
      
      // Only merge if we don't have a space, and combined is present
      if (!originalHasSpace && (originalHasCombined || normalizedHasCombined)) {
        merged = {
          ...merged,
          word: combinedText,
          duration: nextWord.timeInMs + (nextWord.duration || 0) - merged.timeInMs,
          isBackground: merged.isBackground,
        };
        i++;
      } else {
        break;
      }
    }
    result.push(merged);
  }
  return result;
}

/**
 * Format milliseconds to MM:SS.mmm string
 */
function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const millis = ms % 1000;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

export const TTML = {
  /**
   * Parse a TTML XML string into structured lyrics data with word-level timestamps.
   */
  parse: (ttmlContent: string): TTMLLyrics => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlContent, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`TTML parse error: ${parseError.textContent}`);
    }

    const lines: TTMLLine[] = [];

    // Iterate over <div> elements (each can represent a different voice part)
    const divs = doc.querySelectorAll('body > div');
    if (divs.length === 0) {
      // Fallback: use all <p> in the document
      const fallbackDivs = doc.querySelectorAll('div');
      for (const div of fallbackDivs) {
        extractLinesFromDiv(div, lines);
      }
      if (lines.length === 0) {
        // Last resort: direct <p> under <body>
        const paragraphs = doc.querySelectorAll('p');
        for (const p of paragraphs) {
          processParagraph(p, undefined, lines);
        }
      }
    } else {
      for (const div of divs) {
        extractLinesFromDiv(div, lines);
      }
    }

    // Sort all lines by time
    lines.sort((a, b) => a.timeInMs - b.timeInMs);

    // Fill infinite durations
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].duration === Infinity || lines[i].duration <= 0) {
        const next = lines[i + 1];
        if (next) {
          lines[i].duration = next.timeInMs - lines[i].timeInMs;
        }
      }
    }

    return { lines };

    /** Extract voice from a <div> and process all its <p> children */
    function extractLinesFromDiv(div: Element, out: TTMLLine[]) {
      // Try ttm:agent first, then xml:id, then class
      let voice = div.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'agent')
               || div.getAttribute('ttm:agent')
               || div.getAttribute('ttm\\:agent')
               || '';
      if (voice) {
        // Normalise: lowercase, strip common prefixes
        voice = voice.toLowerCase().replace(/^vocal[-_]?/, '');
      }

      const paragraphs = div.querySelectorAll(':scope > p');
      for (const p of paragraphs) {
        processParagraph(p, voice || undefined, out);
      }
    }

    /** Process a single <p> into a TTMLLine */
    function processParagraph(
      p: Element,
      voice: string | undefined,
      out: TTMLLine[],
    ) {
      const begin = p.getAttribute('begin') || '';
      const end = p.getAttribute('end') || '';

      const beginMs = parseTTMLTime(begin);
      const endMs = parseTTMLTime(end);

      // Also check <p> for per-paragraph overrides
      const pVoice = p.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'agent')
                  || p.getAttribute('ttm:agent')
                  || p.getAttribute('ttm\\:agent')
                  || '';
      const effectiveVoice = (pVoice
        ? pVoice.toLowerCase().replace(/^vocal[-_]?/, '')
        : voice) || undefined;

      const spans = p.querySelectorAll(':scope > span');
      const words: TTMLWord[] = [];
      const textParts: string[] = [];

      if (spans.length > 0) {
        for (const span of spans) {
          const wBegin = span.getAttribute('begin') || begin;
          const wEnd = span.getAttribute('end') || end;
          const wordText = span.textContent || '';
          const role = span.getAttribute('role') || '';
          const isBackground = role.toLowerCase() === 'x-bg';

          // If this span has nested spans (background vocal structure),
          // process children individually
          const nestedSpans = span.querySelectorAll(':scope > span');
          if (nestedSpans.length > 0) {
            for (const nested of nestedSpans) {
              const nBegin = nested.getAttribute('begin') || wBegin;
              const nEnd = nested.getAttribute('end') || wEnd;
              const nText = nested.textContent || '';
              words.push({
                timeInMs: parseTTMLTime(nBegin),
                word: nText,
                duration: Math.max(0, parseTTMLTime(nEnd) - parseTTMLTime(nBegin)),
                isBackground,
              });
              textParts.push(nText);
            }
          } else {
            const wBeginMs = parseTTMLTime(wBegin);
            const wEndMs = parseTTMLTime(wEnd);

            words.push({
              timeInMs: wBeginMs,
              word: wordText,
              duration: Math.max(0, wEndMs - wBeginMs),
              isBackground,
            });

            textParts.push(wordText);
          }
        }
      } else {
        // No spans — use the paragraph text
        const rawText = p.textContent || '';
        textParts.push(rawText);
      }

      // First, get the ACTUAL original full text from the paragraph itself!
      const fullText = (p.textContent || '').trim();
      
      // Skip completely empty lines (instrumental break markers)
      if (!fullText) return;
      
      // 1. First mark which words are background based on TTML role
      let tempWords = [...words];
      
      // 2. Now check for parenthetical phrases and mark them as background
      let inParentheses = false;
      for (let i = 0; i < tempWords.length; i++) {
        const w = tempWords[i];
        const currentWord = w.word;
        
        // Check for parentheses
        const hasOpenParen = currentWord.includes('(');
        const hasCloseParen = currentWord.includes(')');
        
        if (hasOpenParen) inParentheses = true;
        const isBg = inParentheses || !!w.isBackground;
        if (hasCloseParen) inParentheses = false;
        
        tempWords[i] = { ...w, isBackground: isBg };
      }
      
      // 3. Merge words only if they are NOT background and form a single word in original text
      const mergedWords = tempWords.length > 0 ? mergeSplitWords(tempWords, fullText) : tempWords;
      
      // 4. Fallback if no spans (no word timestamps)
      const lineWords = mergedWords.length > 0 ? mergedWords : fullText.split(/\s+/).map((w, i, arr) => {
        const lineDuration = endMs - beginMs || 0;
        const wordDuration = arr.length > 0 ? lineDuration / arr.length : 300;
        return {
          timeInMs: beginMs + i * wordDuration,
          word: w,
          duration: wordDuration,
          isBackground: undefined,
        };
      });
      
      const markedWords = lineWords;

      out.push({
        time: formatTime(beginMs),
        timeInMs: beginMs,
        duration: endMs - beginMs || Infinity,
        text: fullText,
        words: markedWords,
        voice: effectiveVoice,
      });
    }
  },
};
