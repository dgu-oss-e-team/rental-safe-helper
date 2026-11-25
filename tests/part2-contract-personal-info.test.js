import { describe, it, expect } from 'vitest';
import { extractFields } from '../src/features/document-analysis/index.js';
import { findPersonalInfoRange, findSpecialTerms } from '../src/features/document-analysis/field-extractor.js';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';

function makeLeaseDoc(lines, documentId = 'DOC_LEASE_349') {
  return {
    documentId,
    documentType: DOCUMENT_TYPE.LEASE_CONTRACT,
    sourceType: SOURCE_TYPE.TEXT_PDF,
    pages: [
      {
        pageIndex: 0,
        width: 2480,
        height: 3508,
        blocks: lines.map((text, idx) => ({
          blockId: `B_${String(idx + 1).padStart(3, '0')}`,
          text,
          bbox: { x: 0.1, y: 0.05 + idx * 0.03, width: 0.8, height: 0.02 },
          confidence: null,
        })),
      },
    ],
  };
}

describe('Issue #349: contract.personalInfoRange 및 특약 서명·날인 줄 제외', () => {
  it('당사자/중개사 인적사항 칸의 0-based 줄 범위를 찾고 extractFields()에 포함한다', () => {
    const lines = [
      '부동산임대차계약서',
      '소재지: 서울특별시 강남구 테헤란로 123, 402호',
      '보증금: 금100,000,000원 월세: 금1,000,000원',
      '특약사항',
      '1. 임대차 기간 중 전세권 설정에 동의한다.',
      '임대인 주소: 서울특별시 서초구 반포대로 10',
      '임대인 성명: 홍길동 (서명 또는 날인)',
      '임차인 주소: 경기도 성남시 분당구 판교역로 50',
      '임차인 성명: 김철수 (서명 또는 날인)',
      '개업공인중개사: 박영희 (인)',
    ];

    expect(findPersonalInfoRange(lines)).toEqual({ startLine: 5, endLine: 9 });

    const res = extractFields([makeLeaseDoc(lines)], []);
    expect(res.ok).toBe(true);
    expect(res.data.contract.personalInfoRange).toEqual({ startLine: 5, endLine: 9 });
    expect(res.data.contract.specialTerms).toEqual(['1. 임대차 기간 중 전세권 설정에 동의한다.']);
  });

  it('명시적인 [인적사항] 제목 구간을 감지한다', () => {
    const lines = [
      '임대차계약서',
      '[인적사항]',
      '임대사업자 성명: 이도령',
      '임차인 성명: 성춘향',
      '연락처: 010-1234-5678',
      '[특약사항]',
      '1. 반려동물 사육 금지',
    ];

    expect(findPersonalInfoRange(lines)).toEqual({ startLine: 1, endLine: 4 });
  });

  it('서명·날인 줄을 특약 목록에서 제외한다', () => {
    const lines = [
      '[특약사항]',
      '1. 월세는 매월 25일에 지급한다.',
      '임대인 : 홍길동 (인)',
      '임차인 : 김철수 (서명 또는 날인)',
      '공인중개사 : 박영희 (인)',
      '서명 · 날인',
    ];

    expect(findSpecialTerms(lines)).toEqual(['1. 월세는 매월 25일에 지급한다.']);
  });
});
