// Modified by OtterHelm for this custom distribution; see deploy/local/README.md.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import type { AnalysisUsage } from "./types.js";
export type { AnalysisUsage } from "./types.js";

export function analysisCost(usage: AnalysisUsage): number | null {
  const rates = usage.model === "deepseek-flash" || usage.model.startsWith("deepseek-v4.1-flash") ? [0.003, 0.15, 0.6]
    : usage.model.startsWith("deepseek-v4-flash") ? [0.007, 0.22, 0.66]
    : usage.model.startsWith("deepseek-v4-pro") ? [0.022, 0.66, 1.98] : null;
  const time = new Date(usage.timestamp);
  if (!rates || !Number.isFinite(time.getTime())) return null;
  const hour = time.getUTCHours();
  const peak = time.getUTCDay() >= 1 && time.getUTCDay() <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  const hits = Math.max(0, Math.min(usage.inputTokens, usage.cacheHitTokens));
  return (hits * rates[0] + (usage.inputTokens - hits) * rates[1] + usage.outputTokens * rates[2]) * (peak ? 2 : 1) / 1_000_000;
}

export const analysisUsageContext = new AsyncLocalStorage<{
  sessionId: string;
  phase: "summary" | "graph";
  operation?: "delta" | "rollup";
  record: (usage: AnalysisUsage) => Promise<unknown>;
}>();

export async function recordAnalysisUsage(data: {
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
  choices?: Array<{ finish_reason?: string }>;
}): Promise<void> {
  const context = analysisUsageContext.getStore();
  if (!context) return;
  const timestamp = new Date().toISOString();
  try {
    await context.record({
      id: randomUUID(), sessionId: context.sessionId, phase: context.phase,
      ...(context.operation ? { operation: context.operation } : {}),
      timestamp, model: data.model ?? "unknown",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cacheHitTokens: data.usage?.prompt_cache_hit_tokens ?? 0,
      finishReason: data.choices?.[0]?.finish_reason ?? "unknown",
    });
  } catch {
    logger.warn("Analysis token accounting unavailable; response will not be retried for accounting alone");
  }
}
