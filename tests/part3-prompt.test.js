import { describe, it, expect } from 'vitest';
import { buildPrompt, getRecommendedQuestions, assessRisks } from '../src/features/risk-check/index.js';
import { replaceUnlistedAliases } from '../src/features/risk-check/prompt-builder.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { RISK_STATUS, MASKING_PURPOSE } from '../src/shared/document-model.js';

const { FRAUD_CHECK, CLAUSE_EXPLANATION, CONTRACT_EXPLANATION } = MASKING_PURPOSE;

const risk = (explanation, title = 'Owner and landlord check', extra = {}) => ({
  ruleId: 'OWNER_MISMATCH',
  status: RISK_STATUS.STOP,
  title,
  explanation,
  action: 'A',
  ...extra,
});

const prompt = ({ results, legend, purpose = FRAUD_CHECK }) =>
  buildPrompt({
    purpose,
    riskResults: results,
    maskedText: { DOC_LEASE: '임대인 [REDACTED]' },
    legend,
  });

describe('PART 3 프롬프트: 가림 해제된 가명 처리', () => {
  it('범례에 있는 가명은 그대로 둔다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner, but [Landlord_B] signs.')],
      legend: { '[Owner_A]': 'owner on the register', '[Landlord_B]': 'landlord on the contract' },
    });
    expect(r.data).toContain('[Owner_A] is the registered owner, but [Landlord_B] signs.');
  });

  it('범례에 없는 가명(가림을 해제한 사람)은 역할 이름으로 바꾼다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner, but [Landlord_B] signs.')],
      legend: { '[Owner_A]': 'owner on the register' },
    });
    expect(r.data).toContain('[Owner_A] is the registered owner, but the landlord signs.');
    expect(r.data).not.toContain('[Landlord_B]');
  });

  it('문장 맨 앞의 가명은 대문자로 시작한다', () => {
    const r = prompt({
      results: [risk('[Owner_A] is the registered owner. [Landlord_B] signs.')],
      legend: {},
    });
    expect(r.data).toContain('The owner is the registered owner. The landlord signs.');
  });

  it('같은 역할이 둘 이어지면 복수로 합친다', () => {
    expect(replaceUnlistedAliases('This home has owners ([Owner_A] and [Owner_E]).', {})).toBe(
      'This home has owners (the owners).',
    );
    expect(replaceUnlistedAliases('[AccountHolder_D] and [AccountHolder_F] differ.', {})).toBe(
      'The account holders differ.',
    );
  });

  it('다른 역할 둘은 합치지 않는다', () => {
    expect(replaceUnlistedAliases('[Owner_A] and [Landlord_B] differ.', {})).toBe(
      'The owner and the landlord differ.',
    );
  });

  it('알 수 없는 역할이면 "a person"', () => {
    expect(replaceUnlistedAliases('See [Person_C].', {})).toBe('See a person.');
  });

  it('제목에 있는 가명도 바꾼다', () => {
    const r = prompt({ results: [risk('E', 'Check for [Landlord_B]')], legend: {} });
    expect(r.data).toContain('Check for the landlord');
  });

  it('범례가 아예 없어도(undefined) 오류 없이 모든 가명을 바꾼다', () => {
    const r = prompt({ results: [risk('[Landlord_B] signs.')], legend: undefined });
    expect(r.ok).toBe(true);
    expect(r.data).toContain('The landlord signs.');
  });

  it('가명이 없는 설명은 그대로다', () => {
    expect(replaceUnlistedAliases('A mortgage is registered. KRW 120,000,000.', {})).toBe(
      'A mortgage is registered. KRW 120,000,000.',
    );
  });

  it('실제 점검 결과: 임대인 가림을 해제하면 프롬프트에 [Landlord_B]가 남지 않는다', () => {
    const results = assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups)).data;
    const r = prompt({ results, legend: { '[Owner_A]': 'owner on the register' } });
    expect(r.ok).toBe(true);
    expect(r.data).not.toContain('[Landlord_B]');
    expect(r.data).toContain('[Owner_A] is the registered owner, but the landlord is signing as the landlord.');
  });
});

describe('PART 3 프롬프트: 개인정보', () => {
  it('evidence(화면용 실제 값)는 프롬프트에 들어가지 않는다', () => {
    const evidence = {
      left: { label: 'Registry owner', value: '김철수 (birth 800101)' },
      right: { label: 'Contract landlord', value: '김철수 (birth 750315)' },
    };
    const r = prompt({ results: [risk('[Owner_A] and [Landlord_B] differ.', 'T', { evidence })], legend: {} });
    expect(r.data).not.toContain('김철수');
    expect(r.data).not.toContain('800101');
    expect(r.data).not.toContain('750315');
    expect(r.data).not.toContain('Registry owner');
  });

  it('실제 점검 결과 전체를 넣어도 실제 이름·생년월일이 없다', () => {
    const results = assessRisks(structuredClone(mockExtractedFields), structuredClone(mockPersonGroups)).data;
    const r = prompt({ results, legend: {} });
    for (const secret of ['김철수', 'NGUYEN', '800101', '750315', '990505']) {
      expect(r.data).not.toContain(secret);
    }
  });

  it('위험 점검 결과는 사기 위험 확인 목적에만 넣는다', () => {
    const results = [risk('[Landlord_B] signs.')];
    expect(prompt({ results, legend: {}, purpose: CLAUSE_EXPLANATION }).data).not.toContain('Automatic check results');
    expect(prompt({ results, legend: {}, purpose: CONTRACT_EXPLANATION }).data).not.toContain('Automatic check results');
    expect(prompt({ results, legend: {}, purpose: FRAUD_CHECK }).data).toContain('Automatic check results');
  });
});

describe('PART 3 추천 질문', () => {
  it('세 가지 목적 모두 추천 질문이 나온다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      const questions = getRecommendedQuestions(purpose);
      expect(questions.length).toBeGreaterThan(0);
      const r = prompt({ results: [], legend: {}, purpose });
      expect(r.ok).toBe(true);
      for (const q of questions) expect(r.data).toContain(`- ${q}`);
    }
  });

  it('목적마다 질문이 다르다', () => {
    const sets = [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION].map((p) =>
      getRecommendedQuestions(p).join('|'),
    );
    expect(new Set(sets).size).toBe(3);
  });

  it('알 수 없는 목적이면 null, 프롬프트도 만들지 않는다', () => {
    expect(getRecommendedQuestions('UNKNOWN')).toBeNull();
    expect(prompt({ results: [], legend: {}, purpose: 'UNKNOWN' }).ok).toBe(false);
  });

  it('돌려받은 목록을 고쳐도 원래 질문은 바뀌지 않는다', () => {
    const q = getRecommendedQuestions(FRAUD_CHECK);
    q.push('hacked');
    expect(getRecommendedQuestions(FRAUD_CHECK)).not.toContain('hacked');
  });

  it('질문에는 가명·이름이 없다', () => {
    for (const purpose of [CLAUSE_EXPLANATION, FRAUD_CHECK, CONTRACT_EXPLANATION]) {
      for (const q of getRecommendedQuestions(purpose)) expect(q).not.toMatch(/\[[A-Za-z]+_[A-Z]\]/);
    }
  });
});