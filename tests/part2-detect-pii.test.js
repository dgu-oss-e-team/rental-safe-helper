import { describe, it, expect } from 'vitest';
import { detectPII } from '../src/features/document-analysis/index.js';
import {
  findIdNumbers,
  findPhoneNumbers,
  findBankAccounts,
  findPatternPII,
} from '../src/features/document-analysis/pii-patterns.js';
import { mockLeaseDocument } from '../src/shared/mock-data.js';
import { PII_TYPE, REVIEW_STATUS } from '../src/shared/document-model.js';

// 모든 번호는 가짜다. 실제 개인정보를 쓰지 않는다.

/** 테스트용 한 줄짜리 문서를 만든다. */
function oneBlockDoc(text, confidence = null) {
  return {
    documentId: 'DOC_TEST',
    pages: [
      {
        pageIndex: 0,
        blocks: [{ blockId: 'T_001', text, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.02 }, confidence }],
      },
    ],
  };
}

describe('PART 2 리뷰 반영: 등록번호', () => {
  it('뒷자리 일부가 *인 번호도 찾는다 (등기부 가림 형태)', () => {
    const r = findIdNumbers('소유자 김철수 800101-1******');
    expect(r[0].type).toBe(PII_TYPE.RESIDENT_ID);
    expect(r[0].uncertain).toBe(false);
  });

  it('뒷자리가 전부 *이면 확인 필요로 표시한다', () => {
    const r = findIdNumbers('소유자 800101-*******');
    expect(r).toHaveLength(1);
    expect(r[0].uncertain).toBe(true);
  });

  it('하이픈 없는 주민번호는 계좌가 아니라 주민번호로 잡고, 확인 필요로 표시한다', () => {
    const r = findPatternPII('입금계좌 8001011234567');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.RESIDENT_ID);
    expect(r[0].uncertain).toBe(true);
  });

  it('하이픈 있는 번호는 확인 필요가 아니다', () => {
    expect(findIdNumbers('800101-1234567')[0].uncertain).toBe(false);
  });
});

describe('PART 2 리뷰 반영: 전화·계좌', () => {
  it('중개사 안심번호(050X)를 찾는다', () => {
    expect(findPhoneNumbers('중개사 안심번호 0505-123-4567')).toHaveLength(1);
    expect(findPhoneNumbers('0507-1234-5678')).toHaveLength(1);
  });

  it('은행 이름이 번호 뒤에 와도 계좌번호로 찾는다', () => {
    expect(findBankAccounts('110-123-456789 (신한은행)')).toHaveLength(1);
  });

  it('앞뒤 어디에도 은행 단어가 없으면 잡지 않는다', () => {
    expect(findBankAccounts('관리번호 110-123-456789 비고')).toHaveLength(0);
  });
});

describe('PART 2 detectPII 실제 탐지', () => {
  const result = detectPII(mockLeaseDocument);
  const findings = result.data;
  const valuesOf = (type) => findings.filter((f) => f.type === type).map((f) => f.value);

  it('mock 계약서에서 번호류 개인정보를 정규식으로 찾는다', () => {
    expect(result.ok).toBe(true);
    expect(valuesOf(PII_TYPE.RESIDENT_ID)).toContain('750315-1******');
    expect(valuesOf(PII_TYPE.FOREIGNER_ID)).toContain('990505-5******');
    expect(valuesOf(PII_TYPE.PHONE_NUMBER)).toContain('010-0000-0000');
    expect(valuesOf(PII_TYPE.BANK_ACCOUNT)).toContain('000-000000-00000');
  });

  it('보증금 금액은 개인정보로 잡지 않는다', () => {
    expect(findings.some((f) => f.value.includes('50,000,000'))).toBe(false);
  });

  it('이름·주소도 진짜로 찾고, 문서에 나오는 순서대로 ID를 붙인다', () => {
    const byId = Object.fromEntries(findings.map((f) => [f.id, `${f.type}:${f.value}`]));
    expect(byId).toEqual({
      PII_DOC_LEASE_001: 'ADDRESS:서울특별시 중구 필동로 00, 101호',
      PII_DOC_LEASE_002: 'PERSON_NAME:김철수',
      PII_DOC_LEASE_003: 'RESIDENT_ID:750315-1******',
      PII_DOC_LEASE_004: 'PERSON_NAME:NGUYEN VAN A',
      PII_DOC_LEASE_005: 'FOREIGNER_ID:990505-5******',
      PII_DOC_LEASE_006: 'PHONE_NUMBER:010-0000-0000',
      PII_DOC_LEASE_007: 'BANK_ACCOUNT:000-000000-00000',
      PII_DOC_LEASE_008: 'PERSON_NAME:김철수',
    });
  });

  it('모든 결과의 id가 서로 다르다', () => {
    const ids = findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('결과에 블록 정보(blockId, bbox, pageIndex)가 들어 있다', () => {
    const phone = findings.find((f) => f.type === PII_TYPE.PHONE_NUMBER);
    expect(phone.blockId).toBe('L_006');
    expect(phone.pageIndex).toBe(0);
    expect(phone.bbox).toBeDefined();
  });

  it('하이픈 없는 주민번호는 확인 필요(NEEDS_REVIEW)로 나온다', () => {
    const r = detectPII(oneBlockDoc('입금계좌 8001011234567'));
    expect(r.data[0].reviewStatus).toBe(REVIEW_STATUS.NEEDS_REVIEW);
  });

  it('OCR 신뢰도가 낮으면 확인 필요로 표시한다', () => {
    const r = detectPII(oneBlockDoc('연락처 010-1234-5678', 0.5));
    expect(r.data[0].reviewStatus).toBe(REVIEW_STATUS.NEEDS_REVIEW);
  });

  it('신뢰도가 충분하면 탐지됨으로 표시한다', () => {
    const r = detectPII(oneBlockDoc('연락처 010-1234-5678', 0.95));
    expect(r.data[0].reviewStatus).toBe(REVIEW_STATUS.DETECTED);
  });
});