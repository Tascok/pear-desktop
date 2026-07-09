export interface QRCWord {
  timeInMs: number;
  word: string;
  duration: number;
}

export interface QRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: QRCWord[];
}

export class QRC {
  static parse(qrcText: string): { lines: QRCLine[] } {
    const lines: QRCLine[] = [];

    // Remove XML wrapping if present
    const attrMatch = qrcText.match(/LyricContent="([\s\S]*?)"\s*(?:\/?>|[a-zA-Z]+=)/);
    const content = attrMatch ? attrMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : qrcText;

    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed || /^\[[a-zA-Z]+:/.test(trimmed)) continue;

      // Extract line time [startTime, duration]
      const lineTimeMatch = trimmed.match(/^\[(\d+),(\d+)\]/);
      if (!lineTimeMatch) continue;

      const startTime = parseInt(lineTimeMatch[1], 10);
      const duration = parseInt(lineTimeMatch[2], 10);
      const rest = trimmed.slice(lineTimeMatch[0].length);

      // Parse words
      const words: QRCWord[] = [];
      const wordRegex = /([^()]*)\((\d+),(\d+)\)/g;
      let match;
      let lineText = '';

      while ((match = wordRegex.exec(rest)) !== null) {
        const wordText = match[1];
        const wordTime = parseInt(match[2], 10);
        const wordDuration = parseInt(match[3], 10);

        words.push({
          word: wordText,
          timeInMs: wordTime,
          duration: wordDuration,
        });
        lineText += wordText;
      }

      if (words.length === 0 && lineText === '') {
        // Fallback to plain line text if no parenthesized words found
        lineText = rest;
      }

      const formatTime = (ms: number) => {
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        const centiseconds = Math.floor((ms % 1000) / 10);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
      };

      lines.push({
        time: formatTime(startTime),
        timeInMs: startTime,
        duration,
        text: lineText,
        words,
      });
    }

    return { lines };
  }
}
