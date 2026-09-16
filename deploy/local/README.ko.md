# 증분 분석과 한국어 UI 커스텀 버전
<!-- Modified by OtterHelm for this custom distribution; see deploy/local/README.ko.md. -->

Agentmemory 0.9.29 기반의 별도 커스텀 브랜치입니다. 원본 라이선스와 저작권 표기를 유지합니다.
기본 브랜치는 원본 코드이며, 커스텀 코드는 `codex/public-incremental-ko`에 있습니다.

현재 커스텀 이미지는 `agentmemory-local:0.9.29-incremental-ko6`입니다.
적응형 묶음 복구는 [ADAPTIVE-ANALYSIS.ko.md](ADAPTIVE-ANALYSIS.ko.md),
선택적 2단계 요약은 [TWO-STAGE-SUMMARY.ko.md](TWO-STAGE-SUMMARY.ko.md)를 참고하세요.
2단계 요약을 사용하려면 `AGENTMEMORY_TWO_STAGE_SUMMARY=true`를 별도로 설정합니다.

## 기능과 설정

- `AGENTMEMORY_INCREMENTAL_ANALYSIS=true`: 세션별 새 관찰을 15분 간격으로 묶어 요약·그래프 분석합니다.
- 새 기록이 없으면 반복 분석하지 않습니다. 기존 기록 전체를 자동 재분석하지 않습니다.
- 요약은 최대 40개/24,000자, 그래프는 최대 5개/6,000자이며 남은 기록은 다음 주기에 처리합니다.
- 단계별 완료 지문, 결과 보존, 제한된 재시도와 문제 기록 보류로 중복 호출을 줄입니다.
- 원본 관찰을 삭제하지 않으며 이전 요약은 별도 이력으로 보존합니다.
- 기존 30분 예약은 한 번만 15분 정책으로 이관합니다.
- 한국어/영어 선택은 UI에만 적용합니다. 저장된 기억의 내용은 번역하지 않습니다.

```env
AGENTMEMORY_INCREMENTAL_ANALYSIS=true
AGENTMEMORY_INJECT_CONTEXT=true
AGENTMEMORY_AUTO_COMPRESS=false
GRAPH_EXTRACTION_ENABLED=true
CONSOLIDATION_ENABLED=false
AGENTMEMORY_GRAPH_NONTHINKING=true
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash
OPENAI_REASONING_EFFORT=low
MAX_TOKENS=4096
```

API 키는 저장소 밖의 로컬 환경 파일이나 비밀 관리 도구로 전달하세요.
DeepSeek 직접 API의 증분 그래프 호출에만 비추론 모드를 적용하며 요약은 별도 정책을 유지합니다.
분석 대상 기록은 외부 API로 전송됩니다. 민감한 기록을 보내기 전에 데이터 취급 정책을 검토하세요.
토큰 기반 비용 표시는 추정치이며 공급자 청구와 다를 수 있습니다. 월 예산 차단은 없습니다.

## 빌드와 검증

저장소 루트에서 의존성을 설치하고 `deploy/local/build.ps1`을 실행합니다.
이 배포 스크립트는 **기존 로컬 이미지 `agentmemory-local:0.9.29`가 필요**합니다.
포크를 복제하는 것만으로 해당 기반 이미지나 운영 데이터를 복구할 수는 없습니다.
기반 이미지의 CLI 청크 구조가 다르면 빌드는 의도적으로 실패합니다.
잠금 파일은 원본 저장소 정책에 따라 커밋하지 않으므로 의존성 재설치 후 테스트가 필요합니다.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
```

`Test.Dockerfile`은 로컬에 생성된 잠금 파일을 사용하는 격리 Linux 테스트용입니다.
`normalize-test-files.mjs`는 `/verify` 테스트 복제본에서만 줄바꿈을 정규화합니다.
`scripts/localize-viewer.mjs`는 최초 변환 기록이므로 이미 변환된 HTML에 다시 실행하지 마세요.

## 운영 안전

- 기존 영구 볼륨을 유지하며, 한 볼륨에 분석 워커를 둘 이상 연결하지 마세요.
- 소스 업데이트는 자동 배포가 아닙니다. 별도 테스트 후 운영 이미지를 교체하세요.
- 볼륨·백업·키·환경 파일·진단 출력은 Git에 추가하지 마세요.
- 컨테이너 교체와 볼륨 삭제는 별개입니다. `docker compose down -v`를 사용하지 마세요.
- 복원 시험은 별도 볼륨에서 수행하세요. 운영 데이터에 백업을 덮어쓰지 마세요.
- 저장 엔진은 주기적으로 디스크에 기록합니다. 강제 종료 시 최근 기록 유실이나 중복 API 호출 가능성이 있습니다.
- 그래프 쓰기는 여러 단계이므로 저장 장애 후 일관성 점검이 필요합니다.

## 공개 이력 정책

공개 변경은 원본 커밋 위에 새로 작성한 코드 스냅샷입니다.
개인 개발 이력, 운영 진단 스크립트, 실제 세션 식별자, 개인 경로와 데이터 백업은 포함하지 않습니다.
앞으로도 개인 개발 브랜치를 직접 병합하거나 `git push --all`/`--mirror`로 게시하지 마세요.
검토된 공개 브랜치만 명시적으로 푸시하세요.
