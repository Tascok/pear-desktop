interface LRCTag {
  tag: string;
  value: string;
}

interface LRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: { timeInMs: number; word: string; duration?: number; isBackground?: boolean }[];
}

interface LRC {
  tags: LRCTag[];
  lines: LRCLine[];
}

const tagRegex = /^\[(?<tag>\w+):\s*(?<value>.+?)\s*\]$/;
// prettier-ignore
const timestampRegex = /^\[(?<minutes>\d+):(?<seconds>\d+)\.(?<centiseconds>\d+)\]/m;

export const LRC = {
  parse: (text: string): LRC => {
    const lrc: LRC = {
      tags: [],
      lines: [],
    };

    let offset = 0;

    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line.startsWith('[')) continue;

      const timestamps = [];
      let match: Record<string, string> | undefined;
      while ((match = line.match(timestampRegex)?.groups)) {
        const { minutes, seconds, centiseconds } = match;
        const milliseconds = match.centiseconds.padEnd(3, '0');
        const timeInMs =
          ((parseInt(minutes) * 60) * 1000) +
          (parseInt(seconds) * 1000) +
          parseInt(milliseconds);

        timestamps.push({
          time: `${minutes}:${seconds}:${centiseconds}`,
          timeInMs,
        });

        line = line.replace(timestampRegex, '');
      }

      if (!timestamps.length) {
        const tag = line.match(tagRegex)?.groups;
        if (tag) {
          if (tag.tag === 'offset') {
            offset = parseInt(tag.value);
            continue;
          }

          lrc.tags.push({
            tag: tag.tag,
            value: tag.value,
          });
        }
        continue;
      }

      let lineText = line.trim();
      
      // Inline timestamps regex matching <mm:ss.cc> or ⟨mm:ss.cc⟩
      const inlineTagRegex = /(?:<|⟨)(\d+):(\d+)(?:\.|:)(\d+)(?:>|⟩)/g;
      const inlineMatches: { index: number; text: string; timeInMs: number; length: number }[] = [];
      let inlineMatch;
      
      while ((inlineMatch = inlineTagRegex.exec(lineText)) !== null) {
        const mins = parseInt(inlineMatch[1], 10);
        const secs = parseInt(inlineMatch[2], 10);
        let msStr = inlineMatch[3];
        if (msStr.length === 2) msStr += '0';
        const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
        const timeInMs = (((mins * 60) + secs) * 1000) + ms;
        
        inlineMatches.push({
          index: inlineMatch.index,
          text: inlineMatch[0],
          timeInMs,
          length: inlineMatch[0].length,
        });
      }

      const words: { timeInMs: number; word: string; duration?: number }[] = [];
      let cleanText = lineText;

      const firstTimestampInMs = timestamps[0].timeInMs;

      if (inlineMatches.length > 0) {
        // Text before the first inline tag belongs to the line start time
        const firstPart = lineText.substring(0, inlineMatches[0].index).trim();
        if (firstPart) {
          words.push({
            timeInMs: firstTimestampInMs,
            word: firstPart,
          });
        }
        
        for (let i = 0; i < inlineMatches.length; i++) {
          const currentMatch = inlineMatches[i];
          const nextMatch = inlineMatches[i + 1];
          const startIndex = currentMatch.index + currentMatch.length;
          const endIndex = nextMatch ? nextMatch.index : lineText.length;
          
          const wordText = lineText.substring(startIndex, endIndex).trim();
          if (wordText) {
            words.push({
              timeInMs: currentMatch.timeInMs,
              word: wordText,
            });
          }
        }
        
        // Calculate duration for each word/syllable
        for (let i = 0; i < words.length; i++) {
          const current = words[i];
          const next = words[i + 1];
          if (next) {
            current.duration = next.timeInMs - current.timeInMs;
          } else {
            current.duration = 300; // default duration for last word
          }
        }

        // Mark parenthetical words as background vocals
        let inParentheses = false;
        const markedWords = words.map((w) => {
          const currentWord = w.word;
          const hasOpenParen = currentWord.includes('(');
          const hasCloseParen = currentWord.includes(')');
          
          if (hasOpenParen) inParentheses = true;
          const isBg = inParentheses || undefined;
          if (hasCloseParen) inParentheses = false;
          
          if (isBg) {
            return { ...w, isBackground: isBg };
          }
          return w;
        });

        // Replace words with markedWords
        words.splice(0, words.length, ...markedWords);

        cleanText = words.map((w) => w.word).join(' ');
      }

      for (const { time, timeInMs } of timestamps) {
        lrc.lines.push({
          time,
          timeInMs,
          text: cleanText,
          words,
          duration: Infinity,
        });
      }
    }

    lrc.lines.sort(({ timeInMs: timeA }, { timeInMs: timeB }) => timeA - timeB);
    for (let i = 0; i < lrc.lines.length; i++) {
      const current = lrc.lines[i];
      const next = lrc.lines[i + 1];

      current.timeInMs += offset;

      if (next) {
        current.duration = next.timeInMs - current.timeInMs;
      }
    }

    const first = lrc.lines.at(0);
    if (first && first.timeInMs > 300) {
      lrc.lines.unshift({
        time: '00:00:00',
        timeInMs: 0,
        duration: first.timeInMs,
        text: '',
        words: [],
      });
    }

    return lrc;
  },
};
