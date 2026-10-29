// The streamed Q&A format is:   <plain-text answer>\n###FLAGS###\n{json}
// This splits the stream so the answer text can be forwarded token-by-token while the
// trailing JSON is held back and parsed at the end. It also copes with the marker being
// split across chunks (e.g. "###FL" + "AGS###").
const FLAGS_MARKER = '###FLAGS###';

class FlagSplitter {
  constructor(marker = FLAGS_MARKER) {
    this.marker = marker;
    this.buffer = '';
    this.answer = '';
    this.tail = '';
    this.seenMarker = false;
  }

  // Returns the text that is safe to show the user right now.
  push(chunk) {
    if (this.seenMarker) {
      this.tail += chunk;
      return '';
    }
    this.buffer += chunk;

    const index = this.buffer.indexOf(this.marker);
    if (index !== -1) {
      const out = this.buffer.slice(0, index);
      this.tail = this.buffer.slice(index + this.marker.length);
      this.buffer = '';
      this.seenMarker = true;
      this.answer += out;
      return out;
    }

    // Hold back the longest suffix that could still turn into the marker.
    let hold = 0;
    for (let k = Math.min(this.marker.length - 1, this.buffer.length); k > 0; k--) {
      if (this.marker.startsWith(this.buffer.slice(-k))) {
        hold = k;
        break;
      }
    }
    const out = this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = this.buffer.slice(this.buffer.length - hold);
    this.answer += out;
    return out;
  }

  // Call once the stream ends. Returns any held-back text plus the parsed flags.
  finish() {
    let remaining = '';
    if (!this.seenMarker) {
      remaining = this.buffer;
      this.answer += this.buffer;
      this.buffer = '';
    }

    let flags = { riskFlags: [], insufficientContext: false };
    if (this.seenMarker) {
      const raw = this.tail
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      try {
        const parsed = JSON.parse(raw);
        flags = {
          riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
          insufficientContext: Boolean(parsed.insufficientContext),
        };
      } catch {
        console.warn('Could not parse streamed risk-flag JSON; continuing without flags.');
      }
    }

    return { remaining, answer: this.answer.trim(), ...flags };
  }
}

module.exports = { FlagSplitter, FLAGS_MARKER };
