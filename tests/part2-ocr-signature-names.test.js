// PART 2. 사진 OCR에서 칸 이름이 사라지거나 표 칸 선이 섞인 이름 줄 (상욱님 가짜세트4 사진, #311 이후)
// - "카카오뱅크 ㅣ예금주 ㅣ 전우치", "개업공인 ⎸ 김삿갓": 라벨과 이름 사이의 표 칸 선
// - "전우치 (서명 또는 인)": 칸 이름 없이 서명란 표시만 남은 이름 (사진 서류만)
// - "임 대 사 업 자 로서의 지 위": 한 글자씩 띄어 읽혀 조사 낱말이 이름으로 잡히던 문제
// - "개업공인 ⎸ 대표자 성명 ⎸ 김삿갓": 중개사가 위의 임대인 역할을 이어받던 문제 (거짓 STOP)
// 이름·번호·주소는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { detectPII } from '../src/features/document-analysis/index.js';
import { findLabeledNames, findSignatureNames, findPeople } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';

/** @param {string} documentId @param {string[]} lines @param {string} sourceType */
const docOf = (documentId, lines, sourceType = SOURCE_TYPE.IMAGE_PDF) => ({
  documentId,
  fileName: `${documentId}.pdf`,
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

/** @param {any} r */
const names = (r) => r.map((/** @type {any} */ p) => [p.value, p.role]);

describe('PART 2 라벨과 이름 사이의 표 칸 선', () => {
  it('"ㅣ", "|", "⎸", "│"가 있어도 라벨 뒤 이름을 찾는다', () => {
    expect(names(findLabeledNames('카카오뱅크 ㅣ예금주 ㅣ 전가상'))).toEqual([['전가상', 'ACCOUNT_HOLDER']]);
    expect(names(findLabeledNames('임대인 | 김가상'))).toEqual([['김가상', 'LANDLORD']]);
    expect(names(findLabeledNames('임차인│박가상'))).toEqual([['박가상', 'TENANT']]);
    expect(names(findLabeledNames('성명 ⎸ 이가상', 'TENANT'))).toEqual([['이가상', 'TENANT']]);
  });

  it('표 칸 선 뒤에 와도 이름이 아닌 낱말은 그대로 거른다', () => {
    expect(findLabeledNames('임대인 ㅣ 주소 ㅣ 서울특별시')).toEqual([]);
    expect(findLabeledNames('예금주 | 명의')).toEqual([]);
  });

  it('줄여 읽힌 "개업공인" 뒤 이름은 중개사다', () => {
    expect(names(findLabeledNames('개업공인 ⎸ 김삿갓 ⎸ GLEE]'))).toEqual([['김삿갓', 'BROKER']]);
    // "개업공인중개사가 …" 문장, "개업공인 중개사"는 이름이 없다
    expect(findLabeledNames('※ 개업공인중개사가 임대차계약서를 작성하는 경우')).toEqual([]);
    expect(findLabeledNames('개업공인 중개사 서울특별시 가상구')).toEqual([]);
  });

  it('"대표자 성명 김삿갓"은 이름을 찾되 역할은 붙이지 않는다', () => {
    expect(names(findPeople('개업공인 ⎸ 대표자 성명 ⎸ 김삿갓 ⎸ (서명 및 인)', 'LANDLORD'))).toEqual([['김삿갓', null]]);
  });
});

describe('PART 2 한 글자씩 띄어 읽힌 문장의 조사 낱말', () => {
  it('"임 대 사 업 자 로서의 지 위"의 "로서의"는 이름이 아니다', () => {
    expect(findLabeledNames('양 도 하는 자의 임 대 사 업 자 로서의 지 위 를 포 괄 적 으로')).toEqual([]);
    expect(findLabeledNames('임 차 인 으로부터 받은')).toEqual([]);
    expect(findLabeledNames('임대인 로부터')).toEqual([]);
  });
});

describe('PART 2 findSignatureNames: 서명란 표시 바로 앞의 이름', () => {
  it('"(서명 또는 인)", "(서명 및 인)", "(서명 또는 날인)" 앞 이름을 찾는다 (역할 없음)', () => {
    expect(names(findSignatureNames('전가상 (서명 또는 인)'))).toEqual([['전가상', null]]);
    expect(names(findSignatureNames('( 법 인 명) SATO YK (서명 또는 인)'))).toEqual([['SATO YK', null]]);
    expect(names(findSignatureNames('김가상 ⎸ (서명 및 인)'))).toEqual([['김가상', null]]);
    expect(names(findSignatureNames('박가상 (서 명 또 는 날 인)'))).toEqual([['박가상', null]]);
    const r = findSignatureNames('xx 전가상 (서명 또는 인)')[0];
    expect([r.start, r.end]).toEqual([3, 6]);
  });

  it('라벨 낱말, 회사 이름, 영문 1-2글자, 서명란 없는 줄은 아니다', () => {
    expect(findSignatureNames('임대인 (서명 또는 인)')).toEqual([]);
    expect(findSignatureNames('주식회사가상리츠 (서명 또는 인)')).toEqual([]);
    expect(findSignatureNames('가상 주식회사 (서명 또는 인)')).toEqual([]);
    expect(findSignatureNames('AH (서명 및 인)')).toEqual([]);
    expect(findSignatureNames('각각 서명 또는 날인한 후 1통씩 보관한다')).toEqual([]);
  });
});

describe('PART 2 사진 계약서: 칸 이름 없는 이름 줄', () => {
  const LEASE = [
    '표준임대차계약서',
    '1. 계약 당사자',
    '전가상 (서명 또는 인)',
    '서울특별시 성북구 가상로 63, 502호(가상동,가상맨션)',
    '임대사업자',
    '( 법 인 명) SATO YK (서명 또는 인)',
    '임차인 서울특별시 동대문구 가상로 4, 2층 201호(가상동)',
    '2. 공인중개사',
    '개업공인 ⎸ 대표자 성명 ⎸ 김삿갓 ⎸ (서명 및 인)',
    '중개사 서울특별시 동대문구 가상로 21, 1층(가상동)',
    '계좌번호 카카오뱅크 ㅣ예금주 ㅣ 전가상',
  ];

  it('사진 서류에서는 서명란 이름도 찾는다', () => {
    const r = detectPII(docOf('LEASE', LEASE));
    if (!r.ok) throw new Error('detect failed');
    const found = r.data.filter((f) => f.type === PII_TYPE.PERSON_NAME).map((f) => f.value);
    expect(found).toEqual(expect.arrayContaining(['전가상', 'SATO YK', '김삿갓']));
  });

  it('글자 PDF는 서명란 규칙을 쓰지 않는다 (칸 이름이 남아서 라벨로 찾는다)', () => {
    const r = detectPII(docOf('LEASE', ['SATO YK (서명 또는 인)'], SOURCE_TYPE.TEXT_PDF));
    if (!r.ok) throw new Error('detect failed');
    expect(r.data.filter((f) => f.type === PII_TYPE.PERSON_NAME)).toEqual([]);
  });

  it('중개사(김삿갓)는 임대인이 되지 않는다, 예금주는 찾는다', () => {
    const a = analyzeReadDocuments({ files: [], documents: [docOf('LEASE', LEASE)] });
    if (!a.ok) throw new Error('analyze failed');
    const { contract } = a.data.fields;
    const all = [...(contract.landlords ?? []), ...(contract.tenants ?? [])].map((p) => p.name);
    expect(all).not.toContain('김삿갓');
    expect(contract.accountHolders?.map((p) => p.name)).toEqual(['전가상']);
  });

  for (const purpose of Object.values(MASKING_PURPOSE)) {
    it(`${purpose}: 이름이 AI로 가지 않는다`, () => {
      const a = analyzeReadDocuments({ files: [], documents: [docOf('LEASE', LEASE)] });
      if (!a.ok) throw new Error('analyze failed');
      const r = prepareForAi(a.data, purpose);
      if (!r.ok) throw new Error(`prepare failed: ${r.error.message}`);
      const sent = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      for (const name of ['전가상', 'SATO YK', '김삿갓']) expect(sent).not.toContain(name);
    });
  }
});
