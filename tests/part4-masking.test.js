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

  it('주소는 시·구(동)까지만 남기고 번지·호수는 지운다', () => {
    expect(coarsenAddress('서울특별시 중구 필동로 00, 101호')).toBe('서울특별시 중구');
    expect(coarsenAddress('경기도 성남시 분당구 정자동 178-1')).toBe('경기도 성남시 분당구 정자동');
    expect(coarsenAddress('서울특별시 중구 필동2가 123')).toBe('서울특별시 중구 필동2가');
    expect(coarsenAddress('경기도 화성시 봉담읍 와우리 12')).toBe('경기도 화성시 봉담읍');
  });

  it('시·도 줄임말도 인정한다 (person-labels.json addressRegions)', () => {
    expect(coarsenAddress('서울 중구 필동로 00')).toBe('서울 중구');
    expect(coarsenAddress('경기 수원시 팔달구 인계동 1')).toBe('경기 수원시 팔달구 인계동');
  });

  it('두 줄 주소(groupId)는 이어 붙여 한 번만 줄이고, 첫 조각에만 넣고 나머지는 가린다', () => {
    const base = findings.find((f) => f.type === PII_TYPE.ADDRESS);
    const pieces = [
      { ...base, id: 'ADDR_P1', value: '경기도 성남시', blockId: 'B1', groupId: 'ADDR_X_1' },
      { ...base, id: 'ADDR_P2', value: '분당구 정자동 178-1,', blockId: 'B2', groupId: 'ADDR_X_1' },
      { ...base, id: 'ADDR_P3', value: '101동 1001호', blockId: 'B3', groupId: 'ADDR_X_1' },
    ];
    const plan = createMaskingPlan(pieces, mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(plan.items.map((i) => [i.action, i.replacement])).toEqual([
      [MASKING_ACTION.REPLACE, '경기도 성남시 분당구 정자동'],
      [MASKING_ACTION.REDACT, '[REDACTED]'],
      [MASKING_ACTION.REDACT, '[REDACTED]'],
    ]);
    // PART 5가 조각마다 상자를 그릴 수 있게 모든 조각이 계획에 들어 있어야 한다
    expect(plan.items.map((i) => i.findingId)).toEqual(['ADDR_P1', 'ADDR_P2', 'ADDR_P3']);
  });

  it('두 줄 주소 조각이 줄인 주소 안에 들어 있어도 검사에서 멈추지 않는다', () => {
    const base = findings.find((f) => f.type === PII_TYPE.ADDRESS);
    const doc = {
      documentId: base.documentId,
      pages: [{ pageIndex: 0, blocks: [
        { blockId: 'B1', text: '소재지 서울특별시' },
        { blockId: 'B2', text: '중구 필동로 00' },
      ] }],
    };
    const pieces = [
      { ...base, id: 'ADDR_P1', value: '서울특별시', blockId: 'B1', groupId: 'ADDR_X_2' },
      { ...base, id: 'ADDR_P2', value: '중구 필동로 00', blockId: 'B2', groupId: 'ADDR_X_2' },
    ];
    const plan = createMaskingPlan(pieces, mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const masked = applyMaskingPlan([doc], plan, pieces, mockPersonGroups).data;
    expect(masked.maskedText[base.documentId]).toBe('소재지 서울특별시 중구\n[REDACTED]');
    expect(validateMaskedText(masked.maskedText, pieces, plan).ok).toBe(true);
  });

  it('줄인 주소 밖에 원래 번지가 남아 있으면 검사에서 걸린다', () => {
    const base = findings.find((f) => f.type === PII_TYPE.ADDRESS);
    const plan = createMaskingPlan([base], mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    const leakedText = { [base.documentId]: `소재지 ${base.value}` };
    expect(validateMaskedText(leakedText, [base], plan).ok).toBe(false);
  });
  it('도로명 주소 괄호 안의 동 이름도 살린다', () => {
    expect(coarsenAddress('경기도 성남시 분당구 불정로 6 (정자동)')).toBe('경기도 성남시 분당구 정자동');
  });

  it('아파트 동 번호(101동)는 남기지 않는다', () => {
    expect(coarsenAddress('서울특별시 중구 101동 202호')).toBe('서울특별시 중구');
    expect(coarsenAddress('서울특별시 강남구 래미안101동 1001호')).toBe('서울특별시 강남구');
    expect(coarsenAddress('서울특별시 강남구 역삼1동 123')).toBe('서울특별시 강남구 역삼1동');
  });

  it('시·도를 못 찾으면 빈 문자열 → 마스킹 계획에서 통째로 가림', () => {
    expect(coarsenAddress('필동로 00, 101호')).toBe('');
    const weird = [{ ...findings.find((f) => f.type === PII_TYPE.ADDRESS), value: '필동로 00, 101호' }];
    const plan = createMaskingPlan(weird, mockPersonGroups, MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(plan.items[0].action).toBe(MASKING_ACTION.REDACT);
  });

  it('조항 설명과 계약 설명은 개인정보 처리 규칙이 같다 (최종 제안서 표 기준, 차이는 프롬프트에서)', () => {
    const clause = createMaskingPlan(findings, mockPersonGroups, MASKING_PURPOSE.CLAUSE_EXPLANATION).data;
    const contract = createMaskingPlan(findings, mockPersonGroups, MASKING_PURPOSE.CONTRACT_EXPLANATION).data;
    expect(clause.items).toEqual(contract.items);
  });

  it('알 수 없는 목적은 오류', () => {
    expect(createMaskingPlan(findings, mockPersonGroups, 'WHATEVER').ok).toBe(false);
  });

  // TODO(PART 4): matchPeople() 실제 판정 테스트 (OCR 오타 "김철슈", 생년월일 한쪽만 있는 경우)
});
