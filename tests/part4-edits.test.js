import { describe, it, expect } from 'vitest';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import {
  mockRegistryDocument,
  mockLeaseDocument,
  mockRegistryFindings,
  mockLeaseFindings,
  mockPersonGroups,
} from '../src/shared/mock-data.js';
import { MASKING_PURPOSE, MASKING_ACTION, PII_TYPE, ERROR_CODE } from '../src/shared/document-model.js';

const documents = [mockRegistryDocument, mockLeaseDocument];
const findings = [...mockRegistryFindings, ...mockLeaseFindings];
const FRAUD = MASKING_PURPOSE.FRAUD_CHECK;

/** 계획에서 findingId의 처리 방식 */
const actionOf = (plan, id) => plan.items.find((i) => i.findingId === id)?.action;
/** 마스킹 → 적용 → 검사를 한 번에 */
const runAll = (edits, groups = mockPersonGroups) => {
  const plan = createMaskingPlan(findings, groups, FRAUD, edits).data;
  const masked = applyMaskingPlan(documents, plan, findings, groups, edits).data;
  const check = validateMaskedText(masked.maskedText, findings, plan, edits);
  return { plan, masked, check };
};

describe('PART 4 사용자 수정 edits', () => {
  it('edits가 없거나 비어 있으면 지금과 결과가 같다', () => {
    const before = createMaskingPlan(findings, mockPersonGroups, FRAUD).data;
    const empty = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: [], add: [] }).data;
    expect(empty).toEqual(before);
  });

  describe('remove (해제)', () => {
    it('해제한 항목은 KEEP이 되고 원래 글자가 보인다', () => {
      const { plan, masked, check } = runAll({ remove: ['PII_L04'], add: [] }); // 임차인 이름
      expect(actionOf(plan, 'PII_L04')).toBe(MASKING_ACTION.KEEP);
      expect(masked.maskedText.DOC_LEASE).toContain('NGUYEN VAN A');
      expect(check.ok).toBe(true);
    });

    it('규칙 1: 주민·외국인등록번호, 여권번호, 전화번호, 계좌번호는 해제할 수 없다', () => {
      const ids = findings
        .filter((f) => [PII_TYPE.RESIDENT_ID, PII_TYPE.FOREIGNER_ID, PII_TYPE.PHONE_NUMBER, PII_TYPE.BANK_ACCOUNT].includes(f.type))
        .map((f) => f.id);
      const { plan, check } = runAll({ remove: ids, add: [] });
      for (const id of ids) expect(actionOf(plan, id)).toBe(MASKING_ACTION.REDACT);
      expect(check.ok).toBe(true);
    });

    it('규칙 2: 두 줄 주소는 한 조각만 해제해도 같은 groupId 전체가 해제된다', () => {
      const base = findings.find((f) => f.type === PII_TYPE.ADDRESS);
      const pieces = [
        { ...base, id: 'A1', value: '서울특별시 중구', blockId: 'B1', groupId: 'G1' },
        { ...base, id: 'A2', value: '필동로 00', blockId: 'B2', groupId: 'G1' },
        { ...base, id: 'A3', value: '부산광역시 해운대구 해운대로 1', blockId: 'B3' }, // 다른 주소
      ];
      const plan = createMaskingPlan(pieces, [], FRAUD, { remove: ['A2'], add: [] }).data;
      expect(plan.items.map((i) => i.action)).toEqual([MASKING_ACTION.KEEP, MASKING_ACTION.KEEP, MASKING_ACTION.REPLACE]);
    });

    it('규칙 3: 이름은 같은 사람의 모든 이름이 함께 해제된다', () => {
      // 등기부 소유자와 계약서 임대인이 같은 사람인 경우
      const groups = [
        { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER', 'LANDLORD'], findingIds: ['PII_R03', 'PII_L02'], status: 'CONFIRMED' },
        { personId: 'P2', alias: '[Tenant_B]', roles: ['TENANT'], findingIds: ['PII_L04'], status: 'CONFIRMED' },
        { personId: 'P3', alias: '[AccountHolder_C]', roles: ['ACCOUNT_HOLDER'], findingIds: ['PII_L08'], status: 'AMBIGUOUS' },
      ];
      const plan = createMaskingPlan(findings, groups, FRAUD, { remove: ['PII_L02'], add: [] }).data;
      expect(actionOf(plan, 'PII_R03')).toBe(MASKING_ACTION.KEEP);
      expect(actionOf(plan, 'PII_L02')).toBe(MASKING_ACTION.KEEP);
      // 다른 사람(동명이인 예금주)은 그대로 가린다
      expect(actionOf(plan, 'PII_L08')).toBe(MASKING_ACTION.REPLACE);
    });

    it('해제한 이름과 글자가 같은 동명이인이 가려져 있어도 검사에서 멈추지 않는다', () => {
      // 소유자 김철수(PII_R03)만 해제, 예금주 김철수(PII_L08)는 가명 그대로
      const { masked, check } = runAll({ remove: ['PII_R03'], add: [] });
      expect(masked.maskedText.DOC_LEASE).toContain('[AccountHolder_D]');
      expect(check.ok).toBe(true);
    });

    it('해제한 사람의 가명은 범례에서 빠진다', () => {
      const { masked } = runAll({ remove: ['PII_L04'], add: [] });
      expect(masked.legend['[Tenant_C]']).toBeUndefined();
    });

    it('없는 findingId는 무시한다', () => {
      const plan = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: ['NOPE'], add: [] });
      expect(plan.ok).toBe(true);
    });
  });

  describe('add (더 가리기)', () => {
    const block = mockLeaseDocument.pages[0].blocks.find((b) => b.blockId === 'L_008');
    const word = block.text.split(/\s+/).find((w) => w.length >= 2);
    const add = {
      id: 'USER_001',
      documentId: 'DOC_LEASE',
      blockId: 'L_008',
      value: word,
      pageIndex: 0,
      bbox: { ...block.bbox },
    };

    it('계획 맨 뒤에 REDACT 항목으로 들어간다 (findingId = add의 id)', () => {
      const plan = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: [], add: [add] }).data;
      expect(plan.items.at(-1)).toEqual({
        findingId: 'USER_001',
        action: MASKING_ACTION.REDACT,
        replacement: '[REDACTED]',
        documentId: 'DOC_LEASE',
        pageIndex: 0,
        bbox: block.bbox,
      });
    });

    it('AI로 보내는 글에서 가려지고 검사도 통과한다', () => {
      const { masked, check } = runAll({ remove: [], add: [add] });
      expect(masked.maskedText.DOC_LEASE.split('\n').at(-1)).not.toContain(word);
      expect(check.ok).toBe(true);
    });

    it('add 글자가 남아 있으면 검사에서 걸린다', () => {
      const plan = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: [], add: [add] }).data;
      const leaked = { DOC_LEASE: `특약 ${word}` };
      expect(validateMaskedText(leaked, [], plan, { remove: [], add: [add] }).ok).toBe(false);
    });

    it('PDF 위치(pageIndex, bbox)가 없거나 잘못되면 빼지 않고 실패한다 (PART 5가 이전 상태 유지)', () => {
      const { pageIndex, bbox, ...noPos } = add;
      const cases = [
        noPos,
        { ...add, bbox: { x: 0.9, y: 0.1, width: 0.5, height: 0.03 } }, // 페이지 밖으로 넘어감
        { ...add, pageIndex: -1 },
      ];
      for (const bad of cases) {
        const r = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: [], add: [bad] });
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe(ERROR_CODE.COORDINATE_INVALID);
      }
    });

    it('빈 글자 add는 무시한다', () => {
      const plan = createMaskingPlan(findings, mockPersonGroups, FRAUD, { remove: [], add: [{ ...add, value: '  ' }] }).data;
      expect(plan.items.some((i) => i.findingId === 'USER_001')).toBe(false);
    });
  });
});