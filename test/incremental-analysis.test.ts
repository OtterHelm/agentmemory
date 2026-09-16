// Modified by OtterHelm for this custom distribution; see deploy/local/README.ko.md.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncrementalAnalyzer, observationDigest, parseIncrementalGraph, parseIncrementalSummary, analysisFailureCode, analysisStatus } from "../src/functions/incremental-analysis.js";
import { KV } from "../src/state/schema.js";
import { recordAnalysisUsage } from "../src/analysis-usage.js";
import { pendingSummaryObservations, searchSummaryUpdates } from "../src/functions/summary-pipeline.js";
import { registerContextFunction } from "../src/functions/context.js";
import { registerSmartSearchFunction } from "../src/functions/smart-search.js";
import { registerSearchFunction, getSearchIndex } from "../src/functions/search.js";
import type { StateKV } from "../src/state/kv.js";
import type { CompressedObservation, IncrementalAnalysisState } from "../src/types.js";

const MINUTES = 15 * 60_000;
const SUMMARY = '<summary><title>Updated memory pipeline</title><narrative>Keep records. Analyze deltas with Flash.</narrative><decisions><decision>Preserve memory data.</decision></decisions><files><file>src/pipeline.ts</file></files><concepts><concept>memory</concept></concepts></summary>';
const GRAPH = '<entities><entity type="file" name="src/pipeline.ts"></entity><entity type="concept" name="memory"></entity></entities><relationships><relationship type="uses" source="src/pipeline.ts" target="memory" weight="0.8"/></relationships>';

function harness() {
  const store = new Map<string, Map<string, unknown>>();
  const kv = {
    get: async (scope: string, key: string) => structuredClone(store.get(scope)?.get(key) ?? null),
    set: async (scope: string, key: string, value: unknown) => { if (!store.has(scope)) store.set(scope, new Map()); store.get(scope)!.set(key, structuredClone(value)); return value; },
    list: async (scope: string) => structuredClone([...store.get(scope)?.values() ?? []]),
    delete: async (scope: string, key: string) => { store.get(scope)?.delete(key); },
  } as unknown as StateKV;
  let now = Date.parse('2026-09-05T00:00:00Z');
  const provider = { name: 'test', summarize: vi.fn().mockResolvedValue(SUMMARY), compress: vi.fn().mockResolvedValue(GRAPH) };
  const make = () => new IncrementalAnalyzer(kv, provider, () => now);
  const add = async (id: string, narrative = 'Changed the pipeline.', sid = 's1') => {
    const obs: CompressedObservation = { id, sessionId: sid, timestamp: new Date(now).toISOString(), title: id, narrative, type: 'file_edit', facts: ['Kept records'], concepts: ['memory'], files: ['src/pipeline.ts'], importance: 5 };
    await kv.set(KV.observations(sid), id, obs); return obs;
  };
  const session = async (id = 's1') => kv.set(KV.sessions, id, { id, project: 'test', startedAt: new Date(now).toISOString(), status: 'active', observationCount: 0 });
  return { kv, provider, make, add, session, advance: (ms = MINUTES) => { now += ms; } };
}

