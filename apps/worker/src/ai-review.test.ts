import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKERS_AI_MODEL,
  createCloudflareAiReviewProvider,
  enrichResultWithWorkersAi,
} from './ai-review.js';

const task = {
  id: 'reviewLinkPurpose:2.4.4:link-1',
  criterion: '2.4.4' as const,
  rule: {
    title: 'Link Purpose (In Context)',
    level: 'A' as const,
    requirement: 'Link purpose can be determined from context.',
    reviewGoal: 'Review link purpose.',
  },
  evidence: { element: { accessibleName: 'More' } },
  allowedOutcomes: ['no-concern-detected', 'potential-issue', 'needs-human-review'] as const,
  evidenceRefs: ['link-1'],
};

describe('Workers AI review provider', () => {
  it('passes a structured bounded task to the AI binding', async () => {
    const calls: unknown[] = [];
    const provider = createCloudflareAiReviewProvider({
      run(_model, input) {
        calls.push(input);
        return Promise.resolve({
          response: JSON.stringify({
            criterion: '2.4.4',
            outcome: 'potential-issue',
            confidence: 'high',
            summary: 'The link text is ambiguous in the supplied context.',
            evidenceRefs: ['link-1'],
          }),
        });
      },
    });

    const result = await provider.review(task, { model: DEFAULT_WORKERS_AI_MODEL });
    expect(result.outcome).toBe('potential-issue');
    expect(JSON.stringify(calls[0])).toContain('untrustedEvidence');
  });

  it('marks pending AI review unavailable when the binding is missing', async () => {
    const result = await enrichResultWithWorkersAi(
      {
        aiReview: {
          enabled: true,
          datasetRevision: 'rev',
          status: 'pending',
          tasks: [task],
          reviews: [{ task, status: 'pending' }],
        },
      },
      {},
    );
    expect((result.aiReview as { status: string }).status).toBe('unavailable');
  });
});
