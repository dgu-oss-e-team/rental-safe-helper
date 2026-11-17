// PART 4. 보내기 전 검사: 사용자가 보여 주기로 한 글자(KEEP)는 숫자 비교에서도 새는 것으로 보지 않는다 (#153에서 발견)
import { describe, it, expect } from 'vitest';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.05, width: 0.6, height: 0.03 };
const ADDRESS = '서울특별시 중구 필동로 00, 제1층 제101호'; // 숫자만 "001101" (6자리)

// 실제 등기부처럼 쪽마다 머리글에 같은 주소가 있다 → 같은 값의 탐지 결과가 2개
const doc = {
  documentId: 'DOC_R',
  pages: [0, 1].map((pageIndex) => ({
    pageIndex,
    width: 100,
    height: 100,
    blocks: [{ blockId: `H${pageIndex}`, text: `[건물] ${ADDRESS}`, bbox: BOX, confidence: null }],
  })),
};
const findings = [0, 1].map((pageIndex) => ({
  id: `A${pageIndex}`,
  type: PII_TYPE.ADDRESS,
  value: ADDRESS,
  documentId: 'DOC_R',
  blockId: `H${pageIndex}`,
  pageIndex,
  bbox: BOX,
}));

/** 계획 → 가린 글 → 검사 */
const check = (purpose, edits) => {
  const plan = createMaskingPlan(findings, [], purpose, edits).data;
  const masked = applyMaskingPlan([doc], plan, findings, [], edits).data;
  return { masked, result: validateMaskedText(masked.maskedText, findings, plan, edits) };
};

describe('PART 4 보내기 전 검사: 보여 주기로 한 글자의 숫자', () => {
  it('쪽마다 같은 주소가 있을 때 하나를 보여 줘도(Show) 검사에서 멈추지 않는다', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const { masked, result } = check(purpose, { remove: ['A0'], add: [] });
      expect(masked.maskedText.DOC_R.split('\n')[0], purpose).toContain(ADDRESS); // 보여 주기로 한 첫 쪽
      expect(result.ok, purpose).toBe(true);
    }
  });

  it('보여 주기로 한 자리 밖에 숫자만 남아 있으면 지금처럼 멈춘다', () => {
    const { masked } = check(MASKING_PURPOSE.FRAUD_CHECK, { remove: ['A0'], add: [] });
    // 둘째 쪽 머리글 뒤에 같은 번호가 하이픈만 바뀐 채로 남았다고 가정
    const leaked = { DOC_R: `${masked.maskedText.DOC_R} 00-1101` };
    const plan = createMaskingPlan(findings, [], MASKING_PURPOSE.FRAUD_CHECK, { remove: ['A0'], add: [] }).data;
    const r = validateMaskedText(leaked, findings, plan, { remove: ['A0'], add: [] });
    expect(r.ok).toBe(false);
    expect(r.error.message).not.toContain('101');
  });
});
