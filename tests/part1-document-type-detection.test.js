import { describe, it, expect } from 'vitest';
import { detectDocumentType, DOCUMENT_TYPE } from '../src/features/document-input/type-detector.js';

describe('PART 1: Document Type Detection', () => {
  it('classifies registry document keywords correctly', () => {
    const text = '등기사항전부증명서 (말소사항 포함) 표제부 갑구 을구';
    expect(detectDocumentType(text)).toBe(DOCUMENT_TYPE.REGISTRY);
  });

  it('classifies lease contract document keywords correctly', () => {
    const text = '주택임대차계약서 임대인 홍길동 임차인 성춘향 보증금 100,000,000원';
    expect(detectDocumentType(text)).toBe(DOCUMENT_TYPE.LEASE_CONTRACT);
  });

  it('returns UNKNOWN for unsupported document types or empty text', () => {
    expect(detectDocumentType('일반 텍스트 문서입니다.')).toBe(DOCUMENT_TYPE.UNKNOWN);
    expect(detectDocumentType('')).toBe(DOCUMENT_TYPE.UNKNOWN);
    // @ts-ignore
    expect(detectDocumentType(null)).toBe(DOCUMENT_TYPE.UNKNOWN);
  });
});