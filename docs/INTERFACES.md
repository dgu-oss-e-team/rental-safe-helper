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
      confidence: 0.98,         // PDF 텍스트 추출은 null
      spans: [                  // 선택. 텍스트 PDF에서 조각별 [start, end) 오프셋과 bbox 제공 (OCR은 생략)
        { start: 0, end: 3, bbox: { x: 0.12, y: 0.35, width: 0.15, height: 0.03 } }
      ],
      confirmed: true           // 선택. "Confirm this page"로 확인된 줄 여부 (원래 OCR confidence는 그대로 유지)
    }]
  }]
}
```

### 위험 결과 카드: PART 3 `renderRiskResults` (#63)

- PART 3 `renderRiskResults(riskResults)` → `HTMLElement` (slots.js `riskResults`). 입력은 `RiskResult[]`, 입력 배열은 바꾸지 않는다.
- 위쪽 요약(Stop / Check / Could not check / No warning found 개수)을 누르면 그 상태만 보고, 다시 누르면 전체를 본다. 요약은 이 화면 안에 있다(PART 5 `results.js`에는 없음).
- STOP → CHECK 카드를 먼저 보여 주고, 확인 불가·문제 없음은 기본으로 접는다. "No warning found"는 안전하다는 뜻이 아니라고 안내한다.
- `evidence`(실제 이름·주소가 들어갈 수 있음)는 화면에만 보여 주고 AI 프롬프트에는 넣지 않는다.
- 고른 필터와 펼친 칸은 모듈 안에 기억해서, PART 5가 화면을 다시 그려도 유지된다.
- 새 서류를 분석할 때는 PART 5가 `resetRiskResultsView()`를 불러 필터와 펼친 칸을 처음 상태로 되돌린다. ("같은 사람인가요?" 답으로 결과가 바뀔 때는 부르지 않는다.)

### 위험 점검·AI 프롬프트: PART 3 `assessRisks()`, `buildPrompt()` (#106)

#### `assessRisks(fields, personGroups)` → `Result<RiskResult[]>`

| | 내용 |
|---|---|
| 입력 | `fields`: 비교용 추출 데이터(5번). `personGroups`: 인물 판별 결과(6번), **배열이어야 한다** (빈 배열은 허용) |
| 성공 | `{ ok: true, data: RiskResult[] }` — 소유자·임대인, 예금주·임대인, 소재지, 신탁, 압류·가압류, 가처분, 경매개시결정, 가등기, 근저당, 최근 소유권 이전, 위험 특약 문구 순서. 모든 항목이 항상 들어 있다 (읽지 못해도 빼지 않고 `UNVERIFIABLE`로 넣는다) |
| 실패 | `{ ok: false, error: { code: 'INVALID_INPUT', message } }` — `fields`가 없거나 `personGroups`가 배열이 아닐 때, 규칙·키워드 파일(YAML)이 잘못됐을 때 |
| 실패 범위 | **전부 아니면 전무.** 한 규칙이라도 실패하면 일부 결과만 돌려주지 않고 `ok: false`로 끝낸다 (일부만 보여 주면 빠진 항목이 "문제 없음"처럼 보일 수 있다) |
| 읽지 못한 값 | `null` → `UNVERIFIABLE` (5번 null 규칙). `[]`(읽었는데 없음)만 `NO_FLAG` |

- 실패했을 때 PART 5(`pipeline.js`)는 `step: 'assessRisks'`로 멈추고 `analysis`를 만들지 않는다. 결과 화면과 AI 프롬프트 단계로 넘어가지 않고 오류 안내만 보인다. `riskResults`를 빈 배열로 채워 넘기지 않는다.
- 오류 메시지에는 개인정보를 넣지 않는다 (영어 고정 문구).

#### `buildPrompt({ purpose, riskResults, maskedText, legend, monthlyRent?, registry? })` → `Result<string>`

| 입력 | 내용 |
|---|---|
| `purpose` | `MASKING_PURPOSE` 값(`CLAUSE_EXPLANATION` / `FRAUD_CHECK` / `CONTRACT_EXPLANATION`). 다른 값이면 `INVALID_INPUT` |
| `maskedText` | PART 4 `applyMaskingPlan()`이 돌려준 `{ [documentId]: 마스킹 완료 텍스트 }`. **없거나 비어 있으면 `MISSING_REQUIRED_FIELD`로 실패**한다 (원본 글자로 대신하지 않는다) |
| `legend` | PART 4가 돌려준 역할 범례 `{ '[Owner_A]': 'owner on the register' }`. 없어도(undefined) 된다 |
| `riskResults` | `assessRisks()`의 `data`. 없거나 `[]`여도 오류가 아니다. 이때는 "Automatic check results" 칸만 빠지고 다른 칸은 그대로 만든다 |
| `registry` | (선택) `{ summaryTitle?, unavailable? }`. `summaryTitle`은 `maskedText` 중 등기부 요약(PART 4 `buildRegistrySummary`)인 글의 키로, 있으면 제목이 `### Registry (extracted)`로 나가고 안전 단정 금지 규칙이 붙는다. `unavailable: true`는 요약을 못 만들어 등기부를 뺐다는 뜻으로, **사기 위험 확인일 때만** "Registry: not provided (summary unavailable)..." 한 줄이 들어간다. 안 넘기면 기존과 똑같다 |

