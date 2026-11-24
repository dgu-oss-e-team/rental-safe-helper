// PART 2. 사진 등기부의 표 칸 때문에 나뉘거나 따로 읽힌 주소 조각 (상욱님 가짜세트4 사진)
// - "…가상로17길 9, |" / "203호(가상동) |": 표 칸 선이 주소 끝에 붙어 아랫줄을 잇지 못하던 문제
// - "서울특별시 동대문구 가상로17길" / "9": 도로 이름 다음 줄의 건물번호
// - "a ⎸ 212-5 ⎸ (철근)콘크리트지붕", "p ⎸ 가상스테이 ⎸ 5충 다세대주택": 표제부 칸에 따로 읽힌 지번·건물 이름
// - "1 ⎸ 2019년4월2일 ⎸ 제3충 제203호": 층을 충으로 잘못 읽은 전유부분 층·호수
// 주소·이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { detectPII } from '../src/features/document-analysis/index.js';
import {
  addressPiecesOf,
  findAddresses,
  findAddressContinuation,
  findFloorUnits,
} from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE, REVIEW_STATUS, SOURCE_TYPE } from '../src/shared/document-model.js';

/** @param {string[]} lines @param {string} sourceType */
const docOf = (lines, sourceType = SOURCE_TYPE.IMAGE_PDF) => ({
  documentId: 'REG',
  fileName: 'REG.pdf',
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
        confidence: sourceType === SOURCE_TYPE.TEXT_PDF ? null : 0.9,
      })),
    },
  ],
});

const REG = [
  '등기사항전부증명서(말소사항 포함)',
  '[집합건물] 서울특별시 가상구 가상동 212-5 가상스테이 제2층 제203호',
  '【 표 제 부 】 ( 1동의 건물의 표시 )',
  '1 ⎸ 2019년4월2일 ⎸ 서울특별시 가상구 가상동',
  'p ⎸ 가상스테이 ⎸ 5충 다세대주택',
  'a ⎸ 212-5 ⎸ (철근)콘크리트지붕',
  '[도로명주소]',
  '서울특별시 가상구 가상로17길',
  '9',
  '【 표 제 부 】 ( 전유부분의 건물의 표시 )',
  '1 ⎸ 2019년4월2일 ⎸ 제3충 제203호',
  '【 갑 구 】 ( 소유권에 관한 사항 )',
  '1 소유권보존 2019년4월2일 소유자 전가상 790318-*******',
  '제23118호 서울특별시 가상구 가상로17길 9, |',
  '203호(가상동) |',
  '1-1 1번등기명의인표시 2022년5월30일 전가상의 주소 서울특별시 가상구 가상로',
  '변경 전거 63, 505호(가상동,가상맨션)',
];

/** @param {any[]} findings @param {number} i */
const valuesAt = (findings, i) =>
  findings.filter((f) => f.blockId === `p0_b${i}` && f.type === PII_TYPE.ADDRESS).map((f) => f.value);

describe('PART 2 주소 끝의 표 칸 선', () => {
  it('주소 값에서 끝의 "|", "ㅣ"를 뗀다', () => {
    expect(findAddresses('제23118호 서울특별시 가상구 가상로17길 9, |').map((r) => r.value)).toEqual([
      '서울특별시 가상구 가상로17길 9,',
    ]);
    expect(findAddresses('서울특별시 가상구 가상로 4 ㅣ').map((r) => r.value)).toEqual(['서울특별시 가상구 가상로 4']);
  });

  it('칸 선이 붙어 있어도 아랫줄 "203호(가상동) |"을 잇는다', () => {
    const r = detectPII(docOf(REG));
    if (!r.ok) throw new Error('detect failed');
    expect(valuesAt(r.data, 13)).toEqual(['서울특별시 가상구 가상로17길 9,']);
    expect(valuesAt(r.data, 14)).toEqual(['203호(가상동)']);
    expect(valuesAt(r.data, 16)).toEqual(['63, 505호(가상동,가상맨션)']);
  });
});

describe('PART 2 도로 이름 다음 줄의 건물번호', () => {
  it('윗줄이 "로"·"길"로 끝났을 때만 숫자만 있는 줄을 잇는다', () => {
    expect(findAddressContinuation('9', false, false, true)?.value).toBe('9');
    expect(findAddressContinuation('12-3 ⎸', false, false, true)?.value).toBe('12-3');
    expect(findAddressContinuation('9', false, false, false)).toBeNull();
    expect(findAddressContinuation('9 철근콘크리트구조', false, false, true)).toBeNull();
  });
});

describe('PART 2 addressPiecesOf: 다시 찾을 지번·건물 이름 조각', () => {
  it('하이픈 지번, 층 앞의 건물 이름, 괄호 안 건물 이름', () => {
    expect(addressPiecesOf('서울특별시 가상구 가상동 212-5 가상스테이 제2층 제203호')).toEqual(['212-5', '가상스테이']);
    expect(addressPiecesOf('서울특별시 가상구 가상로 63, 502호(가상동,가상맨션)')).toEqual(['가상맨션']);
  });

  it('숫자만 있는 지번, 2글자 건물 이름, 동 이름은 넣지 않는다', () => {
    expect(addressPiecesOf('서울특별시 가상구 가상동 15 가상 제2층 제203호')).toEqual([]);
    expect(addressPiecesOf('서울특별시 가상구 가상로 4, 2층 201호(가상동)')).toEqual([]);
  });
});

describe('PART 2 findFloorUnits: 층·호수', () => {
  it('"충"으로 잘못 읽은 것은 확인 필요로 표시한다', () => {
    expect(findFloorUnits('1 ⎸ 2019년4월2일 ⎸ 제3충 제203호')).toEqual([
      { type: PII_TYPE.ADDRESS, value: '제3충 제203호', start: 16, end: 25, uncertain: true },
    ]);
    expect(findFloorUnits('제2층 제203호')[0].uncertain).toBe(false);
    expect(findFloorUnits('별지 제1호 서식')).toEqual([]);
  });
});

describe('PART 2 사진 등기부 표제부 칸의 주소 조각', () => {
  it('따로 읽힌 지번·건물 이름·건물번호·층호수를 찾는다', () => {
    const r = detectPII(docOf(REG));
    if (!r.ok) throw new Error('detect failed');
    expect(valuesAt(r.data, 4)).toEqual(['가상스테이']);
    expect(valuesAt(r.data, 5)).toEqual(['212-5']);
    expect(valuesAt(r.data, 8)).toEqual(['9']);
    const unit = r.data.find((f) => f.value === '제3충 제203호');
    expect(unit?.reviewStatus).toBe(REVIEW_STATUS.NEEDS_REVIEW);
  });

  it('글자 PDF에는 조각 다시 찾기·층호수 규칙을 쓰지 않는다', () => {
    const r = detectPII(docOf(['서울특별시 가상구 가상동 212-5 가상스테이 제2층 제203호', '212-5', '제3충 제203호'], SOURCE_TYPE.TEXT_PDF));
    if (!r.ok) throw new Error('detect failed');
    expect(valuesAt(r.data, 1)).toEqual([]);
    expect(valuesAt(r.data, 2)).toEqual([]);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 주소 조각이 AI로 가지 않는다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [docOf(REG)] });
      if (!a.ok) throw new Error('analyze failed');
      const r = prepareForAi(a.data, purpose);
      if (!r.ok) throw new Error(`prepare failed: ${r.error.message}`);
      const sent = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const piece of ['212-5', '가상스테이', '제203호', '203호(', '63, 505', '가상맨션', '17길']) {
        expect(sent).not.toContain(piece);
      }
    });
  }
});
