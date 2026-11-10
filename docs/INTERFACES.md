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
  reviewStatus: 'DETECTED'      // DETECTED | NEEDS_REVIEW | CONFIRMED | USER_ADDED | REJECTED
}
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
    owners: [{ findingId, name, birthDate, role: 'OWNER' }],
    rights: [{ kind: 'MORTGAGE', maxClaimAmount, cancelled, receivedAt }]
  },
  contract: {
    documentId, address,
    landlords: [{ findingId, name, birthDate, role: 'LANDLORD' }],
    tenants: [...], accountHolders: [...],
    deposit, monthlyRent, specialTerms: ['...']
  }
}
```

`birthDate`는 동일 인물 판정에만 쓰고 AI로 보내지 않는다. 읽지 못한 값은 `null`로 두고 추측하지 않는다.

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
    value: '선택한 글자'
  }]
}
```

- **흐름**: PART 4 `masking-review-ui`가 바뀔 때마다 `onChange(edits)`로 **edits 전체**를 넘긴다(바뀐 부분만 X). PART 5는 상태(`maskingEdits`)에 저장하고 `createMaskingPlan` → `applyMaskingPlan` → `validateMaskedText`에 **모두 edits를 넘겨** 미리보기를 갱신한다(9번 표). 규칙 적용은 모두 PART 4가 한다.
- **add**: 항상 `REDACT`. AI로 보내는 글(maskedText)에서는 `value`를 가리고, PDF용 `bbox`는 PART 4가 그 block 위치로 채운다.
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
| 1 | `readDocument(file)` | File (PDF/JPG/PNG) | DocumentModel |
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


