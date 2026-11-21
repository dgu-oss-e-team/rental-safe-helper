// PART 2. 등기부 전유부분 표의 "제3층 제304호"도 가린다 (실제 등기부와 같은 줄 모양, 상욱·정연님 점검)
// 주소·이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { unitTailsOf } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE } from '../src/shared/document-model.js';

/** @param {string} id @param {string[]} lines */
const doc = (id, lines) => ({
  documentId: id,
  fileName: `${id}.pdf`,
  sourceType: 'TEXT_PDF',
  pages: [
    {
      pageIndex: 0,
      width: 595,
      height: 842,
      blocks: lines.map((text, i) => ({
        blockId: `p0_b${i}`,
        text,
        bbox: { x: 0.05, y: (i + 1) / (lines.length + 2), width: 0.9, height: 0.01 },
        confidence: null,
      })),
    },
  ],
});

const REGISTRY = [
  '등기사항전부증명서(말소사항 포함)',
  '[집합건물] 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
  '【 표 제 부 】 ( 1동의 건물의 표시 )',
  '1 2017년7월27일 서울특별시 중구 가상동3가 철근콘크리트구조',
  '12-34 (철근)콘크리트지붕',
  '【 표 제 부 】 ( 전유부분의 건물의 표시 )',
  '표시번호 접 수 건 물 번 호 건 물 내 역 등기원인 및 기타사항',
  '1 2017년7월27일 제3층 제304호 철근콘크리트구조',
  '29.91㎡',
  '【 갑 구 】 ( 소유권에 관한 사항 )',
  '1 소유권보존 2017년7월27일 제34857호 소유자 김가상 720303-*******',
];

const LEASE = [
  '주택임대차표준계약서',
  '소재지 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
  '보증금 금10,000,000원',
  '제15조(소송) 관할 법원은 합의로 정한다.',
  '임대인 성명 김가상 주민등록번호 720303-1******',
];

const analyze = () => {
  const r = analyzeReadDocuments({ files: [], documents: [doc('REG', REGISTRY), doc('LEASE', LEASE)] });
  if (!r.ok) throw new Error(`stopped at ${r.step}`);
  return r.data;
};

describe('PART 2 주소 끝 동·층·호수 조각 (unitTailsOf)', () => {
  it('등기부 표기 호수를 층·동과 함께 뗀다', () => {
    expect(unitTailsOf('서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호')).toEqual(['제3층 제304호']);
    // 동이 있으면 동을 뺀 층·호수도 준다 (전유부분 표에는 동 없이 나온다, PR #253 평가)
    expect(unitTailsOf('서울특별시 중구 가상로 12 가상아파트 제101동 제7층 제702호')).toEqual([
      '제101동 제7층 제702호',
      '제7층 제702호',
    ]);
  });

  it('호수만("제301호"), "제"가 없는 호수, 호수가 없는 주소는 떼지 않는다 (#233 리뷰)', () => {
    expect(unitTailsOf('서울특별시 중구 가상동 12 제301호')).toEqual([]);
    expect(unitTailsOf('서울특별시 중구 가상로 12, 301호')).toEqual([]);
    expect(unitTailsOf('서울특별시 중구 가상동3가 12-34')).toEqual([]);
    expect(unitTailsOf('제304호')).toEqual([]);
  });
});

describe('PART 2 떼어 낸 호수 조각이 다른 서류와 부딪히지 않는다 (#233 정연님 리뷰)', () => {
  /** @param {string[]} reg @param {string[]} lease */
  const prepAll = (reg, lease) => {
    const a = analyzeReadDocuments({ files: [], documents: [doc('REG', reg), doc('LEASE', lease)] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    return Object.values(MASKING_PURPOSE).map((p) => prepareForAi(a.data, p));
  };

  // 계약서 주소는 도로명 + "304호"("제" 없음): 계약서 안에서는 "제304호"를 다시 찾지 않는다
  const ROAD_LEASE = LEASE.map((t) => (t.startsWith('소재지') ? '소재지 서울특별시 중구 가상로 7, 3층 304호' : t));
  // 전유부분 표의 건물번호 칸이 "제3층" / "제304호"로 두 줄로 나뉜 등기부: 호수만 따로 나온다
  /** @param {string} unit @param {string} floor */
  const splitRegistry = (floor, unit) =>
    REGISTRY.flatMap((t) =>
      t === '1 2017년7월27일 제3층 제304호 철근콘크리트구조'
        ? [`1 2017년7월27일 ${floor} 철근콘크리트구조`, `${unit} (철근)콘크리트지붕`]
        : [t.replace('제3층 제304호', `${floor} ${unit}`)],
    );

  it('계약서 특약에 "제304호 현관 …"이 있어도 멈추지 않는다', () => {
    const lease = [...ROAD_LEASE, '특약사항', '제304호 현관 비밀번호는 입주일에 알려준다.'];
    for (const r of prepAll(splitRegistry('제3층', '제304호'), lease)) expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
  });

  it('등기부 "제1층 제1호" + 계약서 "별지 제1호 서식"도 멈추지 않는다', () => {
    const reg = splitRegistry('제1층', '제1호');
    const lease = [...ROAD_LEASE, '첨부: 별지 제1호 서식 확인서'];
    for (const r of prepAll(reg, lease)) {
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      expect(Object.values(r.data.maskedText).join('\n')).not.toContain('제1층 제1호');
    }
  });
});

describe('PART 2 위 주소에 "제N동"이 있는 등기부의 전유부분 호수 (PR #253 평가)', () => {
  const DONG_REGISTRY = [
    '등기사항전부증명서(말소사항 포함)',
    '[집합건물] 서울특별시 중구 가상로 12, 가상아파트 제3동 제7층 제702호',
    '【 표 제 부 】 ( 전유부분의 건물의 표시 )',
    '1 2015년3월2일 제7층 제702호 철근콘크리트구조 59.94㎡',
    '【 갑 구 】 ( 소유권에 관한 사항 )',
    '1 소유권보존 2015년3월2일 제10021호 소유자 김가상 720303-*******',
  ];

  it('전유부분 줄의 "제7층 제702호"(동 없음)를 찾고, AI 글에 남지 않는다', () => {
    const r = analyzeReadDocuments({ files: [], documents: [doc('REG', DONG_REGISTRY), doc('LEASE', LEASE)] });
    if (!r.ok) throw new Error(`stopped at ${r.step}`);
    expect(r.data.findings.filter((f) => f.documentId === 'REG').map((f) => f.value)).toContain('제7층 제702호');
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const p = prepareForAi(r.data, purpose);
      expect(p.ok, p.ok ? '' : `stopped at ${p.step}: ${p.error.message}`).toBe(true);
      if (p.ok) expect(Object.values(p.data.maskedText).join('\n')).not.toContain('702호');
    }
  });
});

describe('PART 2 등기부 전유부분 표의 호수', () => {
  it('전유부분 줄의 "제3층 제304호"를 주소 조각으로 찾는다', () => {
    const values = analyze().findings.filter((f) => f.documentId === 'REG').map((f) => f.value);
    expect(values).toContain('제3층 제304호');
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 멈추지 않고, 호수가 AI로 가지 않는다 (접수번호·조항 번호는 그대로)`, () => {
      const r = prepareForAi(analyze(), purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared).not.toContain('304호');
      expect(shared).toContain('제34857호');
      expect(shared).toContain('제15조');
    });
  }
});
