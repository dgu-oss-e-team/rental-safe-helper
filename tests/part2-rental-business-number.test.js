// PART 2. 민간임대 계약서의 임대사업자 등록번호를 가린다 (팀 합의: REGISTRY_ID로)
// 번호·이름은 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const LINES = [
  '표 준 임 대 차 계 약 서',
  '1. 계약 당사자',
  '임대사업자 성명(법인명) 김가상 (서명 또는 인)',
  '주민등록번호 720303-1****** 전화번호 010-0000-1111',
  '임대사업자',
  '2017-서울중구-00999',
  '등록번호',
  '임차인 성명 이가상 (서명 또는 인)',
  '주민등록번호 040404-3123456',
];

const lease = {
  documentId: 'LEASE',
  fileName: 'lease.pdf',
  sourceType: 'TEXT_PDF',
  pages: [
    {
      pageIndex: 0,
      width: 595,
      height: 842,
      blocks: LINES.map((text, i) => ({
        blockId: `p0_b${i}`,
        text,
        bbox: { x: 0.1, y: (i + 1) / (LINES.length + 2), width: 0.8, height: 0.01 },
        confidence: null,
      })),
    },
  ],
};

describe('PART 2 임대사업자 등록번호', () => {
  const analyzed = () => {
    const a = analyzeReadDocuments({ files: [], documents: [lease] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    return a.data;
  };

  it('REGISTRY_ID로 찾는다', () => {
    const f = analyzed().findings.find((x) => x.value === '2017-서울중구-00999');
    expect(f?.type).toBe(PII_TYPE.REGISTRY_ID);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: AI로 가는 글에 등록번호가 남지 않는다`, () => {
      const r = prepareForAi(analyzed(), purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared).not.toContain('00999');
      expect(shared).not.toContain('서울중구-');
    });
  }
});
