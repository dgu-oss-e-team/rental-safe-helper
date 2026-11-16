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
| PART 4 | `tests/part4-person-matcher.test.js` | 같은 사람 판별(이름·생년월일), 동명이인, 비슷한 이름(Fuse.js)은 AMBIGUOUS, 역할 가명 | 작성됨 |
| PART 4 | `tests/part4-person-answers.test.js` | "같은 사람인가요?" 답으로 그룹 합치기, 잘못된 답(자기 자신·순환·모르는 id) 거절 | 작성됨 |
| PART 4 | `tests/part4-prev-owner.test.js` | 예전 소유자 `[PrevOwner_?]` 가명, 기존 A~D 유지, 지금 소유자와 같은 사람이면 합치기 | 작성됨 |
| PART 4 | `tests/part4-masking.test.js` | 목적별 마스킹, 고유식별정보 항상 가림, 주소 시·구(동)까지 줄이기, 유출 검사 | 작성됨 |
| PART 4 | `tests/part4-edits.test.js` | 사용자 수정(가림 해제·더 가리기), 해제 못 하는 항목, 좌표 없는 add 거절 | 작성됨 |
| PART 4 | `tests/part4-review-model.test.js` | ④ 확인 화면 표 만들기, 선택한 글자 가리기(빈 값·중복·이미 가림) | 작성됨 |
| PART 5 | `tests/part5-pipeline.test.js` | 단계별 파이프라인 연결(분석 → 목적 → AI 준비 → PDF·미리보기), 멈춘 단계 알려 주기, 잘못된 좌표는 PDF 전에 거르기 | 작성됨 (Mock) |
| PART 5 | `tests/part5-integration.test.js` | 가짜 샘플 PDF(글자 PDF)로 ①~⑤ 전체: 판별, 개인정보 탐지, 시연 시나리오(STOP·CHECK·확인 불가), 목적 3가지 모두 프롬프트·가린 글에 가짜 개인정보 없음, 마스킹 위치 | 작성됨 (샘플 PDF를 실제로 처리) |
| PART 5 | `tests/part5-integration-scanned.test.js` | 사진·스캔 서류 흐름: 흐린 줄 확인 단계, 고치기 전 결과는 확인 불가, OCR 오독(0→O)을 고치지 않아도 프롬프트에 안 남음, 고친 뒤 글자 PDF와 같은 결과 | 작성됨 (샘플 PDF를 OCR 결과처럼 바꿔서) |
| PART 5 | `tests/part5-ocr-confirm.test.js` | "Confirm text" 단계: 읽기·분석 나누기, 사진·스캔만 확인, 흐린 줄 세기(숫자 줄 0.8·그 밖 0.75 미만) | 작성됨 |
| PART 5 | `tests/part5-pdf-export.test.js` | 마스킹 PDF: 좌표 → 픽셀, 상자·가명 그리기, 새 PDF에 글자·문서 정보(메타데이터) 없음 검증, 읽지 못한 서류·잘못된 좌표는 만들지 않기, ④ 미리보기 | 작성됨 |
| PART 5 | `tests/part5-double-check.test.js` | 만든 PDF를 OCR로 다시 읽어 개인정보가 보이는지 검사, OCR 띄어쓰기·기호 오류에도 찾기, 읽지 못하면 확인 불가 | 작성됨 (OCR은 Mock) |
| PART 5 | `tests/part5-person-answers.test.js` | "같은 사람인가요?" 답으로 위험 점검 다시 하기(예금주 확인 불가 → NO_FLAG·STOP), 답을 반영한 가명으로 마스킹 | 작성됨 |
| PART 5 | `tests/part5-masking-edits.test.js` | ④ 사용자 수정(edits) 상태, 목적을 바꾸면 해제는 비우고 더 가리기는 유지, 가리기·검사에 같은 edits 전달 | 작성됨 |
| PART 5 | `tests/part5-error-help.test.js` | 오류 코드별 쉬운 안내, 모르는 오류에도 안내, "safe" 표현 없음 | 작성됨 |
| PART 5 | `tests/part5-step-history.test.js` | 휴대폰 뒤로 가기: 주소에는 단계 이름만, 결과가 없는 단계로는 못 감, "Confirm text"에서 떠날 때 기록 바꿔 쓰기 | 작성됨 |

## 개인정보·PDF 검증 체크리스트 (발표 전 전원 확인)

괄호 안은 같은 내용을 확인하는 자동 테스트다. 자동 테스트가 있어도 발표 전에는 브라우저에서 직접 한 번 더 확인한다.

- [ ] 원본 서류 내용이 외부로 전송되지 않는다 (개발자 도구 Network 탭, 수동 확인만)
- [ ] 주민·외국인등록번호가 모든 목적에서 가려진다 (`part4-masking`, `part5-integration`, `part5-integration-scanned`)
- [ ] 동명이인은 서로 다른 가명, 같은 사람은 문서 간 같은 가명 (`part4-person-matcher`, `part4-person-answers`, `part5-person-answers`)
- [ ] PDF 마스킹 위치가 정확하다 (`part5-pdf-export`, `part5-integration`의 마스킹 위치 검사)
- [ ] 마스킹 PDF에서 원본 텍스트가 추출되지 않는다 (복사·검색) (`part5-pdf-export`의 새 PDF 검증)
- [ ] PDF 메타데이터에 개인정보가 없다 (`part5-pdf-export`의 새 PDF 검증)
- [ ] AI 프롬프트에 마스킹되지 않은 개인정보가 없다 (`part5-integration`, `part5-integration-scanned`, `part5-pipeline`)
- [ ] (권장) 마스킹 PDF를 다시 OCR해도 개인정보가 보이지 않는다 (`part5-double-check`, 화면의 "Double-check the PDF" 버튼)

## 시나리오 (가상 서류)

| 시나리오 | 기대 결과 |
|---|---|
| 소유자와 임대인이 동명이인 (현재 Mock) | `OWNER_MISMATCH` = STOP |
| 말소되지 않은 압류 | STOP |
| 신탁 등기 | STOP |
| 예금주 ≠ 임대인 | STOP |
| 근저당 / 최근 소유권 이전 / 위험 특약 | CHECK |
| 읽지 못한 항목 | UNVERIFIABLE |
