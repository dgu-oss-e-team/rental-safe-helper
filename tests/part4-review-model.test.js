import { describe, it, expect } from 'vitest';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { buildReviewRows, setRowShown, addSelection, removeAdd, nextUserId } from '../src/features/masking/review-model.js';
import {
  mockRegistryDocument,
  mockLeaseDocument,
  mockRegistryFindings,
  mockLeaseFindings,
  mockPersonGroups,
} from '../src/shared/mock-data.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const findings = [...mockRegistryFindings, ...mockLeaseFindings];
const FRAUD = MASKING_PURPOSE.FRAUD_CHECK;

/** 마스킹 계획을 만들고 확인 화면 목록까지 */
const rowsFor = (edits, groups = mockPersonGroups, list = findings, purpose = FRAUD) => {
  const plan = createMaskingPlan(list, groups, purpose, edits).data;
  return buildReviewRows({ findings: list, personGroups: groups, plan });
};
const rowOf = (rows, findingId) => rows.find((r) => r.findingIds.includes(findingId));

describe('PART 4 확인 화면 목록 (review-model)', () => {
  it('탐지 결과마다 한 줄, 같은 사람의 이름은 한 줄로 묶는다', () => {
    const groups = [
      { personId: 'P1', alias: '[Owner_A]', roles: ['OWNER', 'LANDLORD'], findingIds: ['PII_R03', 'PII_L02'], status: 'CONFIRMED' },
      { personId: 'P2', alias: '[Tenant_B]', roles: ['TENANT'], findingIds: ['PII_L04'], status: 'CONFIRMED' },
      { personId: 'P3', alias: '[AccountHolder_C]', roles: ['ACCOUNT_HOLDER'], findingIds: ['PII_L08'], status: 'AMBIGUOUS' },
    ];
    const rows = rowsFor(undefined, groups);
    expect(rowOf(rows, 'PII_R03').findingIds).toEqual(['PII_R03', 'PII_L02']);
    expect(rows).toHaveLength(findings.length - 1);
  });

  it('두 줄 주소는 같은 groupId 조각이 한 줄로 묶인다', () => {
    const base = findings.find((f) => f.type === PII_TYPE.ADDRESS);
    const pieces = [
      { ...base, id: 'A1', value: '서울특별시 중구', blockId: 'B1', groupId: 'G1' },
      { ...base, id: 'A2', value: '필동로 00', blockId: 'B2', groupId: 'G1' },
    ];
    const rows = rowsFor(undefined, [], pieces);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ findingIds: ['A1', 'A2'], result: 'PARTIAL', resultText: '서울특별시 중구' });
  });

  it('AI에게 어떻게 보이는지 표시한다 (가명 / 일부만 / 가림)', () => {
    const rows = rowsFor(undefined);
    expect(rowOf(rows, 'PII_L02')).toMatchObject({ result: 'ALIAS', resultText: '[Landlord_B]' });
    expect(rowOf(rows, 'PII_R02')).toMatchObject({ result: 'PARTIAL', resultText: '서울특별시 중구' });
    expect(rowOf(rows, 'PII_R04')).toMatchObject({ result: 'HIDDEN' });
  });

  it('주민·외국인등록번호, 전화번호, 계좌번호 줄은 잠겨 있다', () => {
    const rows = rowsFor(undefined);
    for (const id of ['PII_R04', 'PII_L03', 'PII_L05', 'PII_L06', 'PII_L07']) expect(rowOf(rows, id).locked).toBe(true);
    expect(rowOf(rows, 'PII_L02').locked).toBe(false);
  });

  it('원본 글자와 나온 서류를 보여 준다 (같은 글자는 한 번만)', () => {
    const row = rowOf(rowsFor(undefined), 'PII_L02');
    expect(row.values).toEqual(['김철수']);
    expect(row.documentIds).toEqual(['DOC_LEASE']);
  });
});

