import { describe, it, expect } from 'vitest';
import { classifyDocument, detectPII, extractFields } from '../src/features/document-analysis/index.js';
import { mockRegistryDocument, mockLeaseDocument } from '../src/shared/mock-data.js';
import { PII_TYPE, DOCUMENT_TYPE } from '../src/shared/document-model.js';

/**
 * 글자 한 줄로 테스트용 문서를 만든다. 이름은 모두 가짜다.
 * @param {string} text
 */
function docOf(text) {
  return {
    documentId: 'DOC_TEST',
    documentType: DOCUMENT_TYPE.UNKNOWN,
    sourceType: 'text_pdf',
    pages: [
      {
        pageIndex: 0,
        width: 2480,
        height: 3508,
        blocks: [{ blockId: 'T_001', text, bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.02 }, confidence: null }],
      },
    ],
  };
}

/** @param {string} text */
const typeOf = (text) => classifyDocument(docOf(text)).data.documentType;

describe('PART 2 classifyDocument() 판별 규칙', () => {
  it('계약서 특약에 "등기사항전부증명서"가 있어도 계약서 단어가 더 많으면 계약서다', () => {
    // 등기부 단어 1개(등기사항) vs 계약서 단어 4개(임대인·임차인·보증금·특약)
    const text = '임대인 김철수, 임차인 이영희, 보증금 5천만 원. 특약: 등기사항전부증명서 확인함.';
    expect(typeOf(text)).toBe(DOCUMENT_TYPE.LEASE_CONTRACT);
  });

  it('OCR이 띄어 읽은 단어("갑  구", "표 제 부")도 잡는다', () => {
    // 띄어쓰기를 지우지 않으면 키워드가 하나도 안 맞는 문장
    expect(typeOf('【 갑  구 】 소유권에 관한 사항, 표 제 부')).toBe(DOCUMENT_TYPE.REGISTRY);
  });

  it('새로 추가한 단어(표제부, 등기부등본, 부동산임대차계약서)를 인식한다', () => {
    expect(typeOf('표제부 등기부등본')).toBe(DOCUMENT_TYPE.REGISTRY);
    expect(typeOf('부동산임대차계약서')).toBe(DOCUMENT_TYPE.LEASE_CONTRACT);
  });

  it('양쪽 단어 개수가 같으면 UNKNOWN', () => {
    expect(typeOf('등기사항 보증금')).toBe(DOCUMENT_TYPE.UNKNOWN);
  });

  it('키워드가 없거나 빈 문서면 UNKNOWN', () => {
    expect(typeOf('일반 안내문입니다.')).toBe(DOCUMENT_TYPE.UNKNOWN);
    expect(typeOf('')).toBe(DOCUMENT_TYPE.UNKNOWN);
  });

  it('문서가 없으면 INVALID_INPUT 오류를 돌려준다', () => {
    expect(classifyDocument(undefined)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});

describe('PART 2 문서 분석', () => {
  it('classifyDocument()는 등기부와 계약서를 구분한다', () => {
    expect(classifyDocument(mockRegistryDocument).data.documentType).toBe(DOCUMENT_TYPE.REGISTRY);
    expect(classifyDocument(mockLeaseDocument).data.documentType).toBe(DOCUMENT_TYPE.LEASE_CONTRACT);
  });

  it('detectPII()는 정해진 코드와 필드로 결과를 돌려준다', () => {
    const r = detectPII(mockLeaseDocument);
    expect(r.ok).toBe(true);
    for (const f of r.data) {
      expect(Object.values(PII_TYPE)).toContain(f.type);
      expect(f).toMatchObject({ id: expect.any(String), blockId: expect.any(String), pageIndex: 0 });
    }
  });

  it('extractFields()는 등기부·계약서 비교용 항목을 돌려준다', () => {
    const r = extractFields([mockRegistryDocument, mockLeaseDocument], []);
    expect(r.data.registry.owners.length).toBeGreaterThan(0);
    expect(r.data.contract.landlords.length).toBeGreaterThan(0);
  });

  it('문서가 없으면 오류를 돌려준다', () => {
    expect(detectPII(undefined).ok).toBe(false);
  });

  // TODO(PART 2): 주민·외국인등록번호, 여권, 전화, 계좌, 등기 고유번호 정규식 테스트 (정탐·오탐 모두)
});
