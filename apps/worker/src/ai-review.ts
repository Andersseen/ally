import { buildAiReviewPrompt, runAiReviewTasks, validateAiReviewResult } from '@ally/analyzer-ai';
import type { AiReviewProvider, AiReviewReport } from '@ally/analyzer-ai';
import type { AiBinding } from './bindings.js';

export const DEFAULT_WORKERS_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export interface AiReviewEnv {
  readonly AI?: AiBinding;
  readonly ALLY_AI_MODEL?: string;
  readonly ALLY_AI_TIMEOUT_MS?: string;
}

export async function enrichResultWithWorkersAi(
  result: Record<string, unknown>,
  env: AiReviewEnv,
): Promise<Record<string, unknown>> {
  const report = readPendingReport(result.aiReview);
  if (report === undefined) return result;

  const model = env.ALLY_AI_MODEL?.trim() || DEFAULT_WORKERS_AI_MODEL;
  if (env.AI === undefined) {
    return {
      ...result,
      aiReview: {
        ...report,
        model,
        status: 'unavailable',
        reviews: report.reviews.map((review) => ({
          ...review,
          status: 'skipped',
          error: 'Workers AI binding is not configured.',
        })),
        error: 'Workers AI binding is not configured.',
      },
    };
  }

  const provider = createCloudflareAiReviewProvider(env.AI);
  const timeoutMs = positiveInteger(env.ALLY_AI_TIMEOUT_MS, 30_000);
  const aiReview = await runAiReviewTasks(report.tasks, provider, {
    model,
    timeoutMs,
    providerName: 'cloudflare-workers-ai',
  });
  return { ...result, aiReview };
}

export function createCloudflareAiReviewProvider(ai: AiBinding): AiReviewProvider {
  return {
    async review(task, options) {
      const model = options?.model ?? DEFAULT_WORKERS_AI_MODEL;
      const response = await withTimeout(
        ai.run(model, {
          messages: buildAiReviewPrompt(task),
          temperature: 0,
          max_tokens: 400,
          response_format: { type: 'json_object' },
        }),
        options?.timeoutMs ?? 30_000,
      );
      return validateAiReviewResult(task, parseWorkersAiResponse(response));
    },
  };
}

function readPendingReport(value: unknown): AiReviewReport | undefined {
  if (!isRecord(value)) return undefined;
  if (value.enabled !== true || value.status !== 'pending') return undefined;
  if (!Array.isArray(value.tasks)) return undefined;
  return value as unknown as AiReviewReport;
}

function parseWorkersAiResponse(value: unknown): unknown {
  const text =
    typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.response === 'string'
        ? value.response
        : isRecord(value) && typeof value.result === 'string'
          ? value.result
          : undefined;
  if (text === undefined) return value;
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) return value;
  try {
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    return value;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Workers AI review timed out.')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
