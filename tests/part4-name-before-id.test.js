// PART 4. 고유식별번호 바로 앞의, 탐지되지 않은 이름 가리기 (실제 양식 서류 점검에서 발견)
// 예시는 모두 가짜 값이다.
import { describe, it, expect } from 'vitest';
import { findNamesBeforeIds } from '../src/features/masking/apply-masking-plan.js';
import { createMaskingPlan, applyMaskingPlan, validateMaskedText } from '../src/features/masking/index.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const BOX = { x: 0.1, y: 0.1, width: 0.6, height: 0.03 };
/** 탐지 결과 하나 */
const finding = (id, type, value, blockId = 'B3') => ({ id, type, value, documentId: 'DOC_R', blockId, pageIndex: 0, bbox: BOX });
const rrn = (value) => finding('ID1', PII_TYPE.RESIDENT_ID, value);

describe('PART 4 번호 앞 이름 찾기 (findNamesBeforeIds)', () => {
  it('주민·외국인등록번호 바로 앞의 탐지되지 않은 한글 2~4자를 이름으로 본다', () => {
    expect(findNamesBeforeIds('홍길동 800101-*******', [rrn('800101-*******')])).toEqual(['홍길동']);
    expect(findNamesBeforeIds('2. 김가상, 900101-1234567', [rrn('900101-1234567')])).toEqual(['김가상']);
    const foreigner = finding('ID2', PII_TYPE.FOREIGNER_ID, '990505-5123456');
    expect(findNamesBeforeIds('외국인 이가상 990505-5123456', [foreigner])).toEqual(['이가상']);
  });

  it('역할 라벨, 이름 칸, 번호 라벨, 이미 탐지된 이름, 회사 이름은 건드리지 않는다', () => {
    for (const text of ['공유자 800101-*******', '소유자 800101-*******', '채무자 800101-*******', '성명 800101-*******', '주민등록번호 800101-*******', '주식회사가상은행 800101-*******']) {
      expect(findNamesBeforeIds(text, [rrn('800101-*******')]), text).toEqual([]);
    }
    const name = finding('N1', PII_TYPE.PERSON_NAME, '홍길동');
    expect(findNamesBeforeIds('홍길동 800101-*******', [name, rrn('800101-*******')])).toEqual([]);
  });

  it('번호가 아닌 탐지 결과(전화번호 등) 앞의 낱말은 보지 않는다', () => {
    const phone = finding('P1', PII_TYPE.PHONE_NUMBER, '010-1234-5678');
    expect(findNamesBeforeIds('연락처 010-1234-5678', [phone])).toEqual([]);
  });
});

describe('PART 4 번호 앞 이름 가리기: 등기부 공유자 (라벨 다음 줄 이름)', () => {
  const doc = {
    documentId: 'DOC_R',
    pages: [{ pageIndex: 0, width: 100, height: 100, blocks: [
      { blockId: 'B1', text: '공유자', bbox: BOX, confidence: null },
      { blockId: 'B2', text: '지분 2분의 1', bbox: BOX, confidence: null },
      { blockId: 'B3', text: '홍길동 800101-*******', bbox: BOX, confidence: null },
    ] }],
  };
  const findings = [rrn('800101-*******')];

  it('목적 3가지 모두 이름도 가려지고, 보내기 전 검사를 통과한다', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const plan = createMaskingPlan(findings, [], purpose).data;
      const masked = applyMaskingPlan([doc], plan, findings, []).data;
      expect(masked.maskedText.DOC_R.split('\n')[2], purpose).toBe('[REDACTED] [REDACTED]');
      expect(masked.maskedText.DOC_R, purpose).not.toContain('홍길동');
      expect(validateMaskedText(masked.maskedText, findings, plan).ok, purpose).toBe(true);
    }
  });
});
