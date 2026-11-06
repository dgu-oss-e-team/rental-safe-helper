import { describe, it, expect } from 'vitest';
import { assessRisks, buildPrompt } from '../src/features/risk-check/index.js';
import { mockExtractedFields, mockPersonGroups } from '../src/shared/mock-data.js';
import { RISK_STATUS, MASKING_PURPOSE } from '../src/shared/document-model.js';

describe('PART 3 위험 점검과 프롬프트', () => {
  it('assessRisks()의 상태값은 네 가지 중 하나다', () => {
    const r = assessRisks(mockExtractedFields, mockPersonGroups);
    expect(r.ok).toBe(true);
    for (const risk of r.data) {
      expect(Object.values(RISK_STATUS)).toContain(risk.status);
      expect(risk).toMatchObject({ ruleId: expect.any(String), action: expect.any(String) });
    }
  });

  it('buildPrompt()는 범례·점검 결과를 넣고 영어 답변을 요청한다', () => {
    const r = buildPrompt({
      purpose: MASKING_PURPOSE.FRAUD_CHECK,
      riskResults: [{ ruleId: 'X', status: 'STOP', title: 'T', explanation: 'E', action: 'A' }],
      maskedText: { DOC_LEASE: '임대인 [Landlord_B] [REDACTED]' },
      legend: { '[Landlord_B]': 'landlord on the contract' },
    });
    expect(r.ok).toBe(true);
    expect(r.data).toContain('[Landlord_B] = landlord on the contract');
    expect(r.data.trim().endsWith('Please answer in English.')).toBe(true);
  });

  it('마스킹 텍스트가 없으면 프롬프트를 만들지 않는다', () => {
    const r = buildPrompt({ purpose: MASKING_PURPOSE.FRAUD_CHECK, riskResults: [], maskedText: {}, legend: {} });
    expect(r.ok).toBe(false);
  });

  // TODO(PART 3): 규칙별 (해당 / 해당 아님 / 값 없음 → UNVERIFIABLE) 테스트
});