beforeEach(() => { vi.stubEnv('GRAPH_EXTRACTION_ENABLED', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('two-stage summaries', () => {
  beforeEach(()=>{vi.stubEnv('AGENTMEMORY_TWO_STAGE_SUMMARY','true');vi.stubEnv('GRAPH_EXTRACTION_ENABLED','false');});
  it('exposes pending summaries through context, recall and smart-search expansion',async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');await a.enqueue('s1');h.advance();await a.tick();
    const handlers=new Map<string,any>();
    const sdk={registerFunction:(id:string,fn:any)=>handlers.set(id,fn),trigger:async()=>({success:true,lessons:[]})} as any;
    registerContextFunction(sdk,h.kv,1000);registerSearchFunction(sdk,h.kv);
    registerSmartSearchFunction(sdk,h.kv,async()=>[]);getSearchIndex().clear();
    const context=await handlers.get('mem::context')({sessionId:'other',project:'test'});
    expect(context.context).toContain('[Later update]');expect(context.context).toContain('Keep records');
    const recall=await handlers.get('mem::search')({query:'Updated',project:'test'});
    expect(recall.results[0].observation.title).toContain('[Pending summary update]');
    const compact=await handlers.get('mem::smart-search')({query:'Updated',project:'test'});
    expect(compact.results).toHaveLength(1);
    const expanded=await handlers.get('mem::smart-search')({expandIds:[compact.results[0].obsId]});
    expect(expanded.results[0].observation.narrative).toContain('Keep records');
    const isolated=await handlers.get('mem::smart-search')({expandIds:[compact.results[0].obsId],agentId:'other-agent'});
    expect(isolated.results).toHaveLength(0);
    await h.kv.delete(KV.sessions,'s1');expect(await pendingSummaryObservations(h.kv)).toHaveLength(0);
  });
  it('publishes searchable deltas immediately and rolls up after four batches', async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();
    for(let i=0;i<4;i++){
      await h.add('o'+i);await a.enqueue('s1');h.advance();await a.tick();
      if(i===0){
        const summary=await h.kv.get<any>(KV.summaries,'s1');
        expect(summary.narrative).toContain('Later update 1');
        expect(await searchSummaryUpdates(h.kv,'memory',3,'test')).toHaveLength(1);
        expect(await searchSummaryUpdates(h.kv,'memory',3,'other')).toHaveLength(0);
        expect(await searchSummaryUpdates(h.kv,'memory',3,undefined,'other-agent')).toHaveLength(0);
      }
    }
    expect(h.provider.summarize).toHaveBeenCalledTimes(5);
    for(const index of [0,1,2,3]) expect(h.provider.summarize.mock.calls[index][1]).toContain('Prior summary:\nNone');
    const pipeline=await h.kv.get<any>(KV.summaryPipelines,'s1');
    expect(pipeline.chunks).toHaveLength(0);expect(pipeline.base.observationCount).toBe(4);
    expect(await pendingSummaryObservations(h.kv)).toHaveLength(0);
    h.advance(24*60*60000);await a.tick();expect(h.provider.summarize).toHaveBeenCalledTimes(5);
  });
  it('flushes one pending chunk after one hour across a restart without new observations',async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');await a.enqueue('s1');h.advance();await a.tick();
    const restarted=h.make();await restarted.initialize();h.advance(59*60000);await restarted.tick();
    expect(h.provider.summarize).toHaveBeenCalledTimes(1);
    h.advance(60000);await restarted.tick();expect(h.provider.summarize).toHaveBeenCalledTimes(2);
    expect((await h.kv.get<any>(KV.summaryPipelines,'s1')).chunks).toHaveLength(0);
  });
  it('repairs a failed rollup projection without paying for the result twice',async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');await a.enqueue('s1');h.advance();await a.tick();
    const set=h.kv.set.bind(h.kv);let fail=true;
    h.kv.set=(async(scope,key,value)=>{if(scope===KV.summaries&&fail){fail=false;throw new Error('disk')};return set(scope,key,value)}) as StateKV['set'];
    h.advance(60*60000);await a.tick();expect(h.provider.summarize).toHaveBeenCalledTimes(2);
    h.advance();await h.make().tick();expect(h.provider.summarize).toHaveBeenCalledTimes(2);
    expect((await h.kv.get<any>(KV.summaryPipelines,'s1')).pendingProjection).toBeUndefined();
    expect((await h.kv.get<any>(KV.summaries,'s1')).observationCount).toBe(1);
  });
  it('pauses on manual summary replacement and does not expose stale pending chunks',async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');await a.enqueue('s1');h.advance();await a.tick();
    const manual={title:'Manual',narrative:'Keep manual data'};await h.kv.set(KV.summaries,'s1',manual);
    await h.add('o2');await a.enqueue('s1');h.advance(60*60000);await a.tick();
    expect(h.provider.summarize).toHaveBeenCalledTimes(1);
    expect(await h.kv.get(KV.summaries,'s1')).toEqual(manual);
    expect(await pendingSummaryObservations(h.kv)).toHaveLength(0);
  });
  it('caps failed rollup attempts while retaining chunks and raw observations',async()=>{
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');await a.enqueue('s1');h.advance();await a.tick();
    h.provider.summarize.mockResolvedValue('<title>Missing narrative</title>');
    h.advance(60*60000);for(let i=0;i<5;i++){await a.tick();h.advance();}
    expect(h.provider.summarize).toHaveBeenCalledTimes(4);
    expect((await h.kv.get<any>(KV.summaryPipelines,'s1')).chunks).toHaveLength(1);
    expect(await h.kv.list(KV.observations('s1'))).toHaveLength(1);
  });
});

