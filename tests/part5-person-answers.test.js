// PART 5. "같은 사람인가요?" 답 → 위험 점검·마스킹 다시 계산 (#52, docs/INTERFACES.md 6번)
// 가상 데이터(샘플)만 사용한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { analyzeDocuments, recheckPeople, prepareForAi } from '../src/app/pipeline.js';
import { initialState, currentAnalysis } from '../src/app/app-state.js';
import { MASKING_PURPOSE, RISK_STATUS } from '../src/shared/document-model.js';

const sampleFiles = () => [
  new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
  new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
];

/** @type {any} */
let analysis;
/** 역할로 personId 찾기 */
const idOf = (role) => analysis.personGroups.find((g) => g.roles.includes(role)).personId;
const statusOf = (risks, ruleId) => risks.find((r) => r.ruleId === ruleId)?.status;

beforeAll(async () => {
  analysis = (await analyzeDocuments({ files: sampleFiles() })).data;
});

describe('PART 5 recheckPeople(): 답으로 위험 점검 다시 하기', () => {
  it('샘플에서 예금주는 생년월일이 없어 확인 불가로 시작한다', () => {
    expect(analysis.personGroups.find((g) => g.roles.includes('ACCOUNT_HOLDER')).status).toBe('AMBIGUOUS');
    expect(statusOf(analysis.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).toBe(RISK_STATUS.UNVERIFIABLE);
  });

  it('예금주 = 임대인이라고 답하면 예금주 점검이 NO_FLAG로 바뀌고, 소유자≠임대인 STOP은 그대로다', () => {
    const r = recheckPeople(analysis, { [idOf('ACCOUNT_HOLDER')]: idOf('LANDLORD') });
    expect(r.ok).toBe(true);
    expect(statusOf(r.data.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).toBe(RISK_STATUS.NO_FLAG);
    expect(statusOf(r.data.riskResults, 'OWNER_MISMATCH')).toBe(RISK_STATUS.STOP);
  });

  it('예금주 = 다른 사람이라고 답하면 예금주 점검이 STOP이 된다', () => {
    const r = recheckPeople(analysis, { [idOf('ACCOUNT_HOLDER')]: null });
    expect(statusOf(r.data.riskResults, 'ACCOUNT_HOLDER_MISMATCH')).toBe(RISK_STATUS.STOP);
  });

  it('이미 확인된 사람에 대한 답은 실패하고, 어느 단계에서 멈췄는지 알려준다 (STOP이 근거 없이 사라지지 않게)', () => {
    const r = recheckPeople(analysis, { [idOf('LANDLORD')]: idOf('OWNER') });
    expect(r).toMatchObject({ ok: false, step: 'applyPersonAnswers', error: { code: 'INVALID_INPUT' } });
  });

  it('원래 분석 결과는 바꾸지 않는다 (답을 바꾸면 원래 판정에서 다시 계산)', () => {
    const before = structuredClone(analysis.personGroups);
    recheckPeople(analysis, { [idOf('ACCOUNT_HOLDER')]: idOf('LANDLORD') });
    expect(analysis.personGroups).toEqual(before);
  });
});

describe('PART 5 currentAnalysis(): 답을 반영한 분석으로 마스킹', () => {
  it('답이 없으면 원래 분석 그대로다', () => {
    expect(currentAnalysis({ ...initialState(), analysis })).toBe(analysis);
    expect(currentAnalysis(initialState())).toBeNull();
  });

  it('같은 사람이라고 답하면 가명이 하나로 합쳐진다 (프롬프트 범례에서 예금주 가명이 빠짐)', () => {
    const checked = recheckPeople(analysis, { [idOf('ACCOUNT_HOLDER')]: idOf('LANDLORD') }).data;
    const state = { ...initialState(), analysis, personAnswers: { x: null }, checked };
    const merged = currentAnalysis(state);
    expect(merged.personGroups).toBe(checked.personGroups);
    expect(merged.riskResults).toBe(checked.riskResults);

    const before = prepareForAi(analysis, MASKING_PURPOSE.FRAUD_CHECK).data;
    const after = prepareForAi(merged, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(Object.keys(before.legend)).toContain('[AccountHolder_D]');
    expect(Object.keys(after.legend)).not.toContain('[AccountHolder_D]');
    expect(after.prompt).not.toContain('[AccountHolder_D]');
    // 합쳐도 원본 개인정보는 프롬프트에 남지 않는다
    for (const f of analysis.findings) expect(after.prompt).not.toContain(f.value);
  });

  it('처음 상태에는 답이 없다', () => {
    expect(initialState()).toMatchObject({ personAnswers: {}, checked: null });
  });
});
