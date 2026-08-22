import { describe, expect, test } from 'vitest';
import type { AuditStatus, AuditTransitionEvent } from './audit-state.js';
import { isTerminalStatus, nextState } from './audit-state.js';

const ALL_STATUSES: readonly AuditStatus[] = [
  'queued',
  'claimed',
  'running',
  'persisting',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
];

const VALID: readonly [AuditStatus, AuditTransitionEvent, AuditStatus][] = [
  ['queued', 'claim', 'claimed'],
  ['claimed', 'claim', 'claimed'], // re-claim on redelivery
  ['running', 'claim', 'claimed'], // re-claim after a stranded lease
  ['claimed', 'start', 'running'],
  ['running', 'persist', 'persisting'],
  ['persisting', 'complete', 'completed'],
  ['claimed', 'fail', 'failed'],
  ['running', 'fail', 'failed'],
  ['persisting', 'fail', 'failed'],
  ['claimed', 'timeout', 'timed_out'],
  ['running', 'timeout', 'timed_out'],
  ['persisting', 'timeout', 'timed_out'],
  ['queued', 'cancel', 'cancelled'],
  ['claimed', 'cancel', 'cancelled'],
  ['running', 'cancel', 'cancelled'],
];

describe('nextState', () => {
  test.each(VALID)('%s --%s--> %s', (from, event, expected) => {
    expect(nextState(from, event)).toBe(expected);
  });

  test('rejects every transition not explicitly listed as valid', () => {
    const allowed = new Set(VALID.map(([from, event]) => `${from}:${event}`));
    const events: readonly AuditTransitionEvent[] = [
      'claim',
      'start',
      'persist',
      'complete',
      'fail',
      'timeout',
      'cancel',
    ];

    for (const status of ALL_STATUSES) {
      for (const event of events) {
        if (allowed.has(`${status}:${event}`)) continue;
        expect(nextState(status, event), `${status} --${event}--> ?`).toBeNull();
      }
    }
  });

  test('never allows a transition out of a terminal state', () => {
    const events: readonly AuditTransitionEvent[] = [
      'claim',
      'start',
      'persist',
      'complete',
      'fail',
      'timeout',
      'cancel',
    ];

    for (const status of ALL_STATUSES) {
      if (!isTerminalStatus(status)) continue;
      for (const event of events) {
        expect(nextState(status, event)).toBeNull();
      }
    }
  });
});

describe('isTerminalStatus', () => {
  test.each([
    ['completed', true],
    ['failed', true],
    ['timed_out', true],
    ['cancelled', true],
    ['queued', false],
    ['claimed', false],
    ['running', false],
    ['persisting', false],
  ] as const)('%s -> terminal=%s', (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});
