import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { findLookalikeNumber } from '../src/features/masking/masking-validator.js';
import { validateMaskedText } from '../src/features/masking/index.js';
import { analyzeDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

const EMPTY_PLAN = { purpose: MASKING_PURPOSE.FRAUD_CHECK, items: [] };

describe('PART 4 안전망: OCR이 잘못 읽은 번호 찾기 (findLookalikeNumber)', () => {
  it('숫자 자리에 O·l·I가 섞인 주민·외국인등록번호, 전화번호, 계좌번호를 찾는다', () => {
    expect(findLookalikeNumber('주민등록번호 75O315-1******')).toBe('75O315-1******');
    expect(findLookalikeNumber('외국인등록번호 99O5O5-5123456')).toBe('99O5O5-5123456');
    expect(findLookalikeNumber('연락처 01O-1234-5678')).toBe('01O-1234-5678');
    expect(findLookalikeNumber('입금 계좌 11O-l23-456789')).toBe('11O-l23-456789');
  });

  it('비슷한 글자가 없는 글은 보지 않는다 (정상 번호는 기존 검사와 PART 2 탐지가 맡음)', () => {
    expect(findLookalikeNumber('주민등록번호 [REDACTED]')).toBeNull();
    expect(findLookalikeNumber('보증금 금10,000,000원 월세 500,000원')).toBeNull();
    expect(findLookalikeNumber('750315-1******')).toBeNull();
  });

  it('날짜, 등기 고유번호, 영어 단어, 가명은 번호로 보지 않는다', () => {
    expect(findLookalikeNumber('계약일 2O26-O8-O3')).toBeNull();
    expect(findLookalikeNumber('고유번호 11O1-2O19-O12345')).toBeNull();
    expect(findLookalikeNumber('Hello World, Tel [REDACTED]')).toBeNull();
    expect(findLookalikeNumber('소유자 [PrevOwner_E] 예금주 [AccountHolder_D]')).toBeNull();
    expect(findLookalikeNumber('OOO-OOOO-OOOO')).toBeNull(); // 진짜 숫자가 없으면 번호가 아니다
  });

  it('계좌·은행·입금 같은 말이 근처에 없는 숫자 덩어리는 계좌번호로 보지 않는다 (상욱님 리뷰)', () => {
    expect(findLookalikeNumber('계약기간 |2026-08-03| 부터')).toBeNull(); // 표 테두리 | 가 1로 바뀌는 경우
    expect(findLookalikeNumber('중개사무소 등록번호 제11680-2O19-00123호')).toBeNull();
    expect(findLookalikeNumber('사업자등록번호 12O-45-67890')).toBeNull();
    expect(findLookalikeNumber('101동 1203호 금10,000,000원 2019년3월5일')).toBeNull();
    // 근처에 은행 말이 있으면 계좌번호로 본다 (앞 20글자·뒤 10글자)
    expect(findLookalikeNumber('12O-45-67890 (가상은행)')).toBe('12O-45-67890');
  });
});

describe('PART 4 안전망: 보내기 전 검사 (validateMaskedText)', () => {
  it('탐지 결과에 없어도, 잘못 읽힌 번호가 가린 글에 남아 있으면 멈춘다 (메시지에 값은 안 넣음)', () => {
    const r = validateMaskedText({ DOC_R: '1 소유권보존 소유자 [Owner_A] 75O315-1******' }, [], EMPTY_PLAN);
    expect(r.ok).toBe(false);
    expect(r.error.message).toContain('misread');
    expect(r.error.message).not.toContain('75O315');
  });

  it('잘못 읽힌 글자가 없으면 그대로 통과한다', () => {
    const r = validateMaskedText({ DOC_R: '1 소유권보존 소유자 [Owner_A] [REDACTED]' }, [], EMPTY_PLAN);
    expect(r.ok).toBe(true);
  });
});

describe('PART 4 안전망: 실제 샘플 PDF에서 잘못 멈추지 않는다', () => {
  const samplePdf = (name) =>
    new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, {
      type: 'application/pdf',
    });
  let analysis;
  beforeAll(async () => {
    const r = await analyzeDocuments({ files: [samplePdf('sample-registry'), samplePdf('sample-lease')] });
    analysis = r.data;
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 글자 PDF 샘플은 검사를 통과한다`, () => {
      const r = prepareForAi(analysis, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
    });
  }
});
