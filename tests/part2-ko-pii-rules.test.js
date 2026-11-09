import { describe, it, expect } from 'vitest';
import {
  findIdNumbers,
  findPassportNumbers,
  findPhoneNumbers,
  findBankAccounts,
  findPatternPII,
} from '../src/features/document-analysis/pii-patterns.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// ko-pii 규칙을 옮겨 온 부분의 테스트. 모든 번호는 가짜다.

describe('ko-pii 규칙: 등록번호 구분 기호', () => {
  it('점(.)이나 슬래시(/)로 나뉜 번호도 찾는다', () => {
    expect(findIdNumbers('800101.1234567')).toHaveLength(1);
    expect(findIdNumbers('800101/1234567')).toHaveLength(1);
  });

  it('구분 기호가 있으면 확인 필요가 아니다', () => {
    expect(findIdNumbers('800101.1234567')[0].uncertain).toBe(false);
  });

  it('공백으로만 나뉘면 찾되 확인 필요로 표시한다', () => {
    const r = findIdNumbers('800101 1234567');
    expect(r).toHaveLength(1);
    expect(r[0].uncertain).toBe(true);
  });
});

describe('ko-pii 규칙: 여권번호', () => {
  it('관용여권(O)도 찾는다', () => {
    expect(findPassportNumbers('여권번호 O12345678')).toHaveLength(1);
  });

  it('일련번호가 전부 0이면 잡지 않는다', () => {
    expect(findPassportNumbers('M00000000')).toHaveLength(0);
  });
});

describe('ko-pii 규칙: 전화번호', () => {
  it('+82 국제 형식 휴대폰 번호를 찾는다', () => {
    const r = findPhoneNumbers('Phone: +82 10-1234-5678');
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe('+82 10-1234-5678');
  });

  it('+82 서울 번호도 찾는다', () => {
    expect(findPhoneNumbers('+82-2-123-4567')).toHaveLength(1);
  });

  it('점으로 나뉜 번호와 괄호 지역번호를 찾는다', () => {
    expect(findPhoneNumbers('010.1234.5678')).toHaveLength(1);
    expect(findPhoneNumbers('(02) 123-4567')).toHaveLength(1);
  });

  it('없는 지역번호(035)는 잡지 않는다', () => {
    expect(findPhoneNumbers('035-123-4567')).toHaveLength(0);
  });

  it('국제 번호를 한 번만 찾는다 (중복 없음)', () => {
    expect(findPatternPII('연락처 +82 10-1234-5678')).toHaveLength(1);
  });
});

describe('ko-pii 규칙: 계좌번호', () => {
  it('"은행"이 안 붙는 은행 이름 뒤의 계좌도 찾는다', () => {
    expect(findBankAccounts('농협 302-1234-5678-91')).toHaveLength(1);
    expect(findBankAccounts('카카오뱅크 3333-01-1234567')).toHaveLength(1);
    expect(findBankAccounts('우체국 123456-01-123456')).toHaveLength(1);
  });

  it('공백으로 나뉜 계좌번호도 찾는다', () => {
    expect(findBankAccounts('입금계좌 110 123 456789')).toHaveLength(1);
  });

  it('16자리 계좌번호까지 찾는다', () => {
    expect(findBankAccounts('계좌 1234567890123456')).toHaveLength(1);
  });

  it('17자리 이상은 잡지 않는다', () => {
    expect(findBankAccounts('계좌 12345678901234567')).toHaveLength(0);
  });

  it('공백으로 나뉜 전화번호를 계좌로 잡지 않는다', () => {
    const r = findPatternPII('예금주 연락처 010 1234 5678');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.PHONE_NUMBER);
  });
});

describe('ko-pii 규칙: 오탐 방지', () => {
  it('KB시세 같은 부동산 용어 뒤 숫자는 계좌로 잡지 않는다', () => {
    expect(findBankAccounts('KB시세 2024 1234 5678')).toHaveLength(0);
  });

  it('계약기간 날짜와 금액은 잡지 않는다', () => {
    expect(findPatternPII('계약기간 2024. 01. 05. 부터')).toHaveLength(0);
    expect(findPatternPII('보증금 금50,000,000원 월세 금500,000원')).toHaveLength(0);
  });
});