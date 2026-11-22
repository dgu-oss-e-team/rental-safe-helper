// PART 2. 사진(OCR)이 시·도나 시·군·구 이름을 틀리게 읽은 주소도 찾는다 (상욱님 사진 점검)
// 주소·이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { findAddresses } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE, REVIEW_STATUS, SOURCE_TYPE } from '../src/shared/document-model.js';

const found = (/** @type {string} */ t) => findAddresses(t).map((a) => ({ value: a.value, uncertain: a.uncertain ?? false }));

describe('PART 2 시·도 이름이 틀리게 읽힌 주소', () => {
  it('"서물특별시", "서득별시", "셔울특별시"도 도로명·동 + 번지가 뒤에 있으면 주소로 찾는다 (확인 필요)', () => {
    expect(found('임차인 주소 서물특별시 중구 가상로 30, 2층 204호(가상동)')).toEqual([
      { value: '서물특별시 중구 가상로 30, 2층 204호(가상동)', uncertain: true },
    ]);
    expect(found('주택 소재지 서득별시 중구 기싱동2가 47-12 기상하우스 제4층 제402호')).toEqual([
      { value: '서득별시 중구 기싱동2가 47-12 기상하우스 제4층 제402호', uncertain: true },
    ]);
    expect(found('셔울특별시 중구 가상로 30')).toEqual([{ value: '셔울특별시 중구 가상로 30', uncertain: true }]);
  });

  it('시·도 이름과 시·군·구가 붙어 읽혀도 찾는다', () => {
    expect(found('서물특별시중구 가상로 30, 204호')).toEqual([{ value: '서물특별시중구 가상로 30, 204호', uncertain: true }]);
  });

  it('바르게 읽힌 주소는 지금처럼 찾고 확인 필요 표시가 없다', () => {
    expect(found('서울특별시 중구 가상로 30, 2층 204호(가상동)')).toEqual([
      { value: '서울특별시 중구 가상로 30, 2층 204호(가상동)', uncertain: false },
    ]);
  });
});

describe('PART 2 시·군·구 이름이 틀리게 읽힌 주소', () => {
  it('"서울특별시 AdET 가상로 14,301호"도 찾는다 (확인 필요)', () => {
    expect(found('서울특별시 AdET 가상로 14,301호(가상동,가상빌라)')).toEqual([
      { value: '서울특별시 AdET 가상로 14,301호(가상동,가상빌라)', uncertain: true },
    ]);
  });
});

describe('PART 2 OCR 주소 모양: 일상 문장은 주소로 보지 않는다', () => {
  it('도로명·동 + 번지 숫자가 없으면 찾지 않는다', () => {
    expect(found('매도 시 중구 쪽 집을 본다')).toEqual([]);
    expect(found('계약 해지시 지구 단위로 정한다')).toEqual([]);
    expect(found('임대인은 의도 지시 동의 후 3개월 안에 알린다')).toEqual([]);
    expect(found('서물특별시 중구')).toEqual([]);
  });

  it('표 옆 칸 끊기는 똑같이 한다 ("2018년3월14일 등기" 앞에서 끊음)', () => {
    expect(found('1 1. 서물특별시 중구 기싱동2가 47-12 대 298㎡ 2018년3월14일 등기')).toEqual([
      { value: '서물특별시 중구 기싱동2가 47-12', uncertain: true },
    ]);
  });
});

describe('PART 2 사진 계약서: 시·도 이름이 틀리게 읽혀도 멈추지 않고 AI로 가지 않는다', () => {
  const lines = [
    '주택임대차표준계약서',
    '임차인 성명 왕가상 주소 서물특별시 중구 가상로 30, 2층 204호(가상동)',
    '주택 소재지 서득별시 중구 기싱동2가 47-12 기상하우스 제4층 제402호',
    '보증금 금10,000,000원',
    '임대인 성명 김가상 주민등록번호 720303-1******',
  ];
  const doc = {
    documentId: 'LEASE',
    fileName: 'LEASE.jpg',
    sourceType: SOURCE_TYPE.IMAGE,
    pages: [
      {
        pageIndex: 0,
        width: 1240,
        height: 1754,
        blocks: lines.map((text, i) => ({
          blockId: `p0_b${i}`,
          text,
          bbox: { x: 0.05, y: (i + 1) / (lines.length + 2), width: 0.9, height: 0.01 },
          confidence: 0.85,
        })),
      },
    ],
  };
  const analyze = () => {
    const a = analyzeReadDocuments({ files: [], documents: [doc] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    return a.data;
  };

  it('두 주소를 찾고 ④에서 확인하도록 표시한다', () => {
    const addresses = analyze().findings.filter((f) => f.type === PII_TYPE.ADDRESS);
    expect(addresses.map((f) => f.value)).toEqual([
      '서물특별시 중구 가상로 30, 2층 204호(가상동)',
      '서득별시 중구 기싱동2가 47-12 기상하우스 제4층 제402호',
    ]);
    for (const f of addresses) expect(f.reviewStatus).toBe(REVIEW_STATUS.NEEDS_REVIEW);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 보내기 전 검사에서 멈추지 않고, 호수·번지가 AI로 가지 않는다`, () => {
      const r = prepareForAi(analyze(), purpose);
      expect(r.ok, r.ok ? '' : `stopped at ${r.step}: ${r.error.message}`).toBe(true);
      if (!r.ok) return;
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const part of ['204호', '47-12', '제402호', '가상로 30']) expect(shared, part).not.toContain(part);
    });
  }

  it('집 주소의 시·도 이름이 정식이 아니라 주소 비교는 "다름"이 아니라 확인 불가로 간다', () => {
    const risk = analyze().riskResults.find((x) => x.ruleId === 'ADDRESS_MISMATCH');
    expect(risk?.status).not.toBe('STOP');
  });
});
