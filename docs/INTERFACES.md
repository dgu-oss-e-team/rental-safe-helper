# 공통 데이터 규격 (INTERFACES)

이 문서와 `src/shared/document-model.js`는 항상 같은 내용이어야 한다.
규격을 바꾸려면 이 값을 쓰는 팀원에게 먼저 알리고, 두 파일을 같은 PR에서 함께 고친다.

## 1. 반환 형식 (모든 공개 함수)

```js
{ ok: true, data: { /* 결과 */ } }
{ ok: false, error: { code: 'OCR_FAILED', message: 'Text recognition failed.' } }
```

- `ok()`, `fail()` 헬퍼를 쓴다 (`src/shared/document-model.js`).
- `message`는 영어 안내 문장. **실제 개인정보를 넣지 않는다.** 콘솔 로그에도 넣지 않는다.

| 오류 코드 | 의미 |
|---|---|
| `UNSUPPORTED_FILE` | 지원하지 않는 파일 |
| `PDF_READ_FAILED` | PDF 읽기 실패 |
| `OCR_FAILED` | OCR 실패 |
| `LOW_CONFIDENCE` | 인식 신뢰도 부족 |
| `MISSING_REQUIRED_FIELD` | 필수 항목 누락 |
| `COORDINATE_INVALID` | 좌표 오류 |
| `PDF_EXPORT_FAILED` | PDF 생성 실패 |
| `INVALID_INPUT` | 함수 입력이 형식에 맞지 않음 |
| `NOT_IMPLEMENTED` | 아직 구현 전 |

## 2. DocumentModel (PART 1 → 모두)

```js
{
  documentId: 'DOC_001',
  documentType: 'UNKNOWN',      // UNKNOWN | REGISTRY | LEASE_CONTRACT
  sourceType: 'text_pdf',       // text_pdf | image_pdf | image
  pages: [{
    pageIndex: 0, width: 2480, height: 3508,
    blocks: [{
      blockId: 'BLOCK_001',
      text: '김철수',
      bbox: { x: 0.12, y: 0.35, width: 0.15, height: 0.03 },
      confidence: 0.98          // PDF 텍스트 추출은 null
    }]
  }]
}
```

### OCR 결과 확인: "Confirm text" 단계 (#93 PART 1 · #54 PART 5 합의)

사진(`sourceType: 'image'`)이나 글자 없는 스캔 PDF(`'image_pdf'`)가 있으면 ①과 ② 사이에서 사용자가 OCR 글자를 확인한다. (노션 PART 1 완료 기준 "OCR 결과를 사용자가 수정할 수 있다")

- `readDocument(file, { allowLowConfidence: true })`: 흐린 줄이 있어도 멈추지 않고 문서를 돌려준다(줄마다 `confidence` 유지). 옵션 없이 부르면 지금처럼 `LOW_CONFIDENCE`로 멈춘다.
- PART 1 `renderOcrEditor({ documents, files, onChange })` → `HTMLElement` (slots.js `ocrEditor`)
  - `documents`: 사진·스캔 서류의 DocumentModel[], `files`: 그 원본 파일 (원본 그림을 옆에 보여 줌)
  - `onChange(editedDocuments)`: 고칠 때마다 DocumentModel[] **전체**(복사본). 입력 문서는 바꾸지 않는다.
  - 고친 줄은 `blockId`·`bbox` 그대로, `text`만 바뀐다. 사용자가 고치거나 확인한 줄은 `confidence: 1`.
  - 흐린 줄 기준: PART 1 `isLowConfidenceBlock()` (숫자가 있는 줄 0.8 미만, 그 밖의 줄 0.75 미만)
- PART 5: 흐린 줄이 **모두** 확인되기 전에는 다음 단계로 넘어가지 못한다. 확인한 서류로 나머지 분석(판별·탐지·위험 점검)을 한다.
- PART 5는 글자를 칠 때마다 화면을 다시 그리지 않는다(입력 칸 포커스 유지). 고친 서류는 메모리에만 둔다.


## 3. 좌표 규칙

| 항목 | 규칙 |
|---|---|
| 기준 위치 | 페이지 왼쪽 위 |
| X / Y | 오른쪽 / 아래쪽으로 증가 |
| 범위 | **0~1 정규화** (`isValidBBox()`로 검사) |
| 형식 | `{ x, y, width, height }` |
| 페이지 번호 | 0부터 |
| 기준 이미지 | 회전·원근 보정이 끝난 페이지 |

## 4. 개인정보 탐지 결과 (PART 2)

```js
{
  id: 'PII_001',
  type: 'PERSON_NAME',
  value: '김철수',
  documentId: 'DOC_001',        // 문서가 여러 개라 어느 문서인지 필요
  pageIndex: 0,
  blockId: 'BLOCK_001',
  bbox: { x: 0.12, y: 0.35, width: 0.15, height: 0.03 },
  confidence: 0.98,
  reviewStatus: 'DETECTED',     // DETECTED | NEEDS_REVIEW | CONFIRMED | USER_ADDED | REJECTED
  groupId: 'ADDR_DOC_001_1'     // 선택. 두 줄 이상에 걸친 주소 조각에만 붙는다 (아래 설명)
}
```

### 두 줄 주소: `groupId` (선택 필드, PR #28에서 PART 2·4·5 합의)

- 주소가 줄이나 block을 넘어가면 **줄마다 결과를 하나씩** 만든다. 조각마다 자기 `blockId`·`bbox`를 가진다.
- 같은 주소의 조각에는 **같은 `groupId`** 를 붙인다. 순서는 결과 순서(문서에 나오는 순서)와 같다.
- **한 줄 주소에는 `groupId`가 없다.** 없으면 혼자인 주소로 본다.
- PART 4: 같은 `groupId` 조각을 이어 붙인 뒤 한 번만 줄이고, 첫 조각에만 결과를 넣고 나머지 조각은 가린다.
- PART 5: 조각마다 따로 상자를 그린다. 조각이 하나라도 마스킹 계획에서 빠지면 그 줄이 안 가려지므로, 모든 조각이 계획에 들어와야 한다.

예: `소재지 서울특별시 중구 필동로 00,` / `101동 1001호` (두 block)
```js
{ id: 'PII_DOC_LEASE_001', type: 'ADDRESS', value: '서울특별시 중구 필동로 00,', blockId: 'L_002', groupId: 'ADDR_DOC_LEASE_1', ... }
{ id: 'PII_DOC_LEASE_002', type: 'ADDRESS', value: '101동 1001호',              blockId: 'L_003', groupId: 'ADDR_DOC_LEASE_1', ... }
```

| 개인정보 | 코드 |
|---|---|
| 이름 | `PERSON_NAME` |
| 주민등록번호 | `RESIDENT_ID` |
| 외국인등록번호 | `FOREIGNER_ID` |
| 여권번호 | `PASSPORT_ID` |
| 전화번호 | `PHONE_NUMBER` |
| 계좌번호 | `BANK_ACCOUNT` |
| 주소 | `ADDRESS` |
| 등기 고유번호 | `REGISTRY_ID` |

## 5. 비교용 추출 데이터 (PART 2 `extractFields()` → PART 3·4)

assessRisks()의 입력("비교용 추출 데이터")과 matchPeople()의 입력("인물 후보")이다.

```js
{
  registry: {
    documentId, address,
    owners: [{ findingId, name, birthDate, role: 'OWNER' }],                  // 지금 소유자만
    previousOwners: [{ findingId, name, birthDate, role: 'PREVIOUS_OWNER' }], // 갑구의 예전 소유자 (이미 판 사람)
    rights: [{ kind: 'MORTGAGE', maxClaimAmount, cancelled, receivedAt }],
    lastTransferDate: '2024-05-10'  // 갑구 마지막 소유권이전 접수일 (신탁 포함, 소유권보존만 있으면 null)
  },
  contract: {
    documentId, address,
    landlords: [{ findingId, name, birthDate, role: 'LANDLORD' }],
    tenants: [...], accountHolders: [...],
    deposit, monthlyRent, specialTerms: ['...'],
    contractDate: '2025-03-05'      // 계약일 ("계약일" 라벨 또는 서명일)
  }
}
```

`birthDate`는 동일 인물 판정에만 쓰고 AI로 보내지 않는다. 읽지 못한 값은 `null`로 두고 추측하지 않는다.

날짜(`lastTransferDate`, `contractDate`)는 `'YYYY-MM-DD'` 문자열이다. 못 읽으면 `null`이다. (PART 3 최근 소유권 이전 점검용, 이슈 #44)

`owners`는 지금 소유자(말소되지 않은 마지막 소유권 기록의 소유자)만 넣는다. 갑구에 남아 있는 예전 소유자는 `previousOwners`에 `role: 'PREVIOUS_OWNER'`로 넣는다. 예전 소유자가 없으면 `[]`, 지금 소유자를 정할 수 없으면 둘 다 `null`이다. (순위번호가 없는 등기부처럼 나눌 근거가 없으면 `owners`에 소유자를 전부 넣고 `previousOwners`는 `null`) PART 3은 `owners`만 쓰고, PART 4는 `previousOwners`로 가명(`[PrevOwner_E]`)을 붙인다.

### 값이 없을 때: `null`과 `[]` 구분 (모든 파트 공통)

| 상황 | 값 | 의미 |
|---|---|---|
| 읽었는데 항목이 없음 | `[]` (빈 배열) | 확인 결과 없음 |
| 읽지 못함 (OCR 실패, 흐림 등) | `null` | 있는지 없는지 모름 |

- 목록이 아닌 단일 값(예: `deposit`, `address`)도 읽지 못하면 `null`로 둔다.
- `null`은 "위험 없음"으로 판정하지 않는다. 반드시 "확인 불가"로 표시한다.

예시:
```js
rights: []    // 등기부를 읽었고, 근저당·압류 없음
rights: null  // 을구를 읽지 못함 → 확인 불가
```

## 6. 인물 판별 결과 (PART 4 `matchPeople()`)

```js
{ personId: 'P1', alias: '[Owner_A]', roles: ['OWNER'], findingIds: ['PII_R03'], status: 'CONFIRMED' } // 또는 'AMBIGUOUS'
```

같은 사람 = 같은 가명, 동명이인 = 다른 가명. 판정이 애매하면 `AMBIGUOUS`로 두고 사용자에게 확인한다.

판정 규칙 (비슷한 이름은 Fuse.js 유사도로 찾는다. **비슷한 이름이라고 자동으로 합치지 않고**, `AMBIGUOUS`로 두고 "같은 사람인가요?"에서 사용자가 확인한다):

| 이름 | 생년월일 | 결과 |
|---|---|---|
| 같음 | 같음 | 같은 사람 `CONFIRMED` |
| 같거나 비슷함 | 다름 | 동명이인, 다른 사람 `CONFIRMED` |
| 같거나 비슷함 (김철수 / 김철슈) | 한쪽이 `null` | `AMBIGUOUS` (사용자에게 확인) |
| 다름 (비슷하든 아니든: 김철슈, 박철수) | 같음 | 자동으로 합치지 않고 둘 다 `AMBIGUOUS` |
| 비슷하지 않음 | 다름 / `null` | 다른 사람 `CONFIRMED` |

비슷한 이름 기준: 한글은 성(첫 글자)이 같고 길이 차이 1글자 이하, Fuse.js 점수 0.34 이하. 영문 등은 성·이름 순서가 나라마다 달라 첫 글자 규칙 없이 전체 이름으로 비교, 점수 0.2 이하.

### "같은 사람인가요?" 답 (`personAnswers`)

② 결과 화면에서 `AMBIGUOUS`인 사람마다 "같은 사람인가요?"를 묻고, 답을 상태에 `maskingEdits`와 **따로** 둔다.

```js
personAnswers = { P4: 'P2' }  // P4는 P2와 같은 사람
personAnswers = { P4: null }  // P4는 다른 사람 (확인함)
personAnswers = {}            // 키 없음 = 아직 답하지 않음
```

- PART 4 `applyPersonAnswers(personGroups, personAnswers)` → `Result<PersonGroup[]>`로 **합친 그룹**을 만든다. 원래 `personGroups`는 바꾸지 않는다.
  - 같은 사람(`{ P4: 'P2' }`): 답의 대상(P2)의 `personId`·`alias`를 남기고, P4의 `roles`·`findingIds`를 합친다. 합친 그룹은 `CONFIRMED`. (가명도 하나로 합쳐진다)
  - 답을 따라간다: P4·P2가 둘 다 `AMBIGUOUS`이고 `{ P4: 'P2', P2: 'P1' }`이면 셋 다 P1로 합친다.
  - 다른 사람(`{ P4: null }`): 그 그룹을 `CONFIRMED`로만 바꾼다.
  - 답의 키는 **원래 `AMBIGUOUS`인 사람만** 된다. `CONFIRMED`인 사람(예: 생년월일이 다른 소유자·임대인)을 합치면 근거 없이 STOP이 사라질 수 있어서다.
  - 없는 `personId`, 자기 자신, 서로 가리키는 답(`{ P2: 'P4', P4: 'P2' }`), `CONFIRMED`인 사람의 답은 `INVALID_INPUT`으로 **실패** → PART 5는 이전 상태를 유지한다.
- PART 5는 합친 그룹으로 PART 3 `assessRisks(fields, 합친 그룹)`과 PART 4 마스킹(`prepareForAi`)을 다시 계산한다.
- 질문 화면: PART 4 `renderPersonQuestions({ analysis, personGroups, personAnswers, onChange })` → `HTMLElement | null` (slots.js `personQuestions`)
  - 질문은 원래 판정(`analysis.personGroups`) 기준이라 답한 뒤에도 남는다. 후보는 이름이 같거나 비슷하거나(오타 허용) 생년월일이 같은 다른 사람.
  - `onChange(answers 전체)`, 물어볼 사람이 없으면 `null`.
- 새 서류를 분석하면 비우고, 목적을 바꿀 때는 유지한다.

## 7. 위험 점검 결과 (PART 3)

```js
{
  ruleId: 'OWNER_MISMATCH', status: 'STOP', title: '...', explanation: '...', action: '...',
  evidence: {  // 선택. 화면 근거 칸 전용
    left:  { label: 'Registry owner',    value: '김철수 (birth 800101)' },
    right: { label: 'Contract landlord', value: '김철수 (birth 750315)' }
  }
}
```

- `explanation`, `action`, `title`에는 실제 이름 대신 **역할 가명**(`[Owner_A]` 등)만 쓴다. AI 프롬프트에 들어가기 때문이다.
- `evidence`는 사용자 화면에만 보여 준다. 실제 이름·주소가 들어갈 수 있으므로 **프롬프트·로그·오류 메시지에 넣지 않는다.**

| status | 의미 |
|---|---|
| `STOP` | 위험 |
| `CHECK` | 확인 필요 |
| `NO_FLAG` | 확인한 범위에서 위험 신호 없음 (안전하다는 뜻 아님) |
| `UNVERIFIABLE` | 확인 불가. **읽지 못한 항목은 반드시 이것** |

## 8. 마스킹 계획 (PART 4 → PART 3·5)

```js
{
  purpose: 'FRAUD_CHECK',  // CLAUSE_EXPLANATION | FRAUD_CHECK | CONTRACT_EXPLANATION
  items: [{
    findingId: 'PII_001',
    action: 'REPLACE',     // REDACT | REPLACE | KEEP
    replacement: '[Landlord_A]',
    documentId: 'DOC_001',
    pageIndex: 0,
    bbox: { x: 0.12, y: 0.35, width: 0.15, height: 0.03 }
  }]
}
```

목적별 처리 규칙은 `src/config/masking/masking-policy.json`. 주민·외국인등록번호·여권번호는 모든 목적에서 `REDACT`.

### 사용자 수정 (edits): ④ 보내기 전 확인 화면 (PART 4 UI → PART 5 → PART 4)

사용자가 가릴 항목을 해제하거나 더 가린 내용. PR #37에서 PART 4·5 합의.

```js
{
  remove: ['PII_DOC_LEASE_003'],   // 사용자가 해제한 findingId
  add: [{                          // 사용자가 글자를 선택해 더 가린 부분
    id: 'USER_001',
    documentId: 'DOC_002',
    blockId: 'BLOCK_014',
    value: '선택한 글자',
    pageIndex: 0,                  // 그 block이 있는 페이지 (PART 4 확인 화면이 채움)
    bbox: { x: 0.1, y: 0.62, width: 0.5, height: 0.03 }  // 그 block의 bbox (PDF에서 가릴 자리)
  }]
}
```

- **흐름**: PART 4 `masking-review-ui`가 바뀔 때마다 `onChange(edits)`로 **edits 전체**를 넘긴다(바뀐 부분만 X). PART 5는 상태(`maskingEdits`)에 저장하고 `createMaskingPlan` → `applyMaskingPlan` → `validateMaskedText`에 **모두 edits를 넘겨** 미리보기를 갱신한다(9번 표). 규칙 적용은 모두 PART 4가 한다.
- **add**: 항상 `REDACT`. AI로 보내는 글(maskedText)에서는 `value`를 가리고, PDF용 `pageIndex`·`bbox`는 PART 4 확인 화면이 add를 만들 때 그 block 위치로 채운다.
  `pageIndex`·`bbox`가 없거나 `isValidBBox`가 아니면 `createMaskingPlan`이 그 항목을 빼지 않고 `COORDINATE_INVALID`로 **실패**한다(빼면 AI 글에서는 가려지는데 PDF에서는 안 가려짐). PART 5는 실패하면 이전 상태를 유지하고 오류를 보여 준다.
    `value`는 ④ 미리보기(가린 글)에서 사용자가 선택한 글자다. 원본 글자를 넣으면 이미 가명·`[REDACTED]`로 바뀐 부분을 찾지 못해 가려지지 않는다.
  findings에 없는 글자이므로 `applyMaskingPlan`·`validateMaskedText`는 edits의 `add`를 보고 가리고 검사한다.
  계획(위 items)에는 이렇게 들어간다: `{ findingId: 'USER_001', action: 'REDACT', replacement: '[REDACTED]', documentId, pageIndex, bbox: 그 block의 bbox }` (findingId = add의 `id`)
- **remove**: 해제할 수 없는 종류는 무시한다: `RESIDENT_ID`, `FOREIGNER_ID`, `PASSPORT_ID`, `PHONE_NUMBER`, `BANK_ACCOUNT`.
  두 줄 주소는 같은 `groupId` 전체, 이름은 같은 인물 묶음 전체에 함께 적용한다(한 곳만 풀면 가명이 누구인지 드러남).
- **목적을 바꾸면**: `add`는 유지하고 `remove`는 비운다.
- **서류를 새로 분석하거나 처음부터 다시 하면**: edits 전체를 비운다(findingId·blockId가 달라짐).
- "같은 사람인가요?" 답은 edits에 넣지 않는다. 위험 점검에도 쓰이므로 PART 3·4와 따로 정한다.
- edits에는 원본 글자(`value`)가 들어가므로 브라우저 메모리에만 두고, 프롬프트·로그·오류 메시지에 넣지 않는다.

## 9. 공개 함수

각 파트는 `src/features/<파트>/index.js`에서만 공개 함수를 내보낸다. 다른 파트의 내부 파일을 직접 import하지 않는다.

| 파트 | 함수 | 입력 | 출력 |
|---|---|---|---|
| 1 | `readDocument(file, { allowLowConfidence? })` | File (PDF/JPG/PNG), 흐린 줄 허용 여부(2번 "OCR 결과 확인") | DocumentModel |
| 1 | `renderOcrEditor({ documents, files, onChange })` | 사진·스캔 서류, 원본 파일, 고칠 때마다 부를 함수 | HTMLElement |
| 2 | `classifyDocument(document)` | DocumentModel | `{ documentId, documentType, score }` |
| 2 | `detectPII(document)` | DocumentModel | PiiFinding[] |
| 2 | `extractFields(documents, findings)` | DocumentModel[], PiiFinding[] | 비교용 추출 데이터 |
| 3 | `assessRisks(fields, personGroups)` | 추출 데이터, 인물 판별 결과 | RiskResult[] |
| 3 | `buildPrompt({ purpose, riskResults, maskedText, legend })` | 위험 결과, 마스킹 완료 텍스트, 범례 | string |
| 4 | `matchPeople(fields)` | 추출 데이터 | PersonGroup[] |
| 4 | `createMaskingPlan(findings, personGroups, purpose, edits?)` | PiiFinding[], PersonGroup[], 목적, 사용자 수정(8번, 없으면 빈 값) | MaskingPlan |
| 4 | `applyMaskingPlan(documents, plan, findings, personGroups, edits?)` | edits의 `add` 글자도 가린다 | `{ maskedText, legend }` |
| 4 | `validateMaskedText(maskedText, findings, plan, edits?)`  | edits의 `add` 글자도 검사한다 | 남은 개인정보가 있으면 실패 |
| 5 | `exportMaskedPDF(document, plan, { file })` | DocumentModel, MaskingPlan, 원본 파일(없으면 문서 글자로 데모 페이지) | `{ fileName, blob, pageCount }` (글자를 못 읽은 페이지가 있으면 `LOW_CONFIDENCE`) |
| 5 | `prepareForAi(analysis, purpose, edits?)` | 분석 결과, 목적, 사용자 수정 | `{ purpose, maskingPlan, maskedText, legend, prompt }` |
| 5 | `runPipeline({ files, purpose })` | File[], 목적 | 전체 결과 |


