import { describe, it, expect } from 'vitest';
import {
  findIdNumbers,
  findPassportNumbers,
} from '../src/features/document-analysis/pii-patterns.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// 모든 번호는 가짜다. 실제 개인정보를 쓰지 않는다.

describe('PART 2 주민·외국인등록번호 탐지', () => {
  it('뒷자리가 1로 시작하면 주민등록번호', () => {
    const r = findIdNumbers('임대인 주민번호 800101-1234567');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.RESIDENT_ID);
  });

  it('뒷자리가 5로 시작하면 외국인등록번호', () => {
    const r = findIdNumbers('임차인 외국인등록번호 990505-5234567');
    expect(r[0].type).toBe(PII_TYPE.FOREIGNER_ID);
  });

  it('하이픈 앞뒤 공백도 잡는다 (OCR 대비)', () => {
    expect(findIdNumbers('800101 - 1234567')).toHaveLength(1);
  });

  it('찾은 위치(start, end)가 정확하다', () => {
    const text = '번호: 800101-1234567';
    const r = findIdNumbers(text);
    expect(text.slice(r[0].start, r[0].end)).toBe('800101-1234567');
  });

  it('한 문장에 두 개가 있으면 둘 다 찾는다', () => {
    expect(findIdNumbers('800101-1234567, 990505-6234567')).toHaveLength(2);
  });

  it('보증금 금액은 잡지 않는다', () => {
    expect(findIdNumbers('보증금 금 50,000,000원')).toHaveLength(0);
  });

  it('13월 같은 없는 날짜는 잡지 않는다', () => {
    expect(findIdNumbers('801301-1234567')).toHaveLength(0);
  });

  it('더 긴 숫자의 일부는 잡지 않는다', () => {
    expect(findIdNumbers('9800101-12345678')).toHaveLength(0);
  });
});

describe('PART 2 여권번호 탐지', () => {
  it('옛 형식 여권번호를 찾는다', () => {
    const r = findPassportNumbers('여권번호 M12345678');
    expect(r[0].type).toBe(PII_TYPE.PASSPORT_ID);
  });

  it('새 형식 여권번호를 찾는다', () => {
    expect(findPassportNumbers('Passport No. M123A4567')).toHaveLength(1);
  });

  it('영단어 속 글자는 잡지 않는다', () => {
    expect(findPassportNumbers('MORTGAGE 12345678')).toHaveLength(0);
  });
});