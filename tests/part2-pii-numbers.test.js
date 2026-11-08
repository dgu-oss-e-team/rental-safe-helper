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