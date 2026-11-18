import { describe, it, expect } from 'vitest';
import { extractFields } from '../src/features/document-analysis/index.js';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';

/** 줄 목록으로 가짜 등기부를 만든다. (블록 하나 = 줄 하나) */
const registryOf = (bodyLines) => ({
  documentId: 'DOC_REG',
  documentType: DOCUMENT_TYPE.UNKNOWN,
  sourceType: SOURCE_TYPE.TEXT_PDF,
  pages: [
    {
      pageIndex: 0,
      width: 2480,
      height: 3508,
      blocks: [
        '등기사항전부증명서 고유번호 0000-2023-357924',
        '[집합건물] 서울특별시 성동구 가상동 246-8 가상타운 제3층 제301호',
        '【 표 제 부 】 ( 1동의 건물의 표시 )',
        '【 갑 구 】 【 을 구 】',
        ...bodyLines,
      ].map((text, i) => ({
        blockId: `BLOCK_${i + 1}`,
        text,
        bbox: { x: 0.1, y: 0.05 * i, width: 0.5, height: 0.03 },
        confidence: null,
      })),
    },
  ],
});

const roadAddressOf = (bodyLines) => {
  const r = extractFields([registryOf(bodyLines)], []);
  if (!r.ok) throw new Error(r.error.code);
  return r.data.registry.roadAddress;
};

describe('#177 등기부 [도로명주소] 읽기', () => {
  it('옆 칸 글자와 섞여 줄이 나뉘어도 도로명주소만 읽는다 (#196 재현)', () => {
    expect(
      roadAddressOf([
        '1 2023년12월4일 서울특별시 성동구 가상동 246-8',
        '[도로명주소] 서울특별시 성동구 22층 공동주택(아파트) 및',
        '가상로 00 근린생활시설',
        '가상타운 (철근)콘크리트지붕',
      ]),
    ).toBe('서울특별시 성동구 가상로 00');
  });

  it('줄이 깨끗하게 나뉜 순서도 같은 결과', () => {
    expect(
      roadAddressOf([
        '[도로명주소] 서울특별시 성동구',
        '가상로 00',
        '철근콘크리트구조',
        '(철근)콘크리트지붕',
      ]),
    ).toBe('서울특별시 성동구 가상로 00');
  });

  it('한 줄로 읽혀도 읽는다', () => {
    expect(roadAddressOf(['[도로명주소] 서울특별시 성동구 가상로 00'])).toBe('서울특별시 성동구 가상로 00');
  });

  it('도로명이 없고 옆 칸 글자만 있으면 null (확인 불가로 떨어진다)', () => {
    expect(
      roadAddressOf(['[도로명주소] 서울특별시 성동구 22층 공동주택(아파트) 및', '근린생활시설', '철근콘크리트구조']),
    ).toBeNull();
  });

  it('시·군·구가 없으면 null', () => {
    expect(roadAddressOf(['[도로명주소] 22층 공동주택(아파트) 및', '가상로 00 근린생활시설'])).toBeNull();
  });

  it('도로명 후보가 둘 이상이면 추측하지 않고 null', () => {
    expect(roadAddressOf(['[도로명주소] 서울특별시 성동구', '가상로 00', '다른로 12'])).toBeNull();
  });

  it('[도로명주소] 라벨이 없으면 null', () => {
    expect(roadAddressOf(['1 2023년12월4일 서울특별시 성동구 가상동 246-8'])).toBeNull();
  });
});
