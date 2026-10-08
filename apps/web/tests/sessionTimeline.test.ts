import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionTimeline } from '../src/features/sessions/sessionTimeline';
import type { TestSessionDetail } from '../src/features/test-sessions/types';

const time = '2026-10-03T12:00:00.000Z';
const message = (id: string, position?: number) => ({ id, role: 'assistant' as const, content: id, model: null, createdAt: time, timelinePosition: position });
const event = (id: string, sequence: number, position: number | null) => ({ id, requestId: 'request', title: 'QA', type: 'run_results_submitted', sequence, timelinePosition: position, createdAt: time, metadata: null });
const session = (messages: unknown[], events: unknown[]) => ({ messages, events }) as TestSessionDetail;
describe('one authoritative conversation and QA timeline', () => {
  it('shows results before a later report even with identical timestamps and shuffled input', () => {
    const record = session([message('report', 4), message('question', 1)], [event('review', 3, 3), event('result', 2, 2)]);
    assert.deepEqual(sessionTimeline(record).map(item => item.id), ['message:question', 'event:result', 'event:review', 'message:report']);
    assert.equal(record.messages[0].id, 'report');
  });
  it('never reorders positioned entries based on backwards clocks', () => {
    const first = { ...message('first', 1), createdAt: '2026-10-04T00:00:00.000Z' };
    assert.deepEqual(sessionTimeline(session([message('second', 3), first], [event('historical', 1, null)]))
      .filter(item => item.position != null).map(item => item.id), ['message:first', 'message:second']);
  });
  it('keeps old QA event sequence and stable identity as fallback, without inventing messages', () => {
    const record = session([], [event('z', 1, null), event('a', 2, null)]);
    assert.deepEqual(sessionTimeline(record).map(item => item.id), ['event:z', 'event:a']);
    assert.equal(record.messages.length, 0);
    assert.deepEqual(sessionTimeline(null), []);
  });
});
