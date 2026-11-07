# 테스트 계획 (TEST_PLAN)

## 실행

```bash
npm test            # 저장할 때마다 다시 실행
npm test -- --run   # 한 번만 실행 (PR 올리기 전)
```

테스트 파일은 `tests/` 폴더에 파트별로 둔다.

## 파트별 필수 테스트

| 파트 | 파일 | 필수 테스트 | 현재 |
|---|---|---|---|
| 공통 | `tests/shared.test.js` | 반환 형식, 좌표 규칙 | 작성됨 |
| PART 1 | `tests/part1-document-input.test.js` | PDF 읽기, 이미지 OCR, 좌표 | 형식 검사만 (Mock) |
| PART 2 | `tests/part2-document-analysis.test.js` | 개인정보 탐지(정탐·오탐), 문서 판별 | 형식 검사만 (Mock) |
| PART 3 | `tests/part3-risk-check.test.js` | 위험 규칙별 해당/해당 아님/값 없음, 프롬프트 | 형식·프롬프트 기본 |
| PART 4 | `tests/part4-masking.test.js` | 동명이인, 역할 가명, 목적별 마스킹, 유출 검사 | 기본 동작 |
| PART 5 | `tests/part5-pipeline.test.js` | PDF 생성, 좌표 적용, 메타데이터, 전체 연결 | 전체 연결(Mock) |

## 개인정보·PDF 검증 체크리스트 (발표 전 전원 확인)

- [ ] 원본 서류 내용이 외부로 전송되지 않는다 (개발자 도구 Network 탭)
- [ ] 주민·외국인등록번호가 모든 목적에서 가려진다
- [ ] 동명이인은 서로 다른 가명, 같은 사람은 문서 간 같은 가명
- [ ] PDF 마스킹 위치가 정확하다
- [ ] 마스킹 PDF에서 원본 텍스트가 추출되지 않는다 (복사·검색)
- [ ] PDF 메타데이터에 개인정보가 없다
- [ ] AI 프롬프트에 마스킹되지 않은 개인정보가 없다
- [ ] (권장) 마스킹 PDF를 다시 OCR해도 개인정보가 보이지 않는다

## 시나리오 (가상 서류)

| 시나리오 | 기대 결과 |
|---|---|
| 소유자와 임대인이 동명이인 (현재 Mock) | `OWNER_MISMATCH` = STOP |
| 말소되지 않은 압류 | STOP |
| 신탁 등기 | STOP |
| 예금주 ≠ 임대인 | STOP |
| 근저당 / 최근 소유권 이전 / 위험 특약 | CHECK |
| 읽지 못한 항목 | UNVERIFIABLE |
