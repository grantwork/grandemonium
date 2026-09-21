import { AGENT_NAME_MAX_LENGTH, resolveAgentName } from '@/core/providers/agentName';

describe('resolveAgentName', () => {
  it('keeps a configured name, trimmed', () => {
    expect(resolveAgentName('  gpt  ', 'codex')).toBe('gpt');
  });

  it('falls back to the provider default when nothing is stored', () => {
    expect(resolveAgentName(undefined, 'claude')).toBe('claude');
  });

  it('falls back when the stored value is not a string', () => {
    expect(resolveAgentName(42, 'claude')).toBe('claude');
  });

  it('falls back when the stored value is only whitespace', () => {
    expect(resolveAgentName('   ', 'claude')).toBe('claude');
  });

  it('collapses internal whitespace so a badge stays on one line', () => {
    expect(resolveAgentName('big\n  brain', 'claude')).toBe('big brain');
  });

  it('strips control characters that would corrupt a comment author field', () => {
    expect(resolveAgentName(`gp${String.fromCharCode(0)}t`, 'codex')).toBe('gpt');
  });

  it('truncates a name longer than the badge allows', () => {
    const long = 'a'.repeat(AGENT_NAME_MAX_LENGTH + 10);
    expect(resolveAgentName(long, 'claude')).toBe('a'.repeat(AGENT_NAME_MAX_LENGTH));
  });
});
