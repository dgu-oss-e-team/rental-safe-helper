// PART 2. 등기부 표제부: 도로명주소 줄 옆에 층별 면적 칸이 붙어 읽히는 경우 (실제 등기부와 같은 줄 모양)
// 주소·이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { findAddresses } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

const LINES = [
  '등기사항전부증명서(말소사항 포함)',
  '[집합건물] 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
  '【 표 제 부 】 ( 1동의 건물의 표시 )',
  '표시번호 접 수 소재지번,건물명칭 및 번호 건 물 내 역 등기원인 및 기타사항',
  '1 2017년7월27일 서울특별시 중구 가상동3가 철근콘크리트구조',
  '12-34 (철근)콘크리트지붕',
  '가상빌 6층 단지형다세대주택',
  '[도로명주소] 1층 19.65㎡',
  '서울특별시 중구 가상로1길 2층138.48㎡',
  '57 3층 138.6㎡',
  '4층 107.58㎡',
  '옥탑1층',
  '19.89㎡(연면적제외)',
  '【 갑 구 】 ( 소유권에 관한 사항 )',
  '1 소유권보존 2017년7월27일 소유자 김가상 720303-*******',
];

const registry = {
  documentId: 'REG',
  fileName: 'reg.pdf',
  sourceType: 'TEXT_PDF',
  pages: [
    {
      pageIndex: 0,
      width: 595,
      height: 842,
      blocks: LINES.map((text, i) => ({
        blockId: `p0_b${i}`,
        text,
        bbox: { x: 0.05, y: (i + 1) / (LINES.length + 2), width: 0.9, height: 0.01 },
        confidence: null,
      })),
    },
  ],
};

describe('PART 2 층별 면적 칸이 붙은 도로명주소', () => {
  it('주소는 층별 면적("2층138.48㎡") 앞에서 끊는다', () => {
    const r = findAddresses('서울특별시 중구 가상로1길 2층138.48㎡');
    expect(r.map((x) => x.value)).toEqual(['서울특별시 중구 가상로1길']);
    expect(r[0]).toMatchObject({ tableCut: true });
    expect(findAddresses('서울특별시 중구 가상로 7 옥탑1층19.89㎡').map((x) => x.value)).toEqual([
      '서울특별시 중구 가상로 7',
    ]);
  });

  it('층만 있고 면적이 없거나, 띄어 쓴 "1층 410.52㎡"는 지금처럼 층까지 주소로 둔다', () => {
    expect(findAddresses('서울특별시 중구 가상로 7, 2층').map((x) => x.value)).toEqual(['서울특별시 중구 가상로 7, 2층']);
    expect(findAddresses('서울특별시 중구 가상로 1층 410.52㎡').map((x) => x.value)).toEqual(['서울특별시 중구 가상로 1층']);
  });

  it('층별 면적은 주소가 아니고, 다음 줄의 짧은 건물번호("57")는 잇지 않는다 (보내기 전 검사가 다른 "57"에서 멈추지 않게)', () => {
    const a = analyzeReadDocuments({ files: [], documents: [registry] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    const addresses = a.data.findings.filter((f) => f.type === PII_TYPE.ADDRESS).map((f) => f.value);
    expect(addresses).toContain('서울특별시 중구 가상로1길');
    expect(addresses).not.toContain('57');
    expect(addresses.some((v) => v.includes('㎡'))).toBe(false);
  });

  it('도로명 뒤 하이픈 번호("57-3")나 지번 뒤 번지는 지금처럼 잇는다', () => {
    const page = registry.pages[0];
    const blocks = page.blocks.map((b) => (b.text === '57 3층 138.6㎡' ? { ...b, text: '57-3 3층 138.6㎡' } : b));
    const a = analyzeReadDocuments({ files: [], documents: [{ ...registry, pages: [{ ...page, blocks }] }] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    expect(a.data.findings.map((f) => f.value)).toContain('57-3');
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 멈추지 않고, 도로명은 AI로 가지 않고, 층별 면적은 남는다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [registry] });
      if (!a.ok) throw new Error(`stopped at ${a.step}`);
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      const masked = Object.values(r.data.maskedText).join('\n');
      expect(masked).not.toContain('가상로1길');
      expect(masked).toContain('2층138.48㎡');
      expect(masked).toContain('3층 138.6㎡');
    });
  }
});

describe('PART 2 옆 건물내역 칸의 "층수 + 건물 종류" (#253 평가 세트 과잉 마스킹)', () => {
  const cut = (/** @type {string} */ t) => findAddresses(t).map((x) => x.value);

  it('"22층 공동주택(아파트)", "5층 다세대주택", "지하1층 제2종근린생활시설" 앞에서 주소를 끊는다', () => {
    expect(cut('[도로명주소] 서울특별시 성동구 22층 공동주택(아파트) 및')).toEqual(['서울특별시 성동구']);
    expect(cut('서울특별시 중구 가상동2가 5층 다세대주택')).toEqual(['서울특별시 중구 가상동2가']);
    expect(cut('서울특별시 중구 가상로 7 지하1층 제2종근린생활시설')).toEqual(['서울특별시 중구 가상로 7']);
  });

  it('주소의 층 뒤에 호수가 오면 그대로 (건물 종류가 아니다)', () => {
    expect(cut('서울특별시 중구 가상로 7, 3층 301호')).toEqual(['서울특별시 중구 가상로 7, 3층 301호']);
  });
});