describe('incremental analysis safety', () => {
  it('records only a diagnostic code for rejected paid responses', async () => {
    vi.stubEnv('GRAPH_EXTRACTION_ENABLED','false');
    const h=harness();const a=h.make();await a.initialize();await h.session();await h.add('o1');
    h.provider.summarize.mockImplementationOnce(async()=>{
      await recordAnalysisUsage({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop'}]});
      return '<title>PRIVATE_RESPONSE</title><narrative>Short</narrative>';
    });
    await a.enqueue('s1');h.advance();await a.tick();
    const usage=await h.kv.list(KV.analysisUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({failureCode:'invalid_summary_output:short_narrative',outcome:'invalid'});
    expect(JSON.stringify(usage)).not.toContain('PRIVATE_RESPONSE');
    expect((await analysisStatus(h.kv)).failureCounts).toEqual({'invalid_summary_output:short_narrative':1});
  });
  it('classifies invalid summaries without exposing provider text', () => {
    const session={id:'s',project:'test'} as any;
    for(const [xml,code] of [
      ['private response with no tags','missing_title'],
      ['<title>Title</title>','missing_narrative'],
      ['<title>Title</title><narrative>Short</narrative>','short_narrative'],
    ]) {
      expect(()=>parseIncrementalSummary(xml,session,1)).toThrow('invalid_summary_output:'+code);
    }
    expect(parseIncrementalSummary(SUMMARY,session,1).narrative).toContain('Keep records');
    expect(analysisFailureCode(new Error('OpenAI API error (429): private request text'))).toBe('provider_http_429');
    expect(analysisFailureCode(new Error('private text'))).toBe('analysis_failed');
  });
  it('isolates format failures without shrinking subsequent healthy batches', async () => {
    vi.stubEnv('GRAPH_EXTRACTION_ENABLED','false');
    const h=harness(); const a=h.make(); await a.initialize(); await h.session();
    for(let i=0;i<4;i++) await h.add('old'+i);
    h.provider.summarize.mockResolvedValueOnce('<title>Title</title>');
    await a.enqueue('s1'); h.advance(); await a.tick();
    let state=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(state.summary.error).toBe('invalid_summary_output:missing_narrative');
    expect(state.summary.batchLimit).toBeUndefined();
    expect(state.summary.isolation?.limit).toBe(2);
    for(let i=0;i<10;i++) await h.add('new'+i);
    for(let i=0;i<3;i++){h.advance();await h.make().tick();}
    state=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(Object.keys(state.summary.done)).toHaveLength(14);
    expect(state.summary.isolation).toBeUndefined();
    expect(h.provider.summarize).toHaveBeenCalledTimes(4);
  });
  it('recovers legacy one-record limits across restarts without resetting held or completed work', async () => {
    vi.stubEnv('GRAPH_EXTRACTION_ENABLED','false');
    const h=harness();const a=h.make();await a.initialize();await h.session();
    for(let i=0;i<100;i++) await h.add('o'+String(i).padStart(3,'0'));
    const held=await h.add('held');await a.enqueue('s1');
    const state=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    state.summary.batchLimit=1;
    state.summary.held={held:{digest:observationDigest(held),error:'invalid_summary_output'}};
    state.summary.done.previouslyCompleted='unchanged';
    await h.kv.set(KV.analysisState,'s1',state);
    for(let i=0;i<20;i++){h.advance();const restarted=h.make();await restarted.initialize();await restarted.tick();}
    const result=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(h.provider.summarize).toHaveBeenCalledTimes(16);
    expect(result.summary.batchLimit).toBe(32);
    expect(Object.keys(result.summary.done)).toHaveLength(101);
    expect(result.summary.done.previouslyCompleted).toBe('unchanged');
    expect(result.summary.held).toEqual(state.summary.held);
    expect(await h.kv.list(KV.observations('s1'))).toHaveLength(101);
  });
  it('resets recovery streak on errors and never grows beyond phase caps', async () => {
    const h=harness();const a=h.make();await a.initialize();await h.session();
    for(let i=0;i<130;i++) await h.add('o'+String(i).padStart(3,'0'));
    await a.enqueue('s1');
    const state=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    state.summary.batchLimit=32;state.summary.successStreak=2;
    state.graph.batchLimit=4;state.graph.successStreak=2;
    await h.kv.set(KV.analysisState,'s1',state);h.advance();await a.tick();
    let result=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(result.summary.batchLimit).toBe(40);expect(result.graph.batchLimit).toBe(5);
    h.provider.summarize.mockRejectedValueOnce(new Error('offline private input'));
    h.advance();await a.tick();result=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(result.summary.successStreak).toBe(0);
    expect(result.summary.error).toBe('analysis_failed');
  });
  it('shortens an existing 30-minute deadline once without changing completed work', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); await h.add('o1'); await a.enqueue('s1');
    const s=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    delete s.scheduledIntervalMs; s.nextAt! += MINUTES;
    await h.kv.set(KV.analysisState,'s1',s); h.advance(5*60_000);
    await h.make().initialize(); const migrated=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(migrated.nextAt).toBe(s.nextAt!-MINUTES); expect(migrated.scheduledIntervalMs).toBe(MINUTES);
    expect(migrated.summary).toEqual(s.summary); expect(migrated.graph).toEqual(s.graph);
    await h.make().initialize(); expect((await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!.nextAt).toBe(migrated.nextAt);
    h.advance(9*60_000); await a.tick(); expect(h.provider.summarize).not.toHaveBeenCalled();
    h.advance(60_000); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
    expect((await analysisStatus(h.kv)).intervalMinutes).toBe(15);
  });
  it('accepts paired relationship tags without silently dropping edges', () => {
    const paired=GRAPH.replace('weight="0.8"/>','weight="0.8"></relationship>');
    expect(parseIncrementalGraph(paired,['o1']).edges).toHaveLength(1);
    expect(() => parseIncrementalGraph(GRAPH.replace('name="memory"',''),['o1'])).toThrow('invalid_graph_output');
    expect(() => parseIncrementalGraph(GRAPH.replace('target="memory"','target="missing"'),['o1'])).toThrow('invalid_graph_output');
    expect(parseIncrementalGraph('<entities/><relationships/>',['o1'])).toEqual({nodes:[],edges:[]});
  });
  it('preserves legacy data without automatic backfill', async () => {
    const h = harness(); await h.session(); const obs = await h.add('legacy');
    const a = h.make(); await a.initialize(); expect(await a.enqueue('s1')).toEqual({ queued: false });
    h.advance(); await a.tick(); expect(h.provider.summarize).not.toHaveBeenCalled();
    expect(await h.kv.get(KV.observations('s1'), 'legacy')).toEqual(obs);
    const state = await h.kv.get<IncrementalAnalysisState>(KV.analysisState, 's1'); expect(state!.legacy.legacy).toBe(observationDigest(obs));
  });
  it('coalesces repeated stops without postponing the deadline', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    await a.enqueue('s1'); h.advance(60_000); await a.enqueue('s1'); await a.tick(); expect(h.provider.summarize).not.toHaveBeenCalled();
    h.advance(MINUTES - 60_000); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1); expect(h.provider.compress).toHaveBeenCalledTimes(1);
    await a.enqueue('s1'); h.advance(); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
  });
  it('sends only new records and archives the previous summary', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1', 'UNIQUE_OLD_RECORD');
    await a.enqueue('s1'); h.advance(); await a.tick(); await h.add('o2', 'UNIQUE_NEW_RECORD'); await a.enqueue('s1'); h.advance(); await a.tick();
    const prompt = h.provider.summarize.mock.calls[1][1]; expect(prompt).toContain('UNIQUE_NEW_RECORD'); expect(prompt).not.toContain('UNIQUE_OLD_RECORD');
    expect(prompt).toContain('Preserve memory data'); expect(await h.kv.list(KV.analysisHistory)).toHaveLength(1);
    expect(await h.kv.list(KV.observations('s1'))).toHaveLength(2);
  });
  it('recovers pending work after restart and no further prompts', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1'); await a.enqueue('s1');
    h.advance(); const b = h.make(); await b.initialize(); await b.tick(); expect(h.provider.compress).toHaveBeenCalledTimes(1);
  });
  it('keeps summary progress when graph LLM returns invalid XML', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1'); await h.add('o2'); h.provider.compress.mockResolvedValueOnce('invalid');
    await a.enqueue('s1'); h.advance(); await a.tick(); let s = await h.kv.get<IncrementalAnalysisState>(KV.analysisState, 's1');
    expect(s!.summary.done.o1).toBeTruthy(); expect(s!.graph.done.o1).toBeUndefined();
    h.advance(); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1); expect(h.provider.compress).toHaveBeenCalledTimes(2);
  });
  it('does not run concurrently in one worker', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1'); await a.enqueue('s1'); h.advance();
    await Promise.all([a.tick(), a.tick(), a.tick()]); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
  });
  it('leaves records arriving during analysis for the next batch', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockImplementationOnce(async () => { await h.add('o2'); return SUMMARY; });
    await a.enqueue('s1'); h.advance(); await a.tick(); const s = await h.kv.get<IncrementalAnalysisState>(KV.analysisState, 's1');
    expect(s!.summary.done.o2).toBeUndefined(); expect(s!.graph.done.o2).toBeUndefined(); expect(s!.nextAt).not.toBeNull(); h.advance(); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect an observation deleted during the LLM call', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockImplementationOnce(async () => { await h.kv.delete(KV.observations('s1'), 'o1'); return SUMMARY; });
    await a.enqueue('s1'); h.advance(); await a.tick(); expect(await h.kv.get(KV.summaries, 's1')).toBeNull();
  });
  it('blocks repeated failures without discarding pending records', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockRejectedValue(new Error('offline')); h.provider.compress.mockRejectedValue(new Error('offline'));
    await a.enqueue('s1'); for (let i = 0; i < 5; i++) { h.advance(); await a.tick(); }
    expect(h.provider.summarize).toHaveBeenCalledTimes(3); const s = await h.kv.get<IncrementalAnalysisState>(KV.analysisState, 's1');
    expect(s!.blocked).toBe(true); expect(s!.summary.done.o1).toBeUndefined(); expect(await h.kv.get(KV.observations('s1'), 'o1')).not.toBeNull();
  });
  it('reuses a prepared result if summary persistence fails', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1'); const set = h.kv.set.bind(h.kv);
    let fail = true; h.kv.set = (async (scope, key, value) => { if (scope === KV.summaries && fail) { fail = false; throw new Error('disk error'); } return set(scope, key, value); }) as StateKV['set'];
    await a.enqueue('s1'); h.advance(); await a.tick(); h.advance(); await h.make().tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1); expect(await h.kv.get(KV.summaries, 's1')).not.toBeNull();
  });
  it('bounds batches and preserves an oversized record for review', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('huge', 'x'.repeat(25_000));
    await a.enqueue('s1'); h.advance(); await a.tick(); expect(h.provider.summarize).not.toHaveBeenCalled();
    expect((await h.kv.get<IncrementalAnalysisState>(KV.analysisState, 's1'))!.blocked).toBe(true);
  });
  it('processes changed observations without relying on timestamp cursors', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1'); await a.enqueue('s1'); h.advance(); await a.tick();
    await h.add('o1', 'Corrected narrative'); await a.enqueue('s1'); h.advance(); await a.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(2);
  });
  it('recovers a persisted observation whose enqueue event was lost', async () => {
    const h = harness(); await h.make().initialize(); await h.session(); await h.add('o1');
    const restarted = h.make(); await restarted.initialize();
    expect((await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!.nextAt).not.toBeNull();
    h.advance(); await restarted.tick(); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
  });
  it('commits a prepared third-attempt response after a storage failure without another API call', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    const set = h.kv.set.bind(h.kv); let fail = true;
    h.kv.set = (async (scope,key,value) => { if (scope === KV.summaries && fail) {fail=false; throw new Error('disk error');} return set(scope,key,value); }) as StateKV['set'];
    await a.enqueue('s1'); for (let i=0;i<4;i++) { h.advance(); await h.make().tick(); }
    expect(h.provider.summarize).toHaveBeenCalledTimes(3); expect(await h.kv.get(KV.summaries,'s1')).not.toBeNull();
  });
  it('does not overwrite a manually updated summary while analysis is in flight', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockImplementationOnce(async () => {await h.kv.set(KV.summaries,'s1',{title:'Manual change',narrative:'Keep this manual update'}); return SUMMARY;});
    await a.enqueue('s1'); h.advance(); await a.tick();
    expect(await h.kv.get(KV.summaries,'s1')).toEqual({title:'Manual change',narrative:'Keep this manual update'});
  });
  it('does not recreate a session summary after its session was deleted', async () => {
    const h = harness(); const a = h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.summarize.mockImplementationOnce(async () => {await h.kv.delete(KV.sessions,'s1'); return SUMMARY;});
    await a.enqueue('s1'); h.advance(); await a.tick(); expect(await h.kv.get(KV.summaries,'s1')).toBeNull();
  });

  it('caps graph batches at five and preserves the remaining records', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session();
    for(let i=0;i<12;i++) await h.add('o'+i);
    await a.enqueue('s1'); h.advance(); await a.tick();
    const s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(Object.keys(s!.summary.done)).toHaveLength(12); expect(Object.keys(s!.graph.done)).toHaveLength(5);
    expect(s!.nextAt).not.toBeNull(); expect(await h.kv.list(KV.observations('s1'))).toHaveLength(12);
  });

  it('splits a truncated graph batch durably instead of repeating it', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session();
    for(let i=0;i<5;i++) await h.add('o'+i);
    h.provider.compress.mockRejectedValueOnce(new Error('Analysis output truncated; preserving pending observations'));
    await a.enqueue('s1'); h.advance(); await a.tick();
    let s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(s!.graph.batchLimit).toBe(2); expect(s!.graph.batch).toBeUndefined();
    const restarted=h.make(); await restarted.initialize(); h.advance(); await restarted.tick();
    s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(Object.keys(s!.graph.done)).toHaveLength(2); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
  });

  it('holds a single bad graph record but continues summaries and later graph records', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); await h.add('bad');
    h.provider.compress.mockRejectedValueOnce(new Error('Analysis output truncated'));
    await a.enqueue('s1'); h.advance(); await a.tick();
    let s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(s!.graph.held!.bad).toBeTruthy(); expect(s!.blocked).toBe(true);
    await h.add('good'); await a.enqueue('s1'); h.advance(); await a.tick();
    s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(s!.summary.done.good).toBeTruthy(); expect(s!.graph.done.good).toBeTruthy();
    expect(s!.graph.done.bad).toBeUndefined(); expect(h.provider.compress).toHaveBeenCalledTimes(2);
  });

  it('skips oversized records without starving smaller ones', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session();
    const huge=await h.add('a-huge','x'.repeat(25_000)); await h.add('b-small');
    await a.enqueue('s1'); h.advance(); await a.tick();
    const s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(s!.graph.held!['a-huge']).toBeTruthy(); expect(s!.graph.done['b-small']).toBeTruthy();
    expect(s!.summary.done['b-small']).toBeTruthy(); expect(await h.kv.get(KV.observations('s1'),'a-huge')).toEqual(huge);
  });

  it('reconsiders an explicitly corrected held observation', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); await h.add('o1');
    h.provider.compress.mockRejectedValueOnce(new Error('Analysis output truncated'));
    await a.enqueue('s1'); h.advance(); await a.tick(); await h.add('o1','Corrected smaller input');
    await a.enqueue('s1'); h.advance(); await a.tick();
    const s=await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1');
    expect(s!.graph.held!.o1).toBeUndefined(); expect(s!.graph.done.o1).toBeTruthy();
  });

  it('upgrades legacy truncation once without resetting completed fingerprints or backfilling history', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); const obs=await h.add('o1');
    await a.enqueue('s1'); const s=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    delete s.stabilizationVersion; s.summary.done.o1=observationDigest(obs); s.graph.attempts=3;
    s.graph.error='Analysis output truncated'; s.graph.batch={id:'old',observations:[obs]}; s.blocked=true; s.nextAt=null;
    await h.kv.set(KV.analysisState,'s1',s); await h.make().initialize();
    let migrated=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(migrated.stabilizationVersion).toBe(2); expect(migrated.graph.attempts).toBe(0); expect(migrated.summary.done).toEqual(s.summary.done);
    h.provider.compress.mockRejectedValueOnce(new Error('Analysis output truncated'));
    h.advance(); await h.make().tick(); await h.make().initialize(); h.advance(); await h.make().tick();
    expect(h.provider.compress).toHaveBeenCalledTimes(1); expect(h.provider.summarize).not.toHaveBeenCalled();
    migrated=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(migrated.graph.held!.o1).toBeTruthy();
  });
  it('never recovers a legacy failure earlier than 15 minutes after its last attempt', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); const obs=await h.add('o1');
    await a.enqueue('s1'); const s=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    delete s.stabilizationVersion; s.lastStartedAt=Date.parse('2026-09-05T00:00:00Z');
    s.graph.error='Analysis output truncated'; s.graph.attempts=3; s.graph.batch={id:'old',observations:[obs]}; s.blocked=true; s.nextAt=null;
    await h.kv.set(KV.analysisState,'s1',s); const restarted=h.make(); await restarted.initialize(); await restarted.tick();
    expect(h.provider.compress).not.toHaveBeenCalled(); h.advance(); await restarted.tick(); expect(h.provider.compress).toHaveBeenCalledTimes(1);
  });

  it('does not hot-loop or discard a prepared result after repeated storage failure', async () => {
    const h=harness(); const a=h.make(); await a.initialize(); await h.session(); await h.add('o1');
    const set=h.kv.set.bind(h.kv);
    h.kv.set=(async(scope,key,value)=>{if(scope===KV.summaries) throw new Error('disk'); return set(scope,key,value);}) as StateKV['set'];
    await a.enqueue('s1'); for(let i=0;i<5;i++){h.advance(); await a.tick();}
    const s=(await h.kv.get<IncrementalAnalysisState>(KV.analysisState,'s1'))!;
    expect(h.provider.summarize).toHaveBeenCalledTimes(1); expect(s.summary.batch?.result).toBeTruthy(); expect(s.nextAt).toBeNull();
    await h.add('o2'); await a.enqueue('s1'); h.advance(); await a.tick();
    expect(h.provider.compress).toHaveBeenCalledTimes(2); expect(h.provider.summarize).toHaveBeenCalledTimes(1);
  });
  it('reports historical truncation and new invalid-output costs as part of total cost', async () => {
    const h=harness();
    const u={id:'u',sessionId:'s1',phase:'graph',model:'deepseek-v4-flash',timestamp:'2026-09-06T08:00:00Z',inputTokens:1000000,cacheHitTokens:0,outputTokens:1000000,finishReason:'length'};
    await h.kv.set(KV.analysisUsage,'u',u);
    await h.kv.set(KV.analysisUsage,'v',{...u,id:'v',finishReason:'stop',outcome:'invalid'});
    await h.kv.set(KV.analysisUsage,'w',{...u,id:'w',finishReason:'stop',outcome:'valid'});
    const status=await analysisStatus(h.kv);
    expect(status.calls).toBe(3); expect(status.rejectedResponses).toBe(2);
    expect(status.estimatedUsd).toBeCloseTo(2.64); expect(status.rejectedEstimatedUsd).toBeCloseTo(1.76);
  });
});
