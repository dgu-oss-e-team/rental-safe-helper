import { describe, it, expect } from 'vitest';
import { getRecommendedQuestions, buildPrompt } from '../src/features/risk-check/index.js';
import { MASKING_PURPOSE, RISK_STATUS } from '../src/shared/document-model.js';

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

const mortgage = (status) => [
  {
    ruleId: 'MORTGAGE_EXISTS',
    status,
    title: 'Mortgage (근저당)',
    explanation: 'Test explanation.',
    action: 'Test action.',
  },
];
const mortgageQuestions = (questions) => questions.filter((q) => q.includes('mortgage'));

describe('PART 3 추천 질문: 위험 점검 결과 반영 (#212)', () => {
  it('점검 결과를 안 주면 전체 목록 (이전 동작 유지)', () => {
    const all = getRecommendedQuestions(FRAUD_CHECK);
    expect(mortgageQuestions(all)).toHaveLength(2);
    expect(getRecommendedQuestions(FRAUD_CHECK, undefined)).toEqual(all);
    expect(getRecommendedQuestions(FRAUD_CHECK, null)).toEqual(all);
  });

  it('근저당 NO_FLAG면 근저당 질문 2개를 뺀다', () => {
    const all = getRecommendedQuestions(FRAUD_CHECK);
    const filtered = getRecommendedQuestions(FRAUD_CHECK, mortgage(RISK_STATUS.NO_FLAG));
    expect(mortgageQuestions(filtered)).toHaveLength(0);
    expect(filtered).toHaveLength(all.length - 2);
  });

  it('근저당이 UNVERIFIABLE · CHECK · STOP이면 질문을 남긴다', () => {
    const all = getRecommendedQuestions(FRAUD_CHECK);
    for (const status of [RISK_STATUS.UNVERIFIABLE, RISK_STATUS.CHECK, RISK_STATUS.STOP]) {
      expect(getRecommendedQuestions(FRAUD_CHECK, mortgage(status))).toEqual(all);
    }
  });

  it('근저당 결과가 점검 결과에 없으면(확인하지 못함) 질문을 남긴다', () => {
    const all = getRecommendedQuestions(FRAUD_CHECK);
    expect(getRecommendedQuestions(FRAUD_CHECK, [])).toEqual(all);
    expect(getRecommendedQuestions(FRAUD_CHECK, [{ ruleId: 'OWNER_MISMATCH', status: RISK_STATUS.NO_FLAG }])).toEqual(all);
  });

  it('같은 규칙 결과가 여럿이면 전부 NO_FLAG일 때만 뺀다', () => {
    const mixed = [
      { ruleId: 'MORTGAGE_EXISTS', status: RISK_STATUS.NO_FLAG },
      { ruleId: 'MORTGAGE_EXISTS', status: RISK_STATUS.CHECK },
    ];
    expect(mortgageQuestions(getRecommendedQuestions(FRAUD_CHECK, mixed))).toHaveLength(2);
  });

  it('근저당과 연결되지 않은 질문은 점검 결과와 상관없이 남는다', () => {
    const filtered = getRecommendedQuestions(FRAUD_CHECK, mortgage(RISK_STATUS.NO_FLAG));
    expect(filtered[0]).toMatch(/^Based on the check results/);
    expect(filtered.some((q) => q.startsWith('Are there any verbal promises'))).toBe(true);
  });

  it('다른 목적은 점검 결과가 있어도 질문이 그대로다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, CONTRACT_EXPLANATION]) {
      expect(getRecommendedQuestions(purpose, mortgage(RISK_STATUS.NO_FLAG))).toEqual(getRecommendedQuestions(purpose));
    }
  });

  it('질문이 비지 않는다 (최소 3개)', () => {
    const everything = [
      { ruleId: 'MORTGAGE_EXISTS', status: RISK_STATUS.NO_FLAG },
      { ruleId: 'OWNER_MISMATCH', status: RISK_STATUS.NO_FLAG },
    ];
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      expect(getRecommendedQuestions(purpose, everything).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('알 수 없는 목적이면 점검 결과가 있어도 null', () => {
    expect(getRecommendedQuestions('UNKNOWN', mortgage(RISK_STATUS.NO_FLAG))).toBeNull();
  });

  it('돌려받은 목록을 고쳐도 원래 질문은 바뀌지 않는다', () => {
    const q = getRecommendedQuestions(FRAUD_CHECK, mortgage(RISK_STATUS.NO_FLAG));
    q.push('hacked');
    expect(getRecommendedQuestions(FRAUD_CHECK, mortgage(RISK_STATUS.NO_FLAG))).not.toContain('hacked');
  });

  it('프롬프트: 근저당 NO_FLAG면 근저당 질문이 빠지고, CHECK면 들어간다', () => {
    const build = (riskResults) =>
      buildPrompt({ purpose: FRAUD_CHECK, riskResults, maskedText: { DOC: 'text' }, legend: {} }).data;
    const questionPart = (p) => p.slice(p.indexOf('## Questions'));
    expect(questionPart(build(mortgage(RISK_STATUS.NO_FLAG)))).not.toContain('mortgage (근저당)');
    expect(questionPart(build(mortgage(RISK_STATUS.CHECK)))).toContain('mortgage (근저당)');
  });
});

const hasJeonse = (qs) => qs.some((q) => q.includes('전세보증금반환보증'));
const hasRentalGuarantee = (qs) => qs.some((q) => q.includes('rental deposit guarantee'));
const hasMoveInReport = (qs) => qs.some((q) => q.includes('report my move-in'));

describe('PART 3 추천 질문: 월세 계약 (#279)', () => {
  it('월세 > 0이면 전세 보증 질문이 빠지고 임대보증금·전입신고 질문이 들어간다', () => {
    const qs = getRecommendedQuestions(FRAUD_CHECK, undefined, { monthlyRent: 300000 });
    expect(hasJeonse(qs)).toBe(false);
    expect(hasRentalGuarantee(qs)).toBe(true);
    expect(hasMoveInReport(qs)).toBe(true);
  });

  it.each([[0], [null], [undefined], [NaN], [-1], ['300000']])(
    '월세 값이 %s면 기존 질문 그대로',
    (monthlyRent) => {
      const qs = getRecommendedQuestions(FRAUD_CHECK, undefined, { monthlyRent });
      expect(qs).toEqual(getRecommendedQuestions(FRAUD_CHECK));
      expect(hasJeonse(qs)).toBe(true);
      expect(hasRentalGuarantee(qs)).toBe(false);
    },
  );

  it('옵션을 안 주거나 빈 객체여도 기존 질문 그대로', () => {
    const all = getRecommendedQuestions(FRAUD_CHECK);
    expect(getRecommendedQuestions(FRAUD_CHECK, undefined, {})).toEqual(all);
    expect(getRecommendedQuestions(FRAUD_CHECK, [], undefined)).toEqual(all);
  });

  it('다른 두 목적은 월세 여부와 상관없이 그대로', () => {
    for (const purpose of [CLAUSE_EXPLANATION, CONTRACT_EXPLANATION]) {
      expect(getRecommendedQuestions(purpose, undefined, { monthlyRent: 300000 })).toEqual(
        getRecommendedQuestions(purpose),
      );
    }
  });

  it('세 목적 모두 월세 여부와 상관없이 최소 3개 이상', () => {
    const everything = [
      { ruleId: 'MORTGAGE_EXISTS', status: RISK_STATUS.NO_FLAG },
      { ruleId: 'OWNER_MISMATCH', status: RISK_STATUS.NO_FLAG },
    ];
    for (const monthlyRent of [undefined, 0, 300000]) {
      for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
        expect(getRecommendedQuestions(purpose, everything, { monthlyRent }).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('월세 질문에 가명·이름·숫자가 없다', () => {
    const qs = getRecommendedQuestions(FRAUD_CHECK, undefined, { monthlyRent: 300000 });
    const added = qs.filter((q) => q.includes('rental deposit guarantee') || q.includes('report my move-in'));
    expect(added).toHaveLength(2);
    for (const q of added) {
      expect(q).not.toMatch(/\[[A-Za-z]+_[A-Z]\]/);
      expect(q).not.toMatch(/\d/);
    }
  });

  it('프롬프트: monthlyRent가 있으면 월세 질문, 없으면 기존 질문', () => {
    const base = { purpose: FRAUD_CHECK, riskResults: [], maskedText: { DOC_1: 'text' }, legend: {} };
    const monthly = buildPrompt({ ...base, monthlyRent: 300000 });
    const plain = buildPrompt(base);
    expect(monthly.ok && plain.ok).toBe(true);
    expect(monthly.data).toContain('rental deposit guarantee');
    expect(monthly.data).not.toContain('전세보증금반환보증');
    expect(plain.data).toContain('전세보증금반환보증');
  });
});
