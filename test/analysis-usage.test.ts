// Modified by OtterHelm for this custom distribution; see deploy/local/README.md.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
import { analysisUsageContext, analysisCost } from '../src/analysis-usage.js';

afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});
const response = (finish = 'stop', content: string | null = 'result') => new Response(JSON.stringify({model:'deepseek-v4-flash',usage:{prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:20},choices:[{finish_reason:finish,message:{content,reasoning_content:'private thinking'}}]}),{status:200});
describe('incremental usage accounting', () => {
  it('records actual provider totals including cache hits without storing prompts', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response())); const record = vi.fn();
    await analysisUsageContext.run({sessionId:'s1',phase:'summary',record},()=>new OpenAIProvider('test-key','deepseek-v4-flash',4096,'https://api.deepseek.com').summarize('system','sensitive prompt'));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({inputTokens:100,outputTokens:50,cacheHitTokens:20,model:'deepseek-v4-flash'}));
    expect(JSON.stringify(record.mock.calls)).not.toContain('sensitive prompt');
  });
  it('accounts for a truncated paid response but does not accept its result', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response('length'))); const record = vi.fn();
    await expect(analysisUsageContext.run({sessionId:'s1',phase:'graph',record},()=>new OpenAIProvider('test-key','flash',4096,'https://api.deepseek.com').compress('s','p'))).rejects.toThrow('truncated');
    expect(record).toHaveBeenCalledTimes(1);
  });
  it('does not substitute reasoning for missing final content', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response('stop',null)));
    await expect(analysisUsageContext.run({sessionId:'s1',phase:'summary',record:vi.fn()},()=>new OpenAIProvider('test-key','flash',4096,'https://api.deepseek.com').summarize('s','p'))).rejects.toThrow('no final content');
  });
  it('retains a valid response if usage storage alone fails', async () => {
    const fetchMock=vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch',fetchMock);
    const result=await analysisUsageContext.run({sessionId:'s1',phase:'summary',record:vi.fn().mockRejectedValue(new Error('disk'))},()=>new OpenAIProvider('test-key','flash',4096,'https://api.deepseek.com').summarize('s','p'));
    expect(result).toBe('result'); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('disables thinking only for opt-in DeepSeek graph analysis', async () => {
    vi.stubEnv('AGENTMEMORY_GRAPH_NONTHINKING','true'); vi.stubEnv('OPENAI_REASONING_EFFORT','low');
    const fetchMock=vi.fn().mockImplementation(async()=>response()); vi.stubGlobal('fetch',fetchMock);
    const p=new OpenAIProvider('test','deepseek-v4-flash',4096,'https://api.deepseek.com');
    await analysisUsageContext.run({sessionId:'s',phase:'graph',record:vi.fn()},()=>p.compress('s','p'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({thinking:{type:'disabled'},max_tokens:4096});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBeUndefined();
    await analysisUsageContext.run({sessionId:'s',phase:'summary',record:vi.fn()},()=>p.summarize('s','p'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).thinking).toBeUndefined();
    await p.compress('s','p'); expect(JSON.parse(fetchMock.mock.calls[2][1].body).thinking).toBeUndefined();
    await analysisUsageContext.run({sessionId:'s',phase:'graph',record:vi.fn()},()=>new OpenAIProvider('test','other',4096,'https://example.com').compress('s','p'));
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).thinking).toBeUndefined();
  });
  it('prices recorded token usage by model, timestamp and cache hits', () => {
    const u={id:'u',sessionId:'s',phase:'graph' as const,model:'deepseek-v4-flash',timestamp:'2026-09-06T08:00:00Z',inputTokens:1000000,cacheHitTokens:0,outputTokens:1000000,finishReason:'length'};
    expect(analysisCost(u)).toBeCloseTo(.88); expect(analysisCost({...u,timestamp:'2026-09-07T08:00:00Z'})).toBeCloseTo(1.76);
    expect(analysisCost({...u,model:'deepseek-v4-pro'})).toBeCloseTo(2.64);
    expect(analysisCost({...u,cacheHitTokens:1000000})).toBeCloseTo(.667);
    expect(analysisCost({...u,model:'unknown'})).toBeNull();
    expect(analysisCost({...u,model:'deepseek-flash'})).toBeCloseTo(.75);
    expect(analysisCost({...u,model:'deepseek-flash',timestamp:'2026-09-11T08:00:00Z'})).toBeCloseTo(1.5);
    expect(analysisCost({...u,model:'deepseek-flash',cacheHitTokens:1000000})).toBeCloseTo(.603);
    expect(analysisCost({...u,model:'deepseek-v4.1-flash'})).toBeCloseTo(.75);
  });
  it('keeps a deadline active while waiting for the response body', async () => {
    const controller=new AbortController();
    const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
    const started=Promise.withResolvers<void>();
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>({ok:true,json:()=>new Promise((_resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(new Error('body timed out')),{once:true}); started.resolve();
    })})));
    try {
      const call=analysisUsageContext.run({sessionId:'s',phase:'graph',record:vi.fn()},()=>new OpenAIProvider('test','flash',4096,'https://api.deepseek.com').compress('s','p'));
      const assertion=expect(call).rejects.toThrow('body timed out'); await started.promise; controller.abort(); await assertion;
      expect(timeout).toHaveBeenCalledWith(60000);
    } finally {timeout.mockRestore();}
  });
});