describe('PART 4 확인 화면 체크 → edits (setRowShown)', () => {
  it('"보여 주기"를 켜면 그 줄의 findingId가 remove에 들어가고, 화면에 해제로 보인다', () => {
    const row = rowOf(rowsFor(undefined), 'PII_L04');
    const edits = setRowShown({ remove: [], add: [] }, row, true);
    expect(edits.remove).toEqual(['PII_L04']);
    expect(rowOf(rowsFor(edits), 'PII_L04')).toMatchObject({ shown: true, result: 'SHOWN' });
  });

  it('끄면 remove에서 빠진다', () => {
    const row = rowOf(rowsFor(undefined), 'PII_L04');
    expect(setRowShown({ remove: ['PII_L04', 'X'], add: [] }, row, false).remove).toEqual(['X']);
  });

  it('잠긴 줄은 바꾸지 않는다', () => {
    const row = rowOf(rowsFor(undefined), 'PII_R04');
    expect(setRowShown({ remove: [], add: [] }, row, true).remove).toEqual([]);
  });

  it('add는 그대로 두고, 원래 edits 객체는 바꾸지 않는다', () => {
    const before = { remove: [], add: [{ id: 'USER_001', value: 'x' }] };
    const row = rowOf(rowsFor(undefined), 'PII_L04');
    const after = setRowShown(before, row, true);
    expect(after.add).toEqual(before.add);
    expect(before.remove).toEqual([]);
  });
});
describe('PART 4 미리보기에서 더 가리기 (addSelection / removeAdd)', () => {
  const block = mockLeaseDocument.pages[0].blocks.find((b) => b.blockId === 'L_008');
  const pick = (value, extra = {}) => ({
    documentId: 'DOC_LEASE',
    blockId: 'L_008',
    pageIndex: 0,
    bbox: block.bbox,
    value,
    ...extra,
  });

  it('고른 글자를 add에 넣는다 (id, block 위치 포함, 앞뒤 공백 제거)', () => {
    const r = addSelection({ remove: ['X'], add: [] }, pick('  현금으로 '));
    expect(r.ok).toBe(true);
    expect(r.edits).toEqual({
      remove: ['X'],
      add: [{ id: 'USER_001', documentId: 'DOC_LEASE', blockId: 'L_008', value: '현금으로', pageIndex: 0, bbox: block.bbox }],
    });
  });

  it('넣은 글자는 마스킹 계획·AI 글·검사까지 그대로 이어진다', () => {
    const { edits } = addSelection(undefined, pick('현금으로'));
    const plan = createMaskingPlan(findings, mockPersonGroups, FRAUD, edits);
    expect(plan.ok).toBe(true);
    const masked = applyMaskingPlan([mockRegistryDocument, mockLeaseDocument], plan.data, findings, mockPersonGroups, edits).data;
    expect(masked.maskedText.DOC_LEASE).not.toContain('현금으로');
    expect(validateMaskedText(masked.maskedText, findings, plan.data, edits).ok).toBe(true);
  });

  it('빈 글자, 이미 가려진 [REDACTED]만 고른 경우, 같은 줄의 같은 글자는 넣지 않는다', () => {
    expect(addSelection(undefined, pick('   '))).toEqual({ ok: false, reason: 'EMPTY' });
    expect(addSelection(undefined, pick('[REDACTED]'))).toEqual({ ok: false, reason: 'ALREADY_HIDDEN' });
    const once = addSelection(undefined, pick('현금으로')).edits;
    expect(addSelection(once, pick('현금으로'))).toEqual({ ok: false, reason: 'DUPLICATE' });
  });

  it('id는 겹치지 않게 늘어난다 (중간에 취소해도)', () => {
    let edits = addSelection(undefined, pick('월세는')).edits;
    edits = addSelection(edits, pick('현금으로')).edits;
    edits = removeAdd(edits, 'USER_001');
    edits = addSelection(edits, pick('지급한다')).edits;
    expect(edits.add.map((a) => a.id)).toEqual(['USER_002', 'USER_003']);
    expect(nextUserId([])).toBe('USER_001');
  });

  it('취소하면 그 항목만 빠지고 remove는 그대로, 원래 edits는 바꾸지 않는다', () => {
    const before = addSelection({ remove: ['X'], add: [] }, pick('현금으로')).edits;
    const after = removeAdd(before, 'USER_001');
    expect(after).toEqual({ remove: ['X'], add: [] });
    expect(before.add).toHaveLength(1);
  });
});
