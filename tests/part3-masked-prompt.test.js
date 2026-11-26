// PART 3 (#106): 마스킹 완료 자료만 AI 프롬프트에 들어간다 / assessRisks() 전체 실패 / HUG 대조 추천 질문
// 이미 있는 검사(part3-prompt.test.js의 evidence·실제 이름·생년월일, part3-assess-risks.test.js의 규칙별 UNVERIFIABLE)는
// 다시 쓰지 않고, 빠진 부분(주소·계좌번호·전화번호·특약 원문, 전체 실패)만 확인한다.
// 가상 데이터만 사용한다. (src/shared/mock-data.js의 가짜 값)
import { describe, it, expect, vi } from 'vitest';
import { ERROR_CODE, MASKING_PURPOSE, RISK_STATUS } from '../src/shared/document-model.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { errorHelp } from '../src/app/error-help.js';

// assessRisks()가 실패하는 경우를 만들려고 원래 함수를 감싼다 (평소 동작은 그대로)
vi.mock('../src/features/risk-check/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, assessRisks: vi.fn(original.assessRisks) };
});

const { assessRisks, buildPrompt, getRecommendedQuestions } = await import('../src/features/risk-check/index.js');
const { analyzeDocuments } = await import('../src/app/pipeline.js');

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

// ---------- 가상 데이터: PART 4가 만들어 주는 "마스킹 완료 텍스트"와 "역할 범례"의 공통 형식 ----------

/** 이름과 계좌번호가 들어 있는 특약 원문 (가상) */
const NAMED_TERM = '임대인 김철수는 월세를 현금으로 지급받으며 입금 계좌 000-000000-00000 으로 보낸다.';
/** 위 특약을 PART 4가 가린 모습 */
const MASKED_TERM = '임대인 [Landlord_B]는 월세를 현금으로 지급받으며 입금 계좌 [REDACTED] 으로 보낸다.';

const MASKED_TEXT = {
  DOC_REGISTRY: '소유자 [Owner_A]\n소재지 [REDACTED]\n고유번호 [REDACTED]',
  DOC_LEASE: [
    '소재지 [REDACTED]',
    '임대인 [Landlord_B] [REDACTED]',
    '연락처 [REDACTED]',
    '입금 계좌 [REDACTED] 예금주 [AccountHolder_D]',
    `특약사항: ${MASKED_TERM}`,
  ].join('\n'),
};

const LEGEND = {
  '[Owner_A]': 'owner on the register',
  '[Landlord_B]': 'landlord on the contract',
  '[AccountHolder_D]': 'account holder',
};

/** 프롬프트에 절대 들어가면 안 되는 원본 값 (mock-data.js의 가짜 값) */
const SECRETS = [
  '김철수',
  'NGUYEN VAN A',
  '서울특별시 중구 필동로 00, 101호',
  '필동로',
  '000-000000-00000',
  '010-0000-0000',
  '0000-0000-000000',
  '800101',
  '750315',
  '990505',
  '임대인 김철수',
  NAMED_TERM,
];

/** 이름이 든 특약이 있는 점검 결과 */
const riskResultsWithNamedTerm = () => {
  const fields = structuredClone(mockExtractedFields);
  fields.contract.specialTerms = [NAMED_TERM];
  const r = assessRisks(fields, structuredClone(mockPersonGroups));
  expect(r.ok).toBe(true);
  return r.data;
};

const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

describe('PART 3 프롬프트: PART 4 마스킹 완료 텍스트·역할 범례 연결', () => {
  it('마스킹 완료 텍스트와 역할 범례가 그대로 프롬프트에 들어간다', () => {
    const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: riskResultsWithNamedTerm(), maskedText: MASKED_TEXT, legend: LEGEND });
    expect(p.ok).toBe(true);
    expect(p.data).toContain('## Role legend');
    for (const [alias, meaning] of Object.entries(LEGEND)) expect(p.data).toContain(`- ${alias} = ${meaning}`);
    expect(p.data).toContain('## Documents (masked)');
    expect(p.data).toContain('### DOC_REGISTRY');
    expect(p.data).toContain('### DOC_LEASE');
    expect(p.data).toContain(MASKED_TERM);
  });

  it.each([FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION])(
    '%s: 프롬프트에 원본 이름·주소·계좌번호·전화번호·등기 고유번호·특약 원문이 없다',
    (purpose) => {
      const p = buildPrompt({ purpose, riskResults: riskResultsWithNamedTerm(), maskedText: MASKED_TEXT, legend: LEGEND });
      expect(p.ok).toBe(true);
      for (const secret of SECRETS) expect(p.data).not.toContain(secret);
    },
  );

  it('이름이 든 특약 원문은 화면 근거 칸(evidence)에만 있고, 프롬프트에는 걸린 문구 종류만 나온다', () => {
    const results = riskResultsWithNamedTerm();
    const special = results.find((r) => r.ruleId === 'RISKY_SPECIAL_TERM');
    expect(special?.status).toBe(RISK_STATUS.CHECK);
    // 화면용 근거에는 원문이 있다
    expect(special?.evidence?.right.value).toBe(`Special term 1: ${NAMED_TERM}`);

    const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: results, maskedText: MASKED_TEXT, legend: LEGEND });
    expect(p.data).not.toContain(special.evidence.right.value);
    expect(p.data).toContain('Special terms check');
    expect(p.data).toContain('Cash payment');
  });

  it('위험 점검 설명에 쓰인 가명 중 범례에 없는 것(가림을 해제한 사람)은 역할 이름으로 바뀐다', () => {
    const legendWithoutLandlord = { '[Owner_A]': LEGEND['[Owner_A]'] };
    const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: riskResultsWithNamedTerm(), maskedText: MASKED_TEXT, legend: legendWithoutLandlord });
    const checkResults = p.data.split('## Documents (masked)')[0];
    expect(checkResults).not.toContain('[Landlord_B]');
    expect(checkResults).not.toContain('[AccountHolder_D]');
  });

  it('마스킹 완료 텍스트가 없으면 프롬프트를 만들지 않는다 (원본으로 대신하지 않는다)', () => {
    for (const maskedText of [undefined, null, {}]) {
      const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: riskResultsWithNamedTerm(), maskedText, legend: LEGEND });
      expect(p.ok).toBe(false);
      expect(p.error.code).toBe(ERROR_CODE.MISSING_REQUIRED_FIELD);
      for (const secret of SECRETS) expect(JSON.stringify(p.error)).not.toContain(secret);
    }
  });
});

