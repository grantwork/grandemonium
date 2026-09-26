import { claudeSubagentAdapter } from '@/providers/claude/subagentAdapter';

describe('claudeSubagentAdapter', () => {
  it('recognizes Agent as the managed subagent spawn tool', () => {
    expect(claudeSubagentAdapter.isSpawnTool('Agent')).toBe(true);
  });

  it('continues to recognize TaskOutput as the managed subagent output tool', () => {
    expect(claudeSubagentAdapter.isOutputTool('TaskOutput')).toBe(true);
  });
});
