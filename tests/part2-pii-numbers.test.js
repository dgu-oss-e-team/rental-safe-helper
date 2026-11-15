import { describe, it, expect } from 'vitest';
import {
  findPhoneNumbers,
  findRegistryIds,
  findBankAccounts,
  findPatternPII,
} from '../src/features/document-analysis/pii-patterns.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// 모든 번호는 가짜다. 실제 개인정보를 쓰지 않는다.

describe('PART 2 전화번호 탐지', () => {
  it('하이픈 있는 휴대폰 번호를 찾는다', () => {
    const r = findPhoneNumbers('연락처 010-1234-5678');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.PHONE_NUMBER);
  });

  it('하이픈 없는 번호와 공백 섞인 번호도 찾는다', () => {
    expect(findPhoneNumbers('01012345678')).toHaveLength(1);
    expect(findPhoneNumbers('010 1234 5678')).toHaveLength(1);
  });

  it('서울(02)과 지역번호(031)도 찾는다', () => {
    expect(findPhoneNumbers('02-123-4567')).toHaveLength(1);
    expect(findPhoneNumbers('031-1234-5678')).toHaveLength(1);
  });

  it('날짜와 금액은 잡지 않는다', () => {
    expect(findPhoneNumbers('계약일 2024-01-05')).toHaveLength(0);
    expect(findPhoneNumbers('보증금 50,000,000원')).toHaveLength(0);
  });

  it('주민등록번호 안의 숫자는 잡지 않는다', () => {
    expect(findPhoneNumbers('800101-1234567')).toHaveLength(0);
  });
});

describe('PART 2 등기 고유번호 탐지', () => {
  it('4-4-6 형식을 찾는다', () => {
    const r = findRegistryIds('고유번호 1101-2024-123456');
    expect(r[0].type).toBe(PII_TYPE.REGISTRY_ID);
  });

  it('날짜는 잡지 않는다', () => {
    expect(findRegistryIds('2024-01-05')).toHaveLength(0);
  });
});

describe('PART 2 계좌번호 탐지', () => {
  it('은행 이름 뒤의 계좌번호를 찾는다', () => {
    const r = findBankAccounts('국민은행 123-45-678901');
    expect(r[0].type).toBe(PII_TYPE.BANK_ACCOUNT);
  });

  it('"입금계좌", "예금주" 뒤의 번호도 찾는다', () => {
    expect(findBankAccounts('입금계좌: 110-123-456789')).toHaveLength(1);
    expect(findBankAccounts('예금주 김철수 계좌번호 1234567890123')).toHaveLength(1);
  });

  it('은행 관련 단어가 없으면 잡지 않는다', () => {
    expect(findBankAccounts('관리번호 123-45-678901')).toHaveLength(0);
  });

  it('숫자가 10개 미만이면 잡지 않는다', () => {
    expect(findBankAccounts('계좌 2024-01-05')).toHaveLength(0);
  });
});

describe('PART 2 전체 탐지 순서 (findPatternPII)', () => {
  it('고유번호를 계좌번호로 중복해서 잡지 않는다', () => {
    const r = findPatternPII('계좌 1101-2024-123456');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.REGISTRY_ID);
  });

  it('전화번호를 계좌번호로 잘못 잡지 않는다', () => {
    const r = findPatternPII('예금주 연락처 010-1234-5678');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.PHONE_NUMBER);
  });

  it('한 문장의 여러 개인정보를 문장 순서대로 돌려준다', () => {
    const text = '연락처 010-1234-5678, 입금계좌 국민은행 123-45-678901, 주민번호 800101-1234567';
    expect(findPatternPII(text).map((r) => r.type)).toEqual([
      PII_TYPE.PHONE_NUMBER,
      PII_TYPE.BANK_ACCOUNT,
      PII_TYPE.RESIDENT_ID,
    ]);
  });
});

describe('PART 2 OCR이 숫자를 비슷한 글자로 잘못 읽은 번호 (이슈 #100)', () => {
  it('0을 O로 읽은 주민번호·연락처·계좌번호도 찾는다 (PR #98 사례)', () => {
    const cases = [
      ['소유자 김철수 8OO1O1-1******', '8OO1O1-1******', PII_TYPE.RESIDENT_ID],
      ['임대인 김철수 75O315-1******', '75O315-1******', PII_TYPE.RESIDENT_ID],
      ['연락처 01O-0000-0000', '01O-0000-0000', PII_TYPE.PHONE_NUMBER],
      ['입금 계좌 가상은행 000-0OO000-00000 예금주 김철수', '000-0OO000-00000', PII_TYPE.BANK_ACCOUNT],
    ];
    for (const [text, value, type] of cases) {
      const r = findPatternPII(text);
      expect(r.map((x) => [x.value, x.type])).toEqual([[value, type]]);
    }
  });

  it('1을 l·I·|로 읽은 번호도 찾는다', () => {
    expect(findPatternPII('연락처 0l0-l234-5678')[0].value).toBe('0l0-l234-5678');
    expect(findPatternPII('주민번호 80OI0I-I234567')[0].type).toBe(PII_TYPE.RESIDENT_ID);
    expect(findPatternPII('연락처 010-|234-5678')[0].value).toBe('010-|234-5678');
  });

  it('값과 위치는 원문 그대로다 (마스킹이 원래 글자를 덮도록)', () => {
    const text = '소유자 김철수 8OO1O1-1******';
    const [r] = findPatternPII(text);
    expect(text.slice(r.start, r.end)).toBe('8OO1O1-1******');
  });

  it('잘못 읽은 글자가 섞인 번호는 uncertain(확인 필요)이다', () => {
    expect(findPatternPII('연락처 01O-1234-5678')[0].uncertain).toBe(true);
    expect(findPatternPII('연락처 010-1234-5678')[0].uncertain).toBeUndefined();
  });

  it('번호 앞에 붙은 영어 글자 때문에 원래 찾던 번호를 놓치지 않는다', () => {
    const r = findPatternPII('Tel010-1234-5678');
    expect(r.map((x) => [x.value, x.uncertain])).toEqual([['010-1234-5678', undefined]]);
  });

  it('진짜 숫자가 절반도 안 되면 번호로 보지 않는다 (영어 글자 오탐 방지)', () => {
    expect(findPatternPII('연락처 OlO-lOOO-OOOO')).toEqual([]);
  });

  it('은행 단어는 원문에서 찾는다 ("IBK"가 "1BK"로 바뀌어도 계좌로 인정)', () => {
    expect(findPatternPII('IBK 123-45O-678901')[0].type).toBe(PII_TYPE.BANK_ACCOUNT);
  });

  it('여권번호의 영문 앞글자(O 등)는 바꾸지 않는다', () => {
    expect(findPatternPII('여권 O12345678')).toEqual([
      { type: PII_TYPE.PASSPORT_ID, value: 'O12345678', start: 3, end: 12 },
    ]);
  });

  it('보통 글의 영어 단어는 번호로 잡지 않는다', () => {
    expect(findPatternPII('Hello World, Ollie lol IOI')).toEqual([]);
  });
});