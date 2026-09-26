import { makeAnchor, resolveAnchor } from '@/features/comments/store';

describe('resolveAnchor', () => {
  it('resolves a unique verbatim match', () => {
    const prose = 'For the coming quarter we should cut prices hard in Q3.';
    const r = resolveAnchor(prose, { exact: 'cut prices hard' });
    expect(r).toEqual({ kind: 'resolved', start: 33, end: 48 });
  });

  it('disambiguates multiple matches via prefix/suffix', () => {
    const prose = 'prices down. costs down. risks down.';
    const r = resolveAnchor(prose, { exact: 'down', prefix: 'costs ', suffix: '.' });
    expect(r).toEqual({ kind: 'resolved', start: 19, end: 23 });
  });

  it('falls back to pos-nearest match when context is ambiguous', () => {
    const prose = 'abc abc abc';
    const r = resolveAnchor(prose, { exact: 'abc', pos: 7 });
    expect(r).toEqual({ kind: 'resolved', start: 8, end: 11, ambiguous: true });
  });

  it('picks first match when ambiguous and no pos given', () => {
    const prose = 'abc abc';
    const r = resolveAnchor(prose, { exact: 'abc' });
    expect(r).toEqual({ kind: 'resolved', start: 0, end: 3, ambiguous: true });
  });

  it('returns orphaned when the quote was edited away', () => {
    const prose = 'For the coming quarter we should trim prices selectively in Q3.';
    expect(resolveAnchor(prose, { exact: 'cut prices hard' })).toEqual({ kind: 'orphaned' });
  });

  it('returns orphaned for empty exact', () => {
    expect(resolveAnchor('abc', { exact: '' })).toEqual({ kind: 'orphaned' });
  });

  it('disambiguates via prefix without vacuous matches at document start', () => {
    // Candidates at 0 and 18. The one at 0 has no text before it and must not
    // match the prefix "Again " vacuously: the comparison is strict.
    const prose = 'cut prices. Again cut prices.';
    const r = resolveAnchor(prose, { exact: 'cut prices', prefix: 'Again ' });
    expect(r).toEqual({ kind: 'resolved', start: 18, end: 28 });
  });
});

describe('makeAnchor', () => {
  it('derives exact, context and pos from a selection', () => {
    const prose = 'For the coming quarter we should cut prices hard in Q3.';
    const a = makeAnchor(prose, 33, 48);
    expect(a.exact).toBe('cut prices hard');
    expect(a.prefix).toBe('g quarter we should '); // CONTEXT_LEN=20: prose.slice(13, 33)
    expect(a.pos).toBe(33);
    expect(a.suffix).toBe(' in Q3.');
  });

  it('clamps context at document edges and omits empty context', () => {
    const a = makeAnchor('short', 0, 5);
    expect(a).toEqual({ exact: 'short', pos: 0 });
  });

  it('round-trips: makeAnchor → resolveAnchor finds the same range', () => {
    const prose = 'x abc y abc z abc';
    const a = makeAnchor(prose, 8, 11); // the middle "abc"
    const r = resolveAnchor(prose, a);
    expect(r).toEqual({ kind: 'resolved', start: 8, end: 11 });
  });
});
