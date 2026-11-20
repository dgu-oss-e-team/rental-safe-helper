// PART 2. 법인 임대사업자 민간임대 계약서 (임대사업자 칸에 회사 이름, 실제 서류와 같은 읽기 순서)
// 회사 이름·사람 이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { buildPersonQuestions } from '../src/features/masking/person-answers.js';
import { corporateNameInField } from '../src/features/document-analysis/name-detector.js';
import { MASKING_PURPOSE, PII_TYPE } from '../src/shared/document-model.js';

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
        bbox: { x: 0.1, y: (i + 1) / (lines.length + 2), width: 0.8, height: 0.01 },
        confidence: null,
      })),
    },
  ],
});

const LEASE = [
  '■ 민간임대주택에 관한 특별법 시행규칙 [별지 제24호서식]',
  '표 준 임 대 차 계 약 서',
  '임대사업자와 임차인은 아래의 같이 임대차계약을 체결하고 이를 증명하기 위해 계약서 2통을 작성하',
  '계약일: 2026년 11월 18일',
  '1. 계약 당사자',
  '성명(법인명)',
  '주식회사가상위탁관리부동산투자회사 (서명 또는 인)',
  '주소',
  '서울특별시 중구 가상로 12, 3층(가상동)',
  '(대표 사무소 소재지)',
  '임대사업자',
  '주민등록번호',
  '110111-6000000 전화번호 02-0000-0000',
  '(사업자등록번호)',
  '임대사업자',
  '2020-서울중구-00123',
  '등록번호',
  '성명(법인명) 이가상 (서명 또는 인)',
  '임차인 주소 경기도 고양시 일산동구 가상로 1234, 101동 1001호',
  '주민등록번호 040404-3123456 전화번호 010-0000-2222',
  '2. 공인중개사(개업공인중개사가 계약서를 작성하는 경우 해당)',
  '3. 민간임대주택의 표시',
  '주택 소재지 서울특별시 중구 가상동 123 가상타워 제7층 제702호',
  '계좌번호 123456-12-000000 은행 가상은행 예금주 최가상',
  '② 임차인은 임대사업자로부터 제1항의 사항에 대한 설명을 듣고 이해했음을 아래와 같이 확인한다.',
  '임차인 성명: 이가상 (서명 또는 날인)',
];

const analyze = (lines = LEASE) => {
  const r = analyzeReadDocuments({ files: [], documents: [doc('LEASE', lines)] });
  if (!r.ok) throw new Error(`stopped at ${r.step}`);
  return r.data;
};

describe('PART 2 "성명(법인명)" 칸의 회사 이름 (corporateNameInField)', () => {
  it('윗 블록이 칸 이름이거나 같은 블록에서 칸 이름 뒤에 회사 이름이 오면 위치를 준다', () => {
    expect(corporateNameInField('성명(법인명)', '주식회사가상리츠 (서명 또는 인)')).toBe(0);
    expect(corporateNameInField('', '성명(법인명) 가상위탁관리부동산투자회사')).toBe(8);
    expect(corporateNameInField('성명(법인명)', '가상건설(주)')).toBe(0);
  });

  it('사람 이름이거나 칸 이름이 없으면 -1', () => {
    expect(corporateNameInField('성명(법인명)', '김가상 (서명 또는 인)')).toBe(-1);
    expect(corporateNameInField('주소', '주식회사가상리츠')).toBe(-1);
    expect(corporateNameInField('', '성명(법인명) 이가상')).toBe(-1);
  });
});

describe('PART 2 법인 임대사업자 민간임대 계약서', () => {
  it('임차인을 임대인으로 읽지 않고, 이름 뒤 주민번호로 생년월일을 읽는다', () => {
    const { contract } = analyze().fields;
    expect(contract.landlords).toEqual([]); // 회사는 사람 비교 대상이 아니다 (팀 결정 B안 → 확인 불가)
    expect(contract.tenants.map((p) => p.name)).toEqual(['이가상', '이가상']);
    expect(contract.tenants[0].birthDate).toBe('040404');
  });

  it('임대인↔임차인 "같은 사람인가요?" 질문이 생기지 않는다', () => {
    const data = analyze();
    expect(buildPersonQuestions(data.fields, data.personGroups)).toEqual([]);
  });

  it('"계좌번호"를 사람 이름으로 잡지 않는다', () => {
    const names = analyze().findings.filter((f) => f.type === PII_TYPE.PERSON_NAME).map((f) => f.value);
    expect(names).not.toContain('계좌번호');
    expect(names).toContain('최가상');
  });

  it('임차인 줄이 임대인 가명으로 나가지 않고, 개인정보가 남지 않는다', () => {
    for (const purpose of Object.values(MASKING_PURPOSE)) {
      const r = prepareForAi(analyze(), purpose);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
      expect(shared).not.toMatch(/\[Landlord_/);
      for (const v of ['이가상', '최가상', '040404', '010-0000-2222', '123456-12-000000']) expect(shared).not.toContain(v);
    }
  });

  it('임대사업자 칸이 같은 블록에 "성명(법인명) 회사이름"으로 읽혀도 같다', () => {
    const at = LEASE.indexOf('성명(법인명)');
    const lines = [...LEASE.slice(0, at), `성명(법인명) ${LEASE[at + 1]}`, ...LEASE.slice(at + 2)];
    const { contract } = analyze(lines).fields;
    expect(contract.landlords).toEqual([]);
    expect(contract.tenants[0]).toMatchObject({ name: '이가상', birthDate: '040404' });
  });
});
