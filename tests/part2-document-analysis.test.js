import { describe, it, expect } from 'vitest';
import { classifyDocument, detectPII, extractFields } from '../src/features/document-analysis/index.js';
import { mockRegistryDocument, mockLeaseDocument } from '../src/shared/mock-data.js';
import { PII_TYPE, DOCUMENT_TYPE } from '../src/shared/document-model.js';

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