describe('PART 3 assessRisks() 전체 실패 (ok: false)', () => {
  it('입력이 없거나 형식이 틀리면 ok:false, INVALID_INPUT이고 결과 데이터는 없다', () => {
    const fields = structuredClone(mockExtractedFields);
    const failures = [
      assessRisks(null, structuredClone(mockPersonGroups)),
      assessRisks(undefined, undefined),
      assessRisks(fields, null),
      assessRisks(fields, 'P1'),
    ];
    for (const r of failures) {
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe(ERROR_CODE.INVALID_INPUT);
      expect(r.data).toBeUndefined();
      // 오류 메시지에 개인정보가 없다
      for (const secret of SECRETS) expect(JSON.stringify(r.error)).not.toContain(secret);
    }
  });

  it('화면: 실패하면 파이프라인이 \'assessRisks\' 단계에서 멈추고, 점검 결과 없이 결과 화면으로 넘어가지 않는다', async () => {
    vi.mocked(assessRisks).mockReturnValueOnce({ ok: false, error: { code: ERROR_CODE.INVALID_INPUT, message: 'Risk rules could not be loaded.' } });
    const r = await analyzeDocuments({ files: sampleFiles() });
    expect(r.ok).toBe(false);
    expect(r.step).toBe('assessRisks');
    expect(r.data).toBeUndefined(); // analysis.riskResults가 빈 배열로 만들어져 "문제 없음"처럼 보이는 일이 없다
    expect(r.error.code).toBe(ERROR_CODE.INVALID_INPUT);

    // 다음 분석은 정상으로 돌아온다
    const again = await analyzeDocuments({ files: sampleFiles() });
    expect(again.ok).toBe(true);
    expect(again.data.riskResults.length).toBeGreaterThan(0);
  });

  it('화면: 오류 안내가 나오고, 안전하다는 뜻으로 읽히지 않는다', () => {
    const help = errorHelp({ step: 'assessRisks', code: ERROR_CODE.INVALID_INPUT });
    expect(help.title.length).toBeGreaterThan(5);
    expect(help.help.length).toBeGreaterThan(5);
    const text = `${help.title} ${help.help}`;
    // "This does not mean there are no warning signs"처럼 안전하다는 말을 부정하는 문장은 허용한다.
    // 그 문장을 뺀 나머지에 "safe / no risk / no warning" 같은 안전 단서가 없어야 한다.
    const withoutDenials = text.replace(/[^.!?]*\b(?:does not|doesn't|do not|don't|cannot|can't) mean\b[^.!?]*[.!?]?/gi, '');
    expect(withoutDenials).not.toMatch(/\b(safe|no risk|no warning)\b/i);
  });

  it('프롬프트: 점검 결과가 없으면(undefined 또는 빈 배열) 점검 결과 칸을 만들지 않고, 오류도 아니다', () => {
    for (const riskResults of [undefined, []]) {
      const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults, maskedText: MASKED_TEXT, legend: LEGEND });
      expect(p.ok).toBe(true);
      expect(p.data).not.toContain('## Automatic check results');
      expect(p.data).not.toContain('NO FLAG');
      expect(p.data).toContain('## Documents (masked)');
      for (const secret of SECRETS) expect(p.data).not.toContain(secret);
    }
  });
});

describe('PART 3 추천 질문: HUG 안내 자료 대조 (#106)', () => {
  const VERBAL =
    'Are there any verbal promises from the landlord (for example repairs or new wallpaper) that I should write into the special terms?';

  it('구두 약속을 특약에 적을지 묻는 질문이 사기 위험 확인 목적에 있고, 프롬프트에도 들어간다', () => {
    expect(getRecommendedQuestions(FRAUD_CHECK)).toContain(VERBAL);
    const p = buildPrompt({ purpose: FRAUD_CHECK, riskResults: [], maskedText: MASKED_TEXT, legend: LEGEND });
    expect(p.data).toContain(`- ${VERBAL}`);
  });

  it('질문에는 가명·이름이 없고, 목적마다 질문이 다르다', () => {
    const sets = [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION].map((purpose) => {
      const questions = getRecommendedQuestions(purpose);
      for (const q of questions) {
        expect(q).not.toMatch(/\[[A-Za-z]+_[A-Z]\]/);
        for (const secret of SECRETS) expect(q).not.toContain(secret);
      }
      return questions.join('|');
    });
    expect(new Set(sets).size).toBe(3);
  });
});