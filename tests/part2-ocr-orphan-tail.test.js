// PART 2. 두 줄 주소의 윗줄을 OCR이 깨서 읽어도 아랫줄 "번지, 동·호수"는 가린다 (상욱님 사진 점검)
// 주소·이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { detectPII } from '../src/features/document-analysis/index.js';
import { findOrphanUnitTail } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE, REVIEW_STATUS, SOURCE_TYPE } from '../src/shared/document-model.js';

/** @param {string[]} lines @param {string} sourceType */
const docOf = (lines, sourceType = SOURCE_TYPE.IMAGE) => ({
  documentId: 'REG',
  fileName: 'REG.jpg',
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
        confidence: sourceType === SOURCE_TYPE.IMAGE ? 0.85 : null,
      })),
    },
  ],
});

const HEAD = ['등기사항전부증명서(말소사항 포함)', '【 갑 구 】 ( 소유권에 관한 사항 )', '1 소유권보존 2018년3월14일 공유자', '김가상 760423-*******'];

describe('PART 2 findOrphanUnitTail: 줄 맨 앞 "번지, 동·호수"', () => {
  it('"88,205동1103호(…)", "14,301호(…)"를 찾는다', () => {
    expect(findOrphanUnitTail('88,205동1103호(가상동,가상그린아파트)')?.value).toBe('88,205동1103호(가상동,가상그린아파트)');
    expect(findOrphanUnitTail('14,301호(가상동,가상빌라)')?.value).toBe('14,301호(가상동,가상빌라)');
    expect(findOrphanUnitTail('9, 202호(가상동)')?.value).toBe('9, 202호(가상동)');
  });

  it('쉼표 없는 접수번호·전유부분 호수, 금액, 줄 중간의 모양은 아니다', () => {
    expect(findOrphanUnitTail('제40517호')).toBeNull();
    expect(findOrphanUnitTail('2018년9월3일 제40517호')).toBeNull();
    expect(findOrphanUnitTail('제3층 제301호')).toBeNull();
    expect(findOrphanUnitTail('1,000,000원')).toBeNull();
    expect(findOrphanUnitTail('변경 전거 9, 202호(가상동)')).toBeNull();
  });
});

describe('PART 2 윗줄 주소가 깨진 사진 등기부', () => {
  const lines = [...HEAD, '서물툭별시 노원구 가상로', '88,205동1103호(가상동,가상그린아파트)'];

  it('아랫줄 "88,205동1103호(…)"를 주소로 찾고 ④에서 확인하게 한다', () => {
    const r = detectPII(docOf(lines));
    if (!r.ok) throw new Error('detect failed');
    const tail = r.data.find((f) => f.value === '88,205동1103호(가상동,가상그린아파트)');
    expect(tail?.type).toBe(PII_TYPE.ADDRESS);
    expect(tail?.reviewStatus).toBe(REVIEW_STATUS.NEEDS_REVIEW);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 동·호수가 AI로 가지 않는다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [docOf(lines)] });
      if (!a.ok) throw new Error(`stopped at ${a.step}`);
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      if (!r.ok) return;
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared).not.toContain('1103호');
      expect(shared).not.toContain('205동');
    });
  }
});

describe('PART 2 윗줄이 바르게 읽힌 두 줄 주소는 지금처럼 한 묶음', () => {
  it('아랫줄은 윗줄과 같은 groupId 조각이고 확인 필요 표시가 없다', () => {
    const r = detectPII(docOf([...HEAD, '서울특별시 노원구 가상로', '88,205동1103호(가상동,가상그린아파트)'], SOURCE_TYPE.TEXT_PDF));
    if (!r.ok) throw new Error('detect failed');
    const first = r.data.find((f) => f.value === '서울특별시 노원구 가상로');
    const tail = r.data.find((f) => f.value === '88,205동1103호(가상동,가상그린아파트)');
    expect(first?.groupId).toBeTruthy();
    expect(tail?.groupId).toBe(first?.groupId);
    expect(tail?.reviewStatus).toBe(REVIEW_STATUS.DETECTED);
  });
});
