import { describe, it, expect } from 'vitest';
import {
  parseKoreanNumber,
  parseAmount,
  findDeposit,
  findMonthlyRent,
  findSpecialTerms,
  findRegistryRights,
} from '../src/features/document-analysis/field-extractor.js';
import { mockRegistryDocument, mockLeaseDocument, mockExtractedFields } from '../src/shared/mock-data.js';

/** 문서의 블록 글자를 줄 목록으로 */
const linesOf = (doc) => doc.pages.flatMap((p) => p.blocks.map((b) => b.text));

describe('PART 2 금액 읽기', () => {
  it('숫자 금액을 읽는다', () => {
    expect(parseKoreanNumber('50,000,000')).toBe(50000000);
  });

  it('한글 금액을 읽는다', () => {
    expect(parseKoreanNumber('오천만')).toBe(50000000);
    expect(parseKoreanNumber('일억이천만')).toBe(120000000);
    expect(parseKoreanNumber('오십만')).toBe(500000);
  });

  it('숫자와 한글이 섞여도 읽는다', () => {
    expect(parseKoreanNumber('1억 2천만')).toBe(120000000);
    expect(parseKoreanNumber('5천만')).toBe(50000000);
  });

  it('금액이 아닌 글자가 섞이면 null', () => {
    expect(parseKoreanNumber('오천만원정')).toBeNull();
  });

  it('"금 ... 원" 형식에서 금액을 꺼낸다', () => {
    expect(parseAmount(' 금50,000,000원')).toBe(50000000);
    expect(parseAmount(' 금 오천만원정')).toBe(50000000);
  });

  it('괄호 안 숫자가 있으면 그걸 더 믿는다', () => {
    expect(parseAmount(' 금 오천만원정 (₩50,000,000)')).toBe(50000000);
  });

  it('₩ 표시만 있어도 읽는다', () => {
    expect(parseAmount(' ₩50,000,000')).toBe(50000000);
  });
});

describe('PART 2 보증금·월세', () => {
  it('mock 계약서와 같은 값', () => {
    expect(findDeposit(linesOf(mockLeaseDocument))).toBe(mockExtractedFields.contract.deposit);
    expect(findMonthlyRent(linesOf(mockLeaseDocument))).toBe(mockExtractedFields.contract.monthlyRent);
  });

  it('보증금 다음에 오는 월세 금액을 보증금으로 잡지 않는다', () => {
    expect(findDeposit(['보증금 금 오천만원정 월세 금 오십만원정(₩500,000)'])).toBe(50000000);
  });

  it('"차임"도 월세로 읽는다', () => {
    expect(findMonthlyRent(['차임 금 오십만원정은 매월 25일에 지불한다'])).toBe(500000);
  });

  it('금액 없는 라벨은 건너뛴다', () => {
    expect(findDeposit(['보증금은 계약 종료 시 반환한다', '보증금 금1억원'])).toBe(100000000);
  });

  it('계약금·잔금은 보증금으로 잡지 않는다', () => {
    expect(findDeposit(['계약금 금5,000,000원', '잔금 금45,000,000원'])).toBeNull();
  });

  it('못 찾으면 null', () => {
    expect(findMonthlyRent(['보증금 금50,000,000원'])).toBeNull();
  });
});

describe('PART 2 특약사항', () => {
  it('mock 계약서와 같은 값', () => {
    expect(findSpecialTerms(linesOf(mockLeaseDocument))).toEqual(mockExtractedFields.contract.specialTerms);
  });

  it('제목 다음 줄들을 서명란 전까지 모은다', () => {
    const lines = ['[특약사항]', '1. 반려동물은 키울 수 없다.', '2. 도배는 임대인이 한다.', '본 계약을 증명하기 위하여 서명한다.'];
    expect(findSpecialTerms(lines)).toEqual(['1. 반려동물은 키울 수 없다.', '2. 도배는 임대인이 한다.']);
  });

  it('제목이 없으면 null, 내용이 없으면 []', () => {
    expect(findSpecialTerms(['보증금 금50,000,000원'])).toBeNull();
    expect(findSpecialTerms(['특약사항:', '임대인 김철수 (인)'])).toEqual([]);
  });
});

describe('PART 2 등기부 권리', () => {
  it('mock 등기부와 같은 값', () => {
    expect(findRegistryRights(linesOf(mockRegistryDocument))).toEqual(mockExtractedFields.registry.rights);
  });

  it('가압류와 압류를 구분한다', () => {
    const r = findRegistryRights(['가압류 청구금액 금30,000,000원', '압류 서울특별시']);
    expect(r.map((x) => x.kind)).toEqual(['PROVISIONAL_SEIZURE', 'SEIZURE']);
  });

  it('신탁·전세권도 찾는다', () => {
    const r = findRegistryRights(['소유권이전 신탁 수탁자 ○○신탁', '전세권설정 전세금 금100,000,000원']);
    expect(r.map((x) => x.kind)).toEqual(['TRUST', 'JEONSE']);
  });

  it('한글 채권최고액도 읽는다', () => {
    expect(findRegistryRights(['근저당권설정 채권최고액 금 일억이천만원'])[0].maxClaimAmount).toBe(120000000);
  });

  it('"말소"가 있으면 cancelled', () => {
    expect(findRegistryRights(['3번근저당권설정등기말소'])[0].cancelled).toBe(true);
  });

  it('제목 줄("말소사항 포함", "을구")은 권리로 잡지 않는다', () => {
    expect(findRegistryRights(['등기사항전부증명서(말소사항 포함)', '【 을 구 】 (소유권 이외의 권리에 관한 사항)'])).toEqual([]);
  });
});