import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../src/viewer/index.html', import.meta.url);
let html = readFileSync(path, 'utf8');
if (html.includes('agentmemory-viewer-language')) throw new Error('Viewer already localized');
const ko = {
  Dashboard:'대시보드', Graph:'지식그래프', Memories:'메모리', Timeline:'타임라인', Sessions:'세션',
  Lessons:'학습 규칙', Actions:'작업', Crystals:'핵심 요약', Audit:'감사 기록', Activity:'활동', Profile:'프로필', Replay:'다시 보기',
  'Viewer authorization required':'뷰어 인증이 필요합니다', Unlock:'잠금 해제',
  'Graph Nodes':'그래프 노드', Health:'상태', 'Function Calls':'함수 호출', 'Circuit Breaker':'오류 차단기',
  'Token Savings':'토큰 절약', 'System Resources':'시스템 리소스', Heap:'힙', External:'외부 메모리',
  'Event Loop':'이벤트 루프', 'Recent Sessions':'최근 세션', Project:'프로젝트', Status:'상태', Obs:'관찰', Started:'시작 시각',
  'Recent Activity':'최근 활동', 'No activity recorded yet':'아직 기록된 활동이 없습니다',
  'Function Metrics (OTel)':'함수 지표 (OTel)', Function:'함수', Calls:'호출', Success:'성공', Fail:'실패',
  'Avg Latency':'평균 지연', Quality:'품질', Workers:'워커', 'Circuit Breaker Details':'오류 차단기 상세',
  State:'상태', Failures:'실패 횟수', 'Last Failure':'마지막 실패', 'Opened At':'차단 시작',
  'Semantic Memory':'의미 메모리', 'Procedural Memory':'절차 메모리', 'Consolidation Status':'통합 상태',
  'Semantic facts':'의미 정보', Procedures:'절차', Relations:'관계', 'Memory Relations':'메모리 관계',
  Refresh:'새로 고침', 'Auto-refresh 30s':'30초마다 새로 고침',
  'Knowledge graph is off':'지식그래프가 꺼져 있습니다', 'Graph query failed':'그래프 조회에 실패했습니다', Retry:'다시 시도',
  'Graph Stats':'그래프 통계', Nodes:'노드', Edges:'관계', 'Filter by Type':'유형별 필터', Legend:'범례',
  'Expand neighbors':'인접 노드 펼치기', '↻ Rebuild Graph':'↻ 그래프 다시 구성',
  'All types':'모든 유형', 'No memories yet':'아직 메모리가 없습니다', Title:'제목', Type:'유형',
  Strength:'강도', Version:'버전', Updated:'수정 시각', Delete:'삭제', 'Delete Memory':'메모리 삭제', Cancel:'취소',
  'Select session':'세션 선택', 'All importance':'모든 중요도',
  'Select a session to view observations':'관찰을 보려면 세션을 선택하세요',
  'Input:':'입력:', 'Output:':'출력:', Prev:'이전', Next:'다음',
  'Activity Heatmap (Past Year)':'활동 히트맵 (최근 1년)', 'Type Breakdown':'유형별 통계',
  'No observations yet':'아직 관찰이 없습니다', 'Activity Feed':'활동 목록', 'No recent activity':'최근 활동이 없습니다',
  'No sessions':'세션이 없습니다', OBSERVATIONS:'관찰', 'TOOLS USED':'사용 도구', 'FILES TOUCHED':'관련 파일', DURATION:'소요 시간',
  'Tool Invocations':'도구 호출', 'Activity Breakdown':'활동별 통계', Files:'파일', Metadata:'메타데이터',
  'End Session':'세션 종료', Summarize:'요약 생성', 'Summarize unavailable':'요약 생성 불가',
  'No lessons yet':'아직 학습 규칙이 없습니다', Lesson:'학습 규칙', Confidence:'신뢰도', Uses:'사용 횟수', Source:'출처', 'Why learned':'학습 이유',
  'All statuses':'모든 상태', 'No actions tracked yet':'아직 추적 중인 작업이 없습니다',
  'Three ways to create them:':'생성하는 세 가지 방법:', Priority:'우선순위', Tags:'태그', Frontier:'다음 작업',
  'No crystals yet':'아직 핵심 요약이 없습니다', 'LESSONS SURFACED':'표시된 학습 규칙',
  'All operations':'모든 작업', 'No audit entries yet':'아직 감사 기록이 없습니다',
  'Audit entries are created by governance operations (delete, evolve, consolidate).':'삭제·개선·통합 작업을 실행하면 감사 기록이 생성됩니다.',
  'No projects':'프로젝트가 없습니다', 'No profile data for this project':'이 프로젝트의 프로필 정보가 없습니다',
  'Top Concepts':'주요 개념', 'Top Files':'주요 파일', 'No files yet':'아직 파일이 없습니다',
  Conventions:'프로젝트 규칙', 'No conventions detected yet':'아직 감지된 규칙이 없습니다',
  'Project Summary':'프로젝트 요약', 'Project Stats':'프로젝트 통계', 'Total Obs':'전체 관찰',
  'Feature flags':'기능 설정', 'Import JSONL':'JSONL 가져오기', Speed:'속도',
  'No event selected.':'선택한 이벤트가 없습니다.', 'Tool:':'도구:', Input:'입력', Output:'출력',
  'No sessions yet. Start a coding session with agentmemory hooks enabled.':'아직 세션이 없습니다. agentmemory 훅이 활성화된 코딩 세션을 시작하세요.',
  'No semantic facts yet. Observations will be consolidated into semantic memories over time.':'아직 의미 정보가 없습니다. 통합 기능이 활성화되면 관찰이 의미 메모리로 통합됩니다.',
  'No procedures yet. Repeated patterns will be extracted as procedures.':'아직 절차가 없습니다. 반복되는 패턴에서 절차가 추출됩니다.',
  'No graph data yet. Building from observations and memories...':'아직 그래프가 없습니다. 관찰과 메모리에서 구성 중…',
  'Rebuilding graph from observations...':'관찰에서 그래프를 다시 구성 중…',
  'latest versions':'최신 버전', 'confidence-scored':'신뢰도 평가', 'action digests':'작업 핵심 요약',
  'Loading session details…':'세션 상세 불러오는 중…', 'Loading sessions…':'세션 불러오는 중…',
  'Loading replay…':'다시 보기 불러오는 중…', 'Importing JSONL…':'JSONL 가져오는 중…',
};
for (const [en, kr] of Object.entries({dashboard:'대시보드', memories:'메모리', timeline:'타임라인', observations:'관찰', activity:'활동', sessions:'세션', lessons:'학습 규칙', actions:'작업', crystals:'핵심 요약', 'audit log':'감사 기록', profile:'프로필', 'profile data':'프로필 정보'})) {
  ko['Loading ' + en + '...'] = kr + ' 불러오는 중…';
}
const placeholders = {
  'Search nodes...':'노드 검색…', 'Search memories...':'메모리 검색…', 'Search lessons...':'학습 규칙 검색…',
  'Search actions...':'작업 검색…', 'Search crystals...':'핵심 요약 검색…',
};
Object.assign(ko, placeholders);
// Only source-authored literal labels receive markers. Escaped record values never do.
let count = 0;
html = html.replace(/(<([a-z][\w-]*)\b[^<>]*>)([^<>\r\n]+)(<\/\2>)/g, (whole, open, tag, value, close) => {
  if (!(value in ko)) return whole;
  count++;
  return open.slice(0, -1) + ' data-ui-en="' + value + '">' + value + close;
});
html = html.replace(/placeholder="([^"]+)"/g, (whole, value) => value in placeholders ? whole + ' data-ui-placeholder="' + value + '"' : whole);
html = html.replace('      <button id="theme-toggle"', '      <select id="viewer-language" aria-label="Language / 언어" class="btn" style="margin-right:8px"><option value="ko">한국어</option><option value="en">English</option></select>\n      <button id="theme-toggle"');
const script = `
    var viewerTranslations = ${JSON.stringify(ko)};
    var viewerLanguage = 'en';
    try { viewerLanguage = localStorage.getItem('agentmemory-viewer-language') || (navigator.language.startsWith('ko') ? 'ko' : 'en'); } catch (_) {}
    if (viewerLanguage !== 'ko') viewerLanguage = 'en';
    document.documentElement.lang = viewerLanguage;
    function translateViewerUI() {
      document.querySelectorAll('[data-ui-en]').forEach(function(el) {
        var en = el.getAttribute('data-ui-en');
        var text = viewerLanguage === 'ko' ? (viewerTranslations[en] || en) : en;
        if (el.textContent !== text) el.textContent = text;
      });
      document.querySelectorAll('[data-ui-placeholder]').forEach(function(el) {
        var en = el.getAttribute('data-ui-placeholder');
        el.placeholder = viewerLanguage === 'ko' ? viewerTranslations[en] : en;
      });
    }
    var languageSelect = document.getElementById('viewer-language');
    languageSelect.value = viewerLanguage;
    languageSelect.addEventListener('change', function() {
      viewerLanguage = languageSelect.value === 'ko' ? 'ko' : 'en';
      document.documentElement.lang = viewerLanguage;
      try { localStorage.setItem('agentmemory-viewer-language', viewerLanguage); } catch (_) {}
      translateViewerUI();
    });
    new MutationObserver(translateViewerUI).observe(document.body, { childList: true, subtree: true });
    translateViewerUI();
`;
const nonceScript = '<script nonce="__AGENTMEMORY_VIEWER_NONCE__">';
const insertion = html.lastIndexOf(nonceScript);
if (insertion < 0) throw new Error('Expected viewer nonce script');
html = html.slice(0, insertion + nonceScript.length) + script + html.slice(insertion + nonceScript.length);
writeFileSync(path, html);
console.log(`Marked ${count} UI literals. No runtime record translation.`);
