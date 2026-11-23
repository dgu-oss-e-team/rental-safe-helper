// PART 2. 사진·스캔(OCR)에서 별표 개수가 틀리게 읽힌 가려진 주민번호도 찾는다 (상욱님 OCR 점검)
// 이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { findIdNumbers, findPatternPII } from '../src/features/document-analysis/pii-patterns.js';
import { MASKING_PURPOSE, PII_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';

const ids = (/** @type {string} */ text) => findIdNumbers(text).map((r) => ({ type: r.type, value: r.value }));

describe('PART 2 별표 개수가 7개가 아닌 가려진 주민·외국인등록번호', () => {
  it('별표 6개·5개도 찾고, 확인 필요(uncertain)로 표시한다', () => {
    expect(ids('김가상 760423-******')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423-******' }]);
    expect(ids('박가상 690812-*****')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '690812-*****' }]);
    expect(findIdNumbers('박가상 690812-*****')[0]).toMatchObject({ uncertain: true });
  });

  it('뒤에 엉뚱한 글자가 붙으면 별표까지만 잡는다 ("680918-***져")', () => {
    expect(ids('이가상 680918-***져')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '680918-***' }]);
  });

  it('뒷자리 첫 숫자로 내국인·외국인을 나누고, 별표가 8개 이상이어도 찾는다', () => {
    expect(ids('왕가상 030827-6*****')).toEqual([{ type: PII_TYPE.FOREIGNER_ID, value: '030827-6*****' }]);
    expect(ids('최가상 711205-1********')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '711205-1********' }]);
  });

  it('OCR이 하이픈을 "–"로, 별표를 전각 "＊"로 읽어도 찾는다', () => {
    expect(ids('김가상 760423–******')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423–******' }]);
    expect(ids('김가상 760423-＊＊＊＊＊＊')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423-＊＊＊＊＊＊' }]);
  });

  it('별표 7개는 지금처럼 한 번만 찾는다 (확인 필요 표시도 지금과 같다)', () => {
    expect(findIdNumbers('김가상 760423-1******')).toEqual([
      { type: PII_TYPE.RESIDENT_ID, value: '760423-1******', start: 4, end: 18, uncertain: false },
    ]);
  });

  it('별표가 없는 짧은 번호, 날짜가 아닌 앞자리는 잡지 않는다', () => {
    expect(ids('번호 760423-12')).toEqual([]);
    expect(ids('번호 761399-*****')).toEqual([]); // 13월 99일은 생년월일이 아니다
    expect(ids('2018-****')).toEqual([]);
  });

  it('법인등록번호 자리(회사 이름 뒤)는 REGISTRY_ID로 본다', () => {
    expect(ids('근저당권자 주식회사가상은행 110111-*****')).toEqual([{ type: PII_TYPE.REGISTRY_ID, value: '110111-*****' }]);
  });

  it('전체 정규식 탐지(findPatternPII)에서도 한 번만 나온다', () => {
    const r = findPatternPII('공유자 김가상 760423-****** 서울특별시');
    expect(r.filter((x) => x.value.startsWith('760423'))).toHaveLength(1);
  });
});

describe('PART 2 사진 서류에서 별표 개수가 틀린 주민번호의 생년월일이 AI로 가지 않는다', () => {
  const lines = [
    '등기사항전부증명서(말소사항 포함)',
    '[집합건물] 서울특별시 중구 가상동2가 47-12 가상하우스 제4층 제402호',
    '【 갑 구 】 ( 소유권에 관한 사항 )',
    '1 소유권보존 2018년3월14일 공유자',
    '김가상 760423-******',
    '박가상 690812-*****',
    '2 소유권이전 2018년9월3일 소유자 이가상 680918-***져',
  ];
  const doc = {
    documentId: 'REG',
    fileName: 'REG.jpg',
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
          confidence: 0.8,
        })),
      },
    ],
  };

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 생년월일 3개가 모두 가려진다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [doc] });
      if (!a.ok) throw new Error(`stopped at ${a.step}`);
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      if (!r.ok) return;
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const birth of ['760423', '690812', '680918']) expect(shared, birth).not.toContain(birth);
    });
  }
});

describe('PART 2 뒷자리 별표가 전부 엉뚱한 글자로 읽힌 주민번호 (상욱님 사진 점검)', () => {
  it('"760423-#xwssnr"처럼 뒷자리가 엉뚱한 글자여도 주민번호로 찾는다 (확인 필요)', () => {
    expect(ids('김선달 760423-#xwssnr')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423-#xwssnr' }]);
    expect(findIdNumbers('김선달 760423-#xwssnr')[0]).toMatchObject({ uncertain: true });
    expect(ids('박흥부 680915–Ixx*q')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '680915–Ixx*q' }]);
  });

  it('뒷자리를 하나도 못 읽은 "760423-"도 뒤가 띄어쓰기·줄 끝이면 찾는다', () => {
    expect(ids('김선달 760423-')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423-' }]);
    expect(ids('김선달 760423- 서울특별시 노원구')).toEqual([{ type: PII_TYPE.RESIDENT_ID, value: '760423-' }]);
  });

  it('뒷자리 첫 숫자가 5~8이면 외국인등록번호다', () => {
    expect(ids('왕가상 030827-6x#q')).toEqual([{ type: PII_TYPE.FOREIGNER_ID, value: '030827-6x#q' }]);
  });

  it('뒷자리가 숫자·하이픈만인 번호, "~" 기간, "." 날짜, 생년월일이 아닌 앞자리는 잡지 않는다', () => {
    expect(ids('계좌번호 110423-12-345678 신한은행')).toEqual([]);
    expect(ids('기간 180301~180331일')).toEqual([]);
    expect(ids('2018.03.14-등기')).toEqual([]);
    expect(ids('번호 761399-#xw')).toEqual([]); // 13월 99일은 생년월일이 아니다
    expect(ids('180314-등기')).toEqual([]); // 뒷자리 첫 글자가 한글 (#291 리뷰)
  });

  it('번호 앞의 이름("김선달")도 같이 찾는다', () => {
    const doc = {
      documentId: 'REG2',
      fileName: 'REG2.jpg',
      sourceType: SOURCE_TYPE.IMAGE,
      pages: [
        {
          pageIndex: 0,
          width: 1240,
          height: 1754,
          blocks: ['등기사항전부증명서(말소사항 포함)', '【 갑 구 】 ( 소유권에 관한 사항 )', '1 소유권보존 2018년3월14일 공유자', '김선달 760423-#xwssnr'].map(
            (text, i) => ({ blockId: `p0_b${i}`, text, bbox: { x: 0.05, y: (i + 1) / 6, width: 0.9, height: 0.01 }, confidence: 0.8 }),
          ),
        },
      ],
    };
    const a = analyzeReadDocuments({ files: [], documents: [doc] });
    if (!a.ok) throw new Error(`stopped at ${a.step}`);
    const values = a.data.findings.map((f) => f.value);
    expect(values).toContain('김선달');
    expect(values).toContain('760423-#xwssnr');
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(a.data, purpose);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      if (!r.ok) continue;
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared, purpose).not.toContain('760423');
      expect(shared, purpose).not.toContain('김선달');
    }
  });
});
