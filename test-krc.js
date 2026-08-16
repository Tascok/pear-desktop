import { unzlibSync } from 'fflate';

const base64Content = `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
+8xvK9mIog==`;

function decodeKrc(krcBase64) {
  const cleanBase64 = krcBase64.replace(/\\s+/g, '');
  const raw = Uint8Array.from(Buffer.from(cleanBase64, 'base64'));
  const body = new Uint8Array(raw.length - 4);
  const KRC_ENCODE_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  for (let i = 4; i < raw.length; i++) {
    body[i - 4] = raw[i] ^ KRC_ENCODE_KEY[(i - 4) % 16];
  }
  const decompressed = unzlibSync(body);
  return new TextDecoder('utf-8').decode(decompressed);
}

function parseKrc(content) {
  const lines = content.split(/\\r?\\n/).map(s => s.trim()).filter(s => !!s);
  const result = [];
  for (const line of lines) {
    if (line.startsWith('[ti:') || line.startsWith('[ar:') || line.startsWith('[al:') || line.startsWith('[by:')) {
      continue;
    }
    const match = line.match(/^\\[(\\d+),(\\d+)\\](.*)$/);
    if (!match) continue;
    const beginMs = parseInt(match[1], 10);
    const lineDuration = parseInt(match[2], 10);
    const body = match[3];
    const words = [];
    let text = '';
    const wordRegex = /<(\\d+),(\\d+),\\d+>([^<]+)/g;
    let wordMatch;
    while ((wordMatch = wordRegex.exec(body)) !== null) {
      const offset = parseInt(wordMatch[1], 10);
      const duration = parseInt(wordMatch[2], 10);
      const wordText = wordMatch[3];
      words.push({
        timeInMs: beginMs + offset,
        duration: duration,
        word: wordText
      });
      text += wordText;
    }
    result.push({
      timeInMs: beginMs,
      duration: lineDuration,
      text: text || body,
      words: words.length > 0 ? words : undefined
    });
  }
  return result;
}

try {
  const decoded = decodeKrc(base64Content);
  console.log('Decoded text first lines:', decoded.split(/\r?\n/).slice(0, 15));
  const parsed = parseKrc(decoded);
  console.log('Parsed lines:', parsed.slice(0, 5));
} catch (e) {
  console.error('Error:', e);
}
