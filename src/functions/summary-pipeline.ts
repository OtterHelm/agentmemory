// Modified for the custom Agentmemory distribution: staged session summaries.
import type { Session, SessionSummary, SummaryPipeline, SummaryChunk, CompressedObservation } from "../types.js";
import type { StateKV } from "../state/kv.js";
import { KV } from "../state/schema.js";
import { getEnvVar } from "../config.js";
import { SearchIndex } from "../state/search-index.js";

export const twoStageEnabled = () => getEnvVar("AGENTMEMORY_TWO_STAGE_SUMMARY") === "true";
export const ROLLUP_AGE_MS = 60 * 60_000;
export const ROLLUP_CHUNKS = 4;
export const MAX_PENDING_CHUNKS = 8;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function composeSummary(p: SummaryPipeline): SessionSummary | null {
  if (!p.chunks.length) return p.base;
  const latest = p.chunks.at(-1)!.summary;
  const all = [...(p.base ? [p.base] : []), ...p.chunks.map(c => c.summary)];
  return {
    ...latest,
    narrative: [p.base ? `Earlier integrated summary:\n${p.base.narrative}` : "",
      ...p.chunks.map((c, i) => `Later update ${i + 1} (${c.summary.createdAt}):\n${c.summary.narrative}`)].filter(Boolean).join("\n\n"),
    keyDecisions: [...new Set(all.flatMap(s => s.keyDecisions))],
    filesModified: [...new Set(all.flatMap(s => s.filesModified))],
    concepts: [...new Set(all.flatMap(s => s.concepts))],
    observationCount: all.reduce((n, s) => n + s.observationCount, 0),
  };
}

export async function loadPipeline(kv: StateKV, sessionId: string): Promise<SummaryPipeline> {
  const p = await kv.get<SummaryPipeline>(KV.summaryPipelines, sessionId);
  if (p) return p;
  const base = await kv.get<SessionSummary>(KV.summaries, sessionId);
  return { sessionId, base, chunks: [], projection: base, attempts: 0 };
}

export async function syncProjection(kv: StateKV, p: SummaryPipeline): Promise<boolean> {
  if (!(await kv.get(KV.sessions, p.sessionId))) return false;
  const current = await kv.get<SessionSummary>(KV.summaries, p.sessionId);
  if (!same(current, p.projection) && !(p.pendingProjection && same(current, p.pendingProjection))) {
    p.error = "summary_projection_conflict";
    await kv.set(KV.summaryPipelines, p.sessionId, p);
    return false;
  }
  if (p.pendingProjection) {
    await kv.set(KV.summaries, p.sessionId, p.pendingProjection);
    p.projection = p.pendingProjection;
    delete p.pendingProjection;
    await kv.set(KV.summaryPipelines, p.sessionId, p);
  }
  return p.error !== "summary_projection_conflict";
}

export async function publishPipeline(kv: StateKV, p: SummaryPipeline): Promise<void> {
  const projection = composeSummary(p);
  if (!projection) return;
  p.pendingProjection = projection;
  await kv.set(KV.summaryPipelines, p.sessionId, p);
  if (!(await syncProjection(kv, p))) throw new Error("summary_projection_conflict");
}

export async function appendChunk(kv: StateKV, sessionId: string, chunk: SummaryChunk): Promise<void> {
  const p = await loadPipeline(kv, sessionId);
  if (!(await syncProjection(kv, p))) throw new Error("summary_projection_conflict");
  if (p.chunks.some(c => c.id === chunk.id)) return;
  p.chunks.push(chunk);
  await publishPipeline(kv, p);
}

export function rollupDue(p: SummaryPipeline, now: number): boolean {
  if (p.error === "summary_projection_conflict" || p.attempts >= 3 || (p.retryAt ?? 0) > now) return false;
  return !!p.prepared || !!p.pendingProjection || p.chunks.length >= ROLLUP_CHUNKS ||
    (p.chunks.length > 0 && now - p.chunks[0].createdAt >= ROLLUP_AGE_MS);
}

export async function pendingSummaryObservations(kv: StateKV, project?: string, agentId?: string, cwd?: string): Promise<CompressedObservation[]> {
  if (!twoStageEnabled()) return [];
  const sessions = (await kv.list<Session>(KV.sessions)).filter(s =>
    (!project || s.project === project) && (agentId === undefined || s.agentId === agentId) && (!cwd || s.cwd === cwd));
  const observations: CompressedObservation[] = [];
  for (const s of sessions) {
    const p = await kv.get<SummaryPipeline>(KV.summaryPipelines, s.id);
    if (!p || p.error === "summary_projection_conflict") continue;
    const current = await kv.get<SessionSummary>(KV.summaries, s.id);
    if (!same(current, p.projection)) continue;
    for (const c of p.chunks) observations.push({
      id: c.id, sessionId: s.id, timestamp: c.summary.createdAt, type: "other",
      title: `[Pending summary update] ${c.summary.title}`, narrative: c.summary.narrative,
      facts: c.summary.keyDecisions, files: c.summary.filesModified, concepts: c.summary.concepts,
      importance: 7, agentId: s.agentId,
    });
  }
  return observations;
}

export async function searchSummaryUpdates(kv: StateKV, query: string, limit: number, project?: string, agentId?: string, cwd?: string) {
  const observations = await pendingSummaryObservations(kv, project, agentId, cwd);
  const index = new SearchIndex();
  for (const obs of observations) index.add(obs);
  return index.search(query, Math.min(limit, 3)).map(r => ({ ...r, observation: observations.find(o => o.id === r.obsId)! }));
}

export async function contextSummaryParts(kv: StateKV, current: SessionSummary): Promise<SessionSummary[]> {
  if (!twoStageEnabled()) return [current];
  const p = await kv.get<SummaryPipeline>(KV.summaryPipelines, current.sessionId);
  if (!p || !same(current, p.projection) || !p.chunks.length) return [current];
  return [...(p.base ? [p.base] : []), ...p.chunks.map(c => ({ ...c.summary, title: `[Later update] ${c.summary.title}` }))];
}
