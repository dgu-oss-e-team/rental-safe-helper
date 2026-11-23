// PART 2. 사진 등기부에서 갑구 순서(순위번호·등기목적)를 못 읽으면 예전 공유자를 지금 소유자로 넣지 않는다 (상욱님 사진 점검)
// 이름·번호·주소는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments } from '../src/app/pipeline.js';
import { extractFields } from '../src/features/document-analysis/index.js';
import { SOURCE_TYPE } from '../src/shared/document-model.js';

/** @param {string[]} lines @param {string} sourceType */
const registryOf = (lines, sourceType) => ({
  documentId: 'REG',
  fileName: sourceType === SOURCE_TYPE.TEXT_PDF ? 'REG.pdf' : 'REG.jpg',
  sourceType,
  pages: [
    {
      pageIndex: 0,
      width: 1240,
      height: 1754,
      blocks: lines.map((text, i) => ({
        blockId: `p0_b${i}`,
        text,
        bbox: { x: 0.05, y: (i + 1) / (lines.length + 2), width: 0.9, height: 0.01 },
        confidence: sourceType === SOURCE_TYPE.TEXT_PDF ? null : 0.7,
      })),
    },
  ],
});

// OCR이 순위번호와 등기목적("소유권보존", "…이전")을 깨서 읽은 갑구
const GARBLED = [
  '등기사항전부증명서(말소사항 포함)',
  '[집합건물] 서울특별시 중구 가상동2가 47-12 가상하우스 제4층 제402호',
  '【 갑 구 】 ( 소유권에 관한 사항 )',
  'l 소유권브존 2018년3월14일 공유자',
  '김선달 760423-*******',
  '박흥부 680915-*******',
  'Z 공유자전원지분전부 이즌 2018년9월3일 소유자 홍길동 690812-*******',
];

const LEASE = {
  documentId: 'LEASE',
  fileName: 'LEASE.pdf',
  sourceType: SOURCE_TYPE.TEXT_PDF,
  pages: [
    {
      pageIndex: 0,
      width: 595,
      height: 842,
      blocks: [
        '주택임대차표준계약서',
        '소재지 서울특별시 중구 가상동2가 47-12 가상하우스 제4층 제402호',
        '임대인 성명 홍길동 주민등록번호 690812-1******',
        '보증금 금10,000,000원',
      ].map((text, i) => ({ blockId: `p0_b${i}`, text, bbox: { x: 0.05, y: (i + 1) / 6, width: 0.9, height: 0.01 }, confidence: null })),
    },
  ],
};

describe('PART 2 사진 등기부: 갑구 순서를 못 읽은 경우', () => {
  it('소유자가 여러 명이면 누가 지금 소유자인지 추측하지 않고 null이다', () => {
    const r = extractFields([registryOf(GARBLED, SOURCE_TYPE.IMAGE_PDF)], []).data.registry;
    expect(r.owners).toBeNull();
    expect(r.previousOwners).toBeNull();
  });

  it('위험 점검은 "공동 소유"가 아니라 소유자 확인 불가로 간다', () => {
    const a = analyzeReadDocuments({ files: [], documents: [registryOf(GARBLED, SOURCE_TYPE.IMAGE), LEASE] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    expect(a.data.riskResults.find((x) => x.ruleId === 'OWNER_MISMATCH')?.status).toBe('UNVERIFIABLE');
  });

  it('소유자가 한 명뿐이면 지금처럼 그 사람이 지금 소유자다', () => {
    const one = GARBLED.filter((t) => !t.startsWith('김선달') && !t.startsWith('박흥부') && !t.startsWith('l '));
    const r = extractFields([registryOf(one, SOURCE_TYPE.IMAGE)], []).data.registry;
    expect(r.owners?.map((p) => p.name)).toEqual(['홍길동']);
  });
});

describe('PART 2 글자 PDF 등기부는 지금과 같다', () => {
  it('순위번호가 없는 글자 PDF는 지금처럼 소유자를 전부 쓴다', () => {
    const r = extractFields([registryOf(GARBLED, SOURCE_TYPE.TEXT_PDF)], []).data.registry;
    expect(r.owners?.map((p) => p.name)).toEqual(['김선달', '박흥부', '홍길동']);
  });
});
