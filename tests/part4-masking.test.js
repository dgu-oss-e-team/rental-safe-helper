import { describe, it, expect } from 'vitest';
import {
  createMaskingPlan,
  applyMaskingPlan,
  validateMaskedText,
  coarsenAddress,
} from '../src/features/masking/index.js';
import {
  mockRegistryDocument,
  mockLeaseDocument,
  mockRegistryFindings,
  mockLeaseFindings,
  mockPersonGroups,
} from '../src/shared/mock-data.js';
import { MASKING_PURPOSE, MASKING_ACTION, PII_TYPE } from '../src/shared/document-model.js';

const documents = [mockRegistryDocument, mockLeaseDocument];
const findings = [...mockRegistryFindings, ...mockLeaseFindings];

describe('PART 4 목적 기반 마스킹', () => {
  it('고유식별정보는 모든 목적에서 REDACT', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const plan = createMaskingPlan(findings, mockPersonGroups, purpose).data;
      const ids = findings
        .filter((f) => [PII_TYPE.RESIDENT_ID, PII_TYPE.FOREIGNER_ID, PII_TYPE.PASSPORT_ID].includes(f.type))
        .map((f) => f.id);
      for (const item of plan.items.filter((i) => ids.includes(i.findingId))) {
        expect(item.action).toBe(MASKING_ACTION.REDACT);
      }
    }
  });

  it('사기 위험 확인에서는 동명이인이 서로 다른 가명이 된다', () => {
    const plan = createMaskingPlan(findings, mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const owner = plan.items.find((i) => i.findingId === 'PII_R03');
    const landlord = plan.items.find((i) => i.findingId === 'PII_L02');
    expect(owner.replacement).toBe('[Owner_A]');
    expect(landlord.replacement).toBe('[Landlord_B]');
  });

  it('목적이 다르면 마스킹 결과도 달라진다', () => {
    const fraud = createMaskingPlan(findings, mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const clause = createMaskingPlan(findings, mockPersonGroups, MASKING_PURPOSE.CLAUSE_EXPLANATION).data;
    expect(fraud.items).not.toEqual(clause.items);
  });

  it('모든 목적에서 마스킹 후 원본 개인정보가 남지 않는다', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const plan = createMaskingPlan(findings, mockPersonGroups, purpose).data;
      const masked = applyMaskingPlan(documents, plan, findings, mockPersonGroups).data;
      expect(validateMaskedText(masked.maskedText, findings, plan).ok).toBe(true);
    }
  });

  it('주소는 시·구까지만 남긴다', () => {
    expect(coarsenAddress('서울특별시 중구 필동로 00, 101호')).toBe('서울특별시 중구');
  });

  it('알 수 없는 목적은 오류', () => {
    expect(createMaskingPlan(findings, mockPersonGroups, 'WHATEVER').ok).toBe(false);
  });

  // TODO(PART 4): matchPeople() 실제 판정 테스트 (OCR 오타 "김철슈", 생년월일 한쪽만 있는 경우)
});
