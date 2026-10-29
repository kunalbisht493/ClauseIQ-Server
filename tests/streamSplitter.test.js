const { FlagSplitter, FLAGS_MARKER } = require('../services/streamSplitter');

function run(chunks) {
  const splitter = new FlagSplitter();
  let visible = '';
  for (const chunk of chunks) visible += splitter.push(chunk);
  const end = splitter.finish();
  visible += end.remaining;
  return { visible, ...end };
}

describe('FlagSplitter', () => {
  it('streams the answer and parses the trailing JSON', () => {
    const { visible, answer, riskFlags, insufficientContext } = run([
      'The term is ',
      'twelve months.\n',
      `${FLAGS_MARKER}\n`,
      '{"riskFlags":[{"level":"high","clause":"4. Term","reason":"Long","chunkIndex":2}],"insufficientContext":false}',
    ]);
    expect(visible.trim()).toBe('The term is twelve months.');
    expect(answer).toBe('The term is twelve months.');
    expect(riskFlags).toHaveLength(1);
    expect(riskFlags[0].clause).toBe('4. Term');
    expect(insufficientContext).toBe(false);
  });

  it('never leaks the marker even when it is split across chunks', () => {
    const full = `Answer text.\n${FLAGS_MARKER}\n{"riskFlags":[],"insufficientContext":false}`;
    // feed one character at a time: the worst case for marker splitting
    const { visible, answer } = run(full.split(''));
    expect(visible).not.toContain('#');
    expect(visible.trim()).toBe('Answer text.');
    expect(answer).toBe('Answer text.');
  });

  it('does not swallow a lone "#" that is part of the answer', () => {
    const { visible } = run(['Section # 4 applies.', `\n${FLAGS_MARKER}\n{}`]);
    expect(visible).toContain('Section # 4 applies.');
  });

  it('tolerates code fences around the JSON', () => {
    const { riskFlags } = run([`Hi\n${FLAGS_MARKER}\n`, '```json\n{"riskFlags":[{"level":"low"}],"insufficientContext":false}\n```']);
    expect(riskFlags).toHaveLength(1);
  });

  it('treats the whole stream as the answer when the model omits the marker', () => {
    const { visible, answer, riskFlags } = run(['Just an answer, ', 'no flags.']);
    expect(visible).toBe('Just an answer, no flags.');
    expect(answer).toBe('Just an answer, no flags.');
    expect(riskFlags).toEqual([]);
  });

  it('survives malformed flag JSON without failing the answer', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { answer, riskFlags } = run([`Fine answer.\n${FLAGS_MARKER}\n`, '{not json']);
    expect(answer).toBe('Fine answer.');
    expect(riskFlags).toEqual([]);
    warn.mockRestore();
  });

  it('reports insufficientContext with an empty answer', () => {
    const { answer, insufficientContext } = run([`${FLAGS_MARKER}\n{"riskFlags":[],"insufficientContext":true}`]);
    expect(answer).toBe('');
    expect(insufficientContext).toBe(true);
  });
});
