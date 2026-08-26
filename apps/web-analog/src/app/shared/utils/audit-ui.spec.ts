import { describe, expect, it } from 'vitest';
import { humanizeStage, isTerminalStatus, pollMessage, stepGroup } from './audit-ui';

describe('audit UI state mapping', () => {
  it('groups backend statuses into visible progress states', () => {
    expect(stepGroup('claimed')).toBe('queued');
    expect(stepGroup('persisting')).toBe('running');
    expect(stepGroup('cancelled')).toBe('failed');
    expect(stepGroup('completed')).toBe('completed');
  });

  it('recognizes terminal statuses', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('timed_out')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
  });

  it('preserves queued and stage messaging', () => {
    expect(pollMessage('queued', 0, null, null)).toBe(
      'Queued. Waiting for a runner to pick it up.',
    );
    expect(pollMessage('queued', 16, null, null)).toContain('Still queued');
    expect(humanizeStage('keyboard:started')).toBe('Running Keyboard analysis...');
  });
});