프롬프트 칸 순서: 안내 문장 → `## Registry summary rules`(등기부 요약이 있을 때) → `## Role legend`(사기 위험 확인 + 범례 있을 때) → `## Automatic check results`(사기 위험 확인 + 결과 있을 때) → `## Documents (masked)` → `## Questions` → `Please answer in English.`

- **등기부 요약 규칙(#361):** 요약에 `Could not read`, `could not check`, `Unconfirmed register records`, `details hidden`, `cancellation unclear`, `check the original` 중 하나라도 있으면 AI가 "안전하다"고 답하지 않고 원본 등기부 확인을 안내하도록 한다. 이 표시 문구는 PART 4 `registry-summary.js`가 만드는 영어 문구와 같아야 하므로, 한쪽을 바꾸면 다른 쪽도 같이 바꾼다.

- **"evidence는 프롬프트로 가지 않는다":** 위험 결과에서 프롬프트에 들어가는 것은 `status`, `title`, `explanation`뿐이다. `evidence`(실제 이름·주소·특약 원문이 들어갈 수 있는 화면 근거 칸)와 `action`은 넣지 않는다.
- 설명에 남은 가명이 범례에 없으면(사용자가 가림을 해제한 사람) `the landlord` 같은 역할 이름으로 바꿔서 넣는다.
- 프롬프트에 들어가는 글은 PART 4의 마스킹 완료 텍스트와 범례, 그리고 규칙 문구·추천 질문뿐이다. 원본 개인정보(`findings`의 `value`, `fields`의 이름·주소·계좌, 특약 원문)를 다시 넣지 않는다.
- 추천 질문(`getRecommendedQuestions(purpose)`)에는 개인정보와 가명을 쓰지 않는다.

#### 규칙을 추가·수정하는 방법

1. **문구만 바꿀 때**: `src/config/rules/risk-rules.yaml`. 규칙 id 아래에 `title`, `evidence`(화면 근거 칸 제목), `results`(상태 또는 `상태.변형`마다 `explanation`·`action`). 문구의 `{owner}` `{landlord}` `{accountHolder}` 자리에는 역할 가명이 들어간다. **실제 이름을 쓰지 않는다** (설명은 프롬프트에 그대로 들어간다).
2. **새 규칙을 더할 때**: 판정 함수를 `compare-documents.js` / `assess-risks.js` / `special-terms.js` 중 알맞은 곳에 만들고(`buildRiskResult(ruleId, status, ...)`로 결과 생성), `assessRisks()`에서 불러 결과에 합친다. YAML에 같은 `ruleId`의 문구를 먼저 적는다. 읽지 못한 값은 `UNVERIFIABLE`로 돌려준다. 규칙별 테스트(`tests/part3-*.test.js`)도 같이 추가한다.
3. **위험 특약 키워드를 바꿀 때**: `src/config/rules/special-term-keywords.yaml`. 분류(`categories`)마다 `label`, `reason`, `keywords`, 그리고 선택으로 `except`(이 문구가 들어 있으면 그 분류는 걸지 않는다). 형식 설명은 파일 맨 위에 있다. 키워드를 바꿀 때는 대조한 자료의 주소와 확인한 날짜를 파일 맨 위 주석과 PR 본문에 남긴다.
4. 특약 점검 결과는 `CHECK`까지만 낸다 (키워드만으로는 불리한지 확정할 수 없고, 부정문도 걸릴 수 있다). 특약 원문은 `evidence`에만 넣는다.

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

### 회사(법인) 이름과 법인 번호 (PR #238 리뷰)

- **회사(법인) 이름은 가리지 않는다.** 개인정보 종류가 아니고, 등기부 소유 법인 ↔ 계약서 임대 법인을 사용자·AI가 맞춰 보는 데 필요하다. 사람 이름만 `PERSON_NAME`이다.
- **회사(법인) 주소는 가린다.** 주소만으로는 회사 것인지 개인 것인지 확실히 구분하기 어렵고(한 줄에 근저당권자 회사와 채무자 개인이 함께 나오는 등), 개인 임대사업자의 사업장 주소는 집 주소일 수 있다. 개인 주소와 똑같이 `ADDRESS`로 가린다. (사기 위험 확인 목적은 시·군·구까지 남긴다)
- **법인 관련 번호는 가린다.** 법인등록번호·임대사업자 등록번호는 `REGISTRY_ID`다. (회사 이름만 보이고 번호는 안 보인다)
  - 칸 이름 없이 주민번호 모양으로만 읽힌 법인등록번호는 `FOREIGNER_ID` 등으로 분류될 수 있다. 종류만 다르고 가려지는 건 같다.
- **회사 안의 사람은 가린다.** 대표이사·대표자 이름은 `PERSON_NAME`이다. (PR #179)
- **회사 이름으로 보는 범위:** `주식회사`·`유한회사`·`(주)`·`㈜`로 시작하거나, 2글자 이상 뒤에 `회사`·`법인`·`리츠`·`신탁`·`은행`·`조합`·`공사`·`재단`·`협회`·`금고`·`(주)`·`㈜`가 붙은 모양, 띄어 쓴 `가상 주식회사`·`가상 유한회사` 모양만 회사로 본다.
  - 이런 낱말이 없는 개인사업자 상호(예: "○○공인중개사사무소", "○○홀딩스")는 회사로 못 볼 수 있다.
  - 회사 판별은 "성명(법인명)" 칸에서 역할 칸 순서를 판단할 때만 쓴다. 회사로 못 보면 이 판단이 고치기 전처럼 동작한다.

## 5. 비교용 추출 데이터 (PART 2 `extractFields()` → PART 3·4)

assessRisks()의 입력("비교용 추출 데이터")과 matchPeople()의 입력("인물 후보")이다.

```js
{
  registry: {
    documentId, address,
    roadAddress,                    // 표제부 [도로명주소] (지번 등기부용, 없으면 null)
    owners: [{ findingId, name, birthDate, role: 'OWNER', confidence }],                  // 지금 소유자만
    previousOwners: [{ findingId, name, birthDate, role: 'PREVIOUS_OWNER', confidence }], // 갑구의 예전 소유자 (이미 판 사람)
    rights: [{ kind: 'MORTGAGE', maxClaimAmount, cancelled, receivedAt, holder, holderIsCompany, cause }],
    unknownActiveCount: 0,          // 갑구·을구에서 인식하지 못한 유효(미말소) 줄 수 (없으면 0, 못 읽으면 null)
    lastTransferDate: '2024-05-10'  // 갑구 마지막 소유권이전 접수일 (신탁 포함, 소유권보존만 있으면 null)
    ownerCompanies: ['가상신탁주식회사']  // 지금 소유자 기록의 회사 이름 (신탁이면 수탁자). 화면 전용, 프롬프트에 넣지 않음. 없으면 [], 못 정하면 null
  },
  contract: {
    documentId, address,
    landlords: [{ findingId, name, birthDate, role: 'LANDLORD', confidence }],
    tenants: [...], accountHolders: [...],
    deposit, monthlyRent, specialTerms: ['...'],
    personalInfoRanges: [{ startLine: 4, endLine: 19 }], // 인적사항·서명란 0-based 줄 범위 목록 (없으면 [], 계약서 없으면 null)
    contractDate: '2025-03-05'      // 계약일 ("계약일" 라벨 또는 서명일)
    landlordCompanies: ['주식회사가상리츠']  // "성명(법인명)" 칸의 회사 이름 (임대사업자). 화면 전용, 프롬프트에 넣지 않음. 계약서가 없으면 null
    sourceType: 'text_pdf' | 'image_pdf' | 'image'   // 계약서 문서의 sourceType. 사진·스캔 판별에 쓴다. (#341)
  }
}
```


`rights[]`의 항목 필드:
- `kind`: `'MORTGAGE'` | `'PROVISIONAL_SEIZURE'` | `'SEIZURE'` | `'TRUST'` | `'JEONSE'` | `'LEASEHOLD'` | `'PROVISIONAL_DISPOSITION'`(가처분) | `'PROVISIONAL_REGISTRATION'`(가등기) | `'AUCTION'`(경매개시결정)
- `holder`: 권리자 이름 (`string | null`, 못 읽으면 `null`)
- `holderIsCompany`: 권리자가 법인·은행·신탁·조합 등 회사이면 `true`, 개인이면 `false`, `holder`가 `null`이면 `null`
- `cause`: 등기원인 (예: `'설정계약'`, `'매매'`, `'결정'`, 못 읽으면 `null`)

`registry.unknownActiveCount`는 갑구·을구에서 알려진 권리·말소·안내 줄로 분류되지 않은 미말소 유효 줄 수 (`number | null`)다.

`contract.personalInfoRanges`는 계약서 전체 줄 배열(`linesOf`) 기준 인적사항(임대인·임차인·중개사·서명란) 구간의 `{ startLine, endLine }` (0-based, 양끝 포함) 배열이다. 상단 당사자 표와 하단 서명란처럼 떨어져 있으면 각각 원소로 들어가며, 없으면 `[]`, 계약서가 없으면 `null`이다.
`birthDate`는 동일 인물 판정에만 쓰고 AI로 보내지 않는다. 읽지 못한 값은 `null`로 두고 추측하지 않는다.
`confidence`는 이름이 있는 줄의 OCR 신뢰도(0~1)다. 글자 PDF는 `null`. PART 3은 흐리게 읽힌 이름이면 "다른 사람(STOP)" 대신 확인 불가로 본다. (#277)

날짜(`lastTransferDate`, `contractDate`)는 `'YYYY-MM-DD'` 문자열이다. 못 읽으면 `null`이다. (PART 3 최근 소유권 이전 점검용, 이슈 #44)

`specialTerms`는 계약서 특약 문장 목록이다. (PART 3 위험 특약 점검용)
- `null`: 특약 칸(제목)을 찾지 못함 → 확인 불가
- `[]`: 특약 칸은 찾았는데 적힌 특약이 없음 → 확인한 범위에서 특약 없음 (NO_FLAG)
- 특약 칸으로 보는 제목: `[특약사항]`, `특약사항:`, `4. 특약`, 별지 `[표준임대차계약서 제17조에 대한 특약사항]`, 민간임대 본문 `제17조(특약)` (#219)
  - `제17조(특약)` 뒤의 서식 문장("임대사업자와 임차인은 제1조부터 제15조까지에서 규정한 사항 외에 …")은 문장 전체가 서식과 같을 때만 특약에서 뺀다. 띄어쓰기·문장부호는 무시하고 한글·숫자로 비교한다.
  - `제17조(특약)` 구간은 서식 안내 줄(`◈`, `■`), 다음 조항(`제18조(…)`), 서식의 다음 구간 제목(`5. 개인정보의 제3자 제공 동의서`처럼 "동의서"·"확인서"로 끝나는 짧은 번호 줄. "2. 개인정보 제3자 제공 금지" 같은 특약은 제목이 아니다), 번호가 끊긴 짧은 번호 줄, 서명란에서 끝난다. 이런 줄 뒤에 적은 특약은 읽지 않는다.
- 서명란으로 보는 줄 (모든 특약 칸 공통, 별지 제외): "본/이/위 계약을 증명…", 괄호 `(서명 또는 날인)`·`(서명 또는 인)`, 줄 끝의 `(인)`, 줄 맨 앞의 `서명:`·`서명란`, 줄 맨 앞의 `임대인`·`임차인`·`개업공인중개사` 바로 뒤에 칸 이름(성명·주소·주민등록번호·전화·연락처·사무소·등록번호·대표)이 오는 줄. 특약 문장 속 "서명 날인", "임대인 사정으로 …", "도장(인) 지참"에서는 끝나지 않는다.
- 한계: 특약을 별지에 따로 적었는데 별지 쪽을 올리지 않으면, 본문 `제17조(특약)`만 보고 `[]`(특약 없음)가 될 수 있다. 다른 계약서에서 특약이 적힌 뒤쪽 쪽을 빼고 올린 경우도 같다.

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

역할 없는 이름(`role: null`, 등기부 채무자·채권자, 계약금 영수자 등)은 인물 묶음에 들어가지 않는다. 마스킹할 때 글자가 똑같은 이름의 묶음이 **딱 하나**면 그 가명에 `?`를 붙여 쓰고(`[PrevOwner_E?]`, 범례: "same name as [PrevOwner_E] (…), not confirmed to be the same person"), 둘 이상(동명이인)이거나 없으면 `[REDACTED]`로 가린다. 그 묶음이 **같은 서류**에도 그 이름으로 나오면 `?` 없이 같은 가명을 쓴다(계약서 동의서·서명란의 임차인, 등기부 부기 줄의 공유자 본인 등). 비슷한 이름은 연결하지 않는다. 똑같은 이름이 없으면 끝의 조사(`person-labels.json`의 `nameParticles`)를 떼고 같은 규칙으로 찾는다(`김철수는` → `[Owner_A?]는`). 조사를 뗀 나머지가 이미 있는 이름과 같을 때만 연결하므로 `김지은`은 쪼개지 않는다. (`create-masking-plan.js`)

같은 서류에서 같은 역할로 이름이 똑같이 또 나오면(계약서에 두 번 나오는 임차인 등) 같은 사람으로 묶는다. 한쪽에 생년월일이 없어도 묶고, 둘 다 있는데 다르면 묶지 않는다. 역할이나 서류가 다르면 아래 표대로 판정한다. (`person-matcher.js`, #165)

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
  - 서로 같다고 답하면(`{ P2: 'P4', P4: 'P2' }`) 둘을 합치고, 원래 순서가 앞인 사람(`P2`)의 `personId`·가명을 남긴다.
  - 없는 `personId`, 자기 자신, `CONFIRMED`인 사람의 답은 `INVALID_INPUT`으로 **실패** → PART 5는 이전 상태를 유지한다.
- PART 5는 합친 그룹으로 PART 3 `assessRisks(fields, 합친 그룹)`과 PART 4 마스킹(`prepareForAi`)을 다시 계산한다.
  - 이때 `assessRisks()`가 실패하면 `step: 'recheckRisks'`로 멈추고 이전 답·결과를 그대로 둔다. 처음 분석(`'assessRisks'`)과 달리 결과가 화면에 남아 있어서 안내가 다르다. (#126)
- 질문 화면: PART 4 `renderPersonQuestions({ analysis, personGroups, personAnswers, onChange })` → `HTMLElement | null` (slots.js `personQuestions`)
  - 질문은 원래 판정(`analysis.personGroups`) 기준이라 답한 뒤에도 남는다. 후보는 이름이 같거나 비슷하거나(오타 허용) 생년월일이 같은 다른 사람.
  - `onChange(answers 전체)`, 물어볼 사람이 없으면 `null`.
  - 같은 두 사람 질문은 한 번만 보인다 (#171, PART 5 `src/app/person-questions.js`). PART 5가 `buildPersonQuestions()` 결과에서 보일 질문을 골라 `questions`로 넘긴다 (안 넘기면 PART 4가 전부 만든다).
    - 두 사람의 질문은 앞 사람 카드에서만 묻는다. 앞 사람이 다른 후보와 같다고 답했으면 뒤 카드에 다시 보인다.
    - 후보가 다 빠진 뒤 카드는 숨기고, 앞 사람이 모두 "다른 사람"이면 뒤 사람도 "다른 사람"으로 보고 점검한다 (저장하지 않음).
    - 숨긴 카드의 답, 화면에 없는 후보를 가리키는 답(엇갈린 답)은 `recheckPeople()`이 지우고 `personAnswers`로 돌려준다. PART 5는 이것을 저장한다.
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

### 목적별로 보낼 방식과 등기부 요약 (PART 4 → PART 3·5, 지도 교수님 피드백 11/24)

`getSendMode(purpose, documentType)`는 그 목적에서 그 서류를 AI에 어떻게 보낼지 돌려준다. 규칙은 `src/config/masking/send-mode.json`.

| 목적 | 등기부 (`REGISTRY`) | 계약서 (`LEASE_CONTRACT`) |
|---|---|---|
| `FRAUD_CHECK` | `SUMMARY` | `PARTY_SUMMARY` |
| `CLAUSE_EXPLANATION` | `MASKED_TEXT` | `PARTY_SUMMARY` |
| `CONTRACT_EXPLANATION` | `OMIT` | `PARTY_SUMMARY` |

- `SUMMARY`: `buildRegistrySummary()`의 `text`를 maskedText의 그 서류 자리에 넣는다. 원문은 나가지 않는다.
- `PARTY_SUMMARY`: 가린 원문에서 인적사항 칸 줄만 `buildContractPartySummary()`의 요약으로 바꾼다. 본문·특약은 가린 원문 그대로.
- `MASKED_TEXT`: 지금처럼 `applyMaskingPlan()`의 가린 원문. `OMIT`: 보내지 않는다. 설정에 없는 서류 종류는 `MASKED_TEXT`.

`buildRegistrySummary(registryFields, personGroups, legend?, edits?)` → `{ documentId, text, hiddenCount }`

```text
Extracted items from the property register (the original register text is not sent).
Address: 서울특별시 중구
Current owner: [Owner_A]
Previous owners: [PrevOwner_B]
Last ownership transfer: 2024-05-10
Rights and restrictions:
- Mortgage (근저당권): received 2026-08-25, cause 설정계약, max claim 168,000,000 KRW, holder 주식회사가상은행, active
- Provisional seizure (가압류): received 2023-02-06, cause 가압류결정, holder [Holder_1] (an individual), cancelled (말소)
- Seizure (압류): details hidden, check the original register, active
Unconfirmed register records: 1 (could not read what they are, check the original register)
1 item hidden (check the original register)
```

- 개인 이름은 가명. 소유자·이전 소유자는 `personGroups` 가명, 개인 권리자는 `[Holder_1]`부터. 권리자 이름이 소유자와 같아도 생년월일이 없어 같은 가명을 주지 않고 `same name as [Owner_A], not confirmed to be the same person`으로 적는다.
- 회사 이름은 `holderIsCompany === true`이고 회사 낱말(주식회사·은행·신탁·캐피탈, "특별시"·"구청" 같은 분명한 지자체 모양 등)이 있을 때만 그대로, 아니면 가명. 끝이 "구"인 사람 이름("김철구")은 회사로 보지 않는다.
- 지금 소유자가 회사면 회사 이름(`ownerCompanies`)은 넣지 않고 `a company (name not sent)`로 적는다. 같은 회사가 권리자(신탁의 수탁자 등)로 나와도 `the current owner (a company, name not sent)`로 적는다. 이때 회사 형태 표기("(주)" ↔ "주식회사")를 빼고, 4자 이상이면 포함·한 글자 차이(OCR)도 같은 회사로 본다(느슨할수록 더 가린다). 짧은 이름("국")은 완전히 같을 때만.
- 주소는 시·구까지. 사건번호·접수번호는 넣지 않고, 등기원인은 정해진 낱말 목록(설정계약, 매매, 가압류결정 등)에 있는 것만 넣는다(없으면 `not shown`).
- 못 읽은 값, 날짜가 아닌 날짜(연 1900~2099·월 01~12·일 01~31 밖), 0 이하이거나 숫자가 아닌 금액은 `Could not read`. `unknownActiveCount`가 0 이상의 정수가 아니면(없음·`null`·`NaN`·음수) 확인하지 못했다고 적는다.
- `edits`를 주면 사용자가 ④에서 더 가린 글자(`add`)도 요약에서 가린다.
- 요약 줄이 검사에 걸리면 값을 `[hidden]`으로 바꾸고, 그래도 걸리면 권리 줄은 종류와 말소 여부만 남기고(`details hidden`) 그 밖의 줄은 뺀다. 가린 줄 수가 `hiddenCount`다 (화면 알림용).

`buildContractPartySummary({ maskedText, contractFields, personGroups, purpose, legend?, lineBlocks?, registryFields?, document? })` → `{ documentId, text, replaced, lineBlocks? }`

- `maskedText`는 **반드시** `applyMaskingPlan()`의 그 계약서 가린 글(쪽 표시 넣기 전)을 넘긴다. 줄 순서가 PART 2 `linesOf`와 같아서 `contract.personalInfoRange`(한 칸) 또는 `personalInfoRanges`(여러 칸)의 줄을 그대로 바꾼다.
- `document`(그 계약서 DocumentModel)를 주면 가린 글의 줄 수가 서류 줄 수와 같은지 확인한다. 다르면(쪽 표시가 먼저 들어간 글 등) 엉뚱한 줄을 바꾸지 않도록 바꾸지 않는다.
- 첫 칸은 아래 요약으로, 나머지 칸(서명 칸 등)은 `contents hidden` 한 줄로 바꾼다. 범위가 없거나 줄 수가 안 맞으면 바꾸지 않는다(`replaced: false`).
- 사기 점검은 가명과 관계, 조항·계약 설명은 역할만 적는다(이 두 목적은 이름을 `REDACT`해서 본문에도 가명이 없다).
  - 확인 안 된 그룹(`AMBIGUOUS`)은 역할이 합쳐져 있어도 `not confirmed`로 적는다.
  - 임대인·임차인을 못 읽었거나 빈 목록이면 `Could not read`. 예금주만 못 읽음(`null`)은 `Could not read`, 읽었는데 없음(`[]`)은 `none found`로 나눠 적는다.
  - 임대인을 못 읽었으면 예금주는 `the landlord could not be read, so not compared`로 적는다(다르다고 단정하지 않음).
  - 임대인·소유자 회사 이름(`landlordCompanies`, `ownerCompanies`)은 넣지 않는다. `registryFields`를 주면 회사 형태 표기("(주)" ↔ "주식회사")를 뺀 이름이 완전히 같을 때만 `the same company as the owner on the register`, 다르면 단정하지 않고 `the company name does not match the owner on the register (check the original)`로 적는다. `registryFields`를 안 주면 `no register provided, so not compared`.
  - 연결할 때는 `document`와 `registryFields`를 같이 넘긴다. 안 넘기면 줄 수 확인을 건너뛰고 회사 관계를 비교하지 못한다.
- `lineBlocks`를 주면 바꾼 글의 줄 순서에 맞춘 것을 돌려준다(요약 줄은 `null`). `validateMaskedText`의 멈춘 줄 위치에 쓴다.
- 한계: 사용자가 ④에서 칸 안의 값을 보이게(KEEP) 풀어도 그 칸은 요약으로 바뀐다. 확인 화면 미리보기는 요약이 반영된 글(`prepared.maskedText`)을 보여 줘야 한다.

```text
Personal information section of the contract: extracted items (the original lines are not sent).
Landlord: [Owner_A] (same person as the owner on the register)
Tenant: [Tenant_C]
Payment account holder: [AccountHolder_D] (not confirmed whether this is the landlord)
Real estate agent: a section for the agent is present (details hidden)
```

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
| 3 | `buildPrompt({ purpose, riskResults, maskedText, legend, monthlyRent?, registry? })` | 위험 결과, 마스킹 완료 텍스트, 범례, (선택) 등기부 요약 정보 | string |
| 4 | `matchPeople(fields)` | 추출 데이터 | PersonGroup[] |
| 4 | `createMaskingPlan(findings, personGroups, purpose, edits?)` | PiiFinding[], PersonGroup[], 목적, 사용자 수정(8번, 없으면 빈 값) | MaskingPlan |
| 4 | `applyMaskingPlan(documents, plan, findings, personGroups, edits?)` | edits의 `add` 글자도 가린다 | `{ maskedText, legend }` |
| 4 | `validateMaskedText(maskedText, findings, plan, edits?)`  | edits의 `add` 글자도 검사한다 | 남은 개인정보가 있으면 실패 |
| 4 | `getSendMode(purpose, documentType)` | 목적, 서류 종류 | `'SUMMARY'` \| `'PARTY_SUMMARY'` \| `'MASKED_TEXT'` \| `'OMIT'` |
| 4 | `buildRegistrySummary(registryFields, personGroups, legend?, edits?)` | 추출 데이터의 `registry`, 인물 판별 결과, 가명 범례, 사용자 수정 | `{ documentId, text, hiddenCount }` |
| 4 | `buildContractPartySummary({ maskedText, contractFields, personGroups, purpose, legend?, lineBlocks?, registryFields?, document? })` | 계약서 가린 글(쪽 표시 전), 추출 데이터의 `contract`·`registry`, 인물 판별 결과, 목적, 계약서 DocumentModel | `{ documentId, text, replaced, lineBlocks? }` |
| 5 | `exportMaskedPDF(document, plan, { file })` | DocumentModel, MaskingPlan, 원본 파일(없으면 문서 글자로 데모 페이지) | `{ fileName, blob, pageCount }` (글자를 못 읽은 페이지가 있으면 `LOW_CONFIDENCE`) |
| 5 | `prepareForAi(analysis, purpose, edits?)` | 분석 결과, 목적, 사용자 수정 | `{ purpose, maskingPlan, maskedText, legend, prompt }` |
| 5 | `runPipeline({ files, purpose })` | File[], 목적 | 전체 결과 |


