// PART 4. 보내기 전 검사: 짧은 숫자 주소 조각을 다른 숫자 안에서 찾지 않기 (#204 리뷰)
// 지번 같은 주소 조각 "740", "246-8"을 글자 그대로 찾으면 "제1740호", "금740,000,000원", "246-89" 안에서도 잡혀
// 개인정보가 새지 않았는데 보내기를 멈췄다. 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { createMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.6, height: 0.03 };
const piece = (id, value) => ({ id, type: PII_TYPE.ADDRESS, value, documentId: 'D', blockId: 'B1', pageIndex: 0, bbox: BOX });
/** 주소 조각 하나를 가린 계획으로, 가린 글 text를 검사한다 */
const check = (value, text) => {
  const findings = [piece('A1', value)];
  const plan = createMaskingPlan(findings, [], MASKING_PURPOSE.FRAUD_CHECK).data;
  return validateMaskedText({ D: text }, findings, plan).ok;
};

describe('PART 4 보내기 전 검사의 숫자 경계', () => {
  it('다른 숫자의 일부(금액·호수·더 긴 지번)로만 남아 있으면 통과한다', () => {
    expect(check('740', '보증금 금740,000,000원')).toBe(true);
    expect(check('740', '제1740호')).toBe(true);
    expect(check('246-8', '가상동 246-89')).toBe(true);
    expect(check('246-8', '가상동 1246-8')).toBe(true);
  });

  it('혼자 남은 조각은 여전히 멈춘다', () => {
    expect(check('740', '가상동 740 [REDACTED]')).toBe(false);
    expect(check('740', '가상동 740번지')).toBe(false);
    expect(check('246-8', '가상동 246-8, 가상아파트')).toBe(false);
  });

  it('숫자로 시작하거나 끝나지 않는 값은 지금처럼 글자 그대로 찾는다', () => {
    expect(check('가상아파트', '가상아파트1동')).toBe(false);
    expect(check('가상동 740', '서울 가상동 7401')).toBe(true); // 끝은 숫자라 뒤 경계만 본다
  });

  it('6자리 이상 숫자는 붙어 있어도 숫자만 비교로 계속 잡는다 (붙어서 읽힌 주민번호 등)', () => {
    const rrn = { ...piece('R1', '960712-2583914'), type: PII_TYPE.RESIDENT_ID };
    const plan = createMaskingPlan([rrn], [], MASKING_PURPOSE.FRAUD_CHECK).data;
    expect(validateMaskedText({ D: '960712-2583914881023-1647205' }, [rrn], plan).ok).toBe(false);
  });
});
