// PART 2. 역할 칸이 이름보다 뒤에 나오는 표 (#205)
// 민간임대 표준임대차계약서([별지 제24호서식])를 PDF로 읽으면 "임대사업자"·"임차인" 칸(세로로 합친 칸)이 이름 뒤에 나온다.
// 아래 블록은 실제 PDF를 읽은 순서와 같은 모양이다. 이름·번호·주소는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { analyzeReadDocuments, prepareForAi } from '../src/app/pipeline.js';
import { findNameAfterFieldBlock, followsNameField } from '../src/features/document-analysis/name-detector.js';
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
  '계약일: 2026년 11월 17일',
  '1. 계약 당사자',
  '성명(법인명)',
  '김가상 (서명 또는 인)',
  '주소',
  '서울특별시 강남구 가상로 12, 103호(가상동)',
  '(대표 사무소 소재지)',
  '임대사업자',
  '주민등록번호',
  '720303-1****** 전화번호 010-0000-1111',
  '(사업자등록번호)',
  '임대사업자',
  '2017-서울중구-00999',
  '등록번호',
  '성명(법인명) 이가상 (서명 또는 인)',
  '임차인 주소 경기도 고양시 일산동구 가상로 1234, 101동 1001호',
  '주민등록번호 040404-3123456 전화번호 010-0000-2222',
  '2. 공인중개사(개업공인중개사가 계약서를 작성하는 경우 해당)',
  '대표자 성명 (서명 및 인)',
  '3. 민간임대주택의 표시',
  '주택 소재지 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
  '계좌번호 110-000-123456 은행 가상은행 예금주 김가상',
  '② 임차인은 임대사업자로부터 제1항의 사항에 대한 설명을 듣고 이해했음을 아래와 같이 확인한다.',
  '임차인 성명: 이가상 (서명 또는 날인)',
];

const REGISTRY = [
  '등기사항전부증명서(말소사항 포함)',
  '[집합건물] 서울특별시 중구 가상동3가 12-34 가상빌 제3층 제304호',
  '【 갑 구 】 ( 소유권에 관한 사항 )',
  '2 소유권이전 2017년8월21일 2017년4월15일 소유자 김가상 720303-*******',
  '이전 제34857호 매매 서울특별시 강남구 가상로 12,',
  '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )',
  '기록사항 없음',
];

const analyze = (lines = LEASE) => {
  const r = analyzeReadDocuments({ files: [], documents: [doc('REG', REGISTRY), doc('LEASE', lines)] });
  if (!r.ok) throw new Error(`stopped at ${r.step}`);
  return r.data;
};

describe('PART 2 "성명(법인명)" 칸과 이름이 다른 블록 (#205)', () => {
  it('윗 블록이 "성명(법인명)"뿐이면 이 블록 맨 앞의 이름을 찾는다', () => {
    expect(findNameAfterFieldBlock('성명(법인명)', '김가상 (서명 또는 인)').map((p) => [p.value, p.start])).toEqual([
      ['김가상', 0],
    ]);
  });

  it('윗 블록이 칸 이름만 있는 게 아니면 찾지 않는다', () => {
    expect(findNameAfterFieldBlock('주소', '김가상 (서명 또는 인)')).toEqual([]);
    expect(findNameAfterFieldBlock('성명(법인명) 이가상', '김가상')).toEqual([]);
  });

  it('칸 이름 다음 블록이 이름이 아니면(notNames) 찾지 않는다', () => {
    expect(findNameAfterFieldBlock('성명', '주소 서울특별시')).toEqual([]);
  });

  it('"성명(법인명) 김가상"도 성명 칸 이름이다', () => {
    expect(followsNameField('성명(법인명) 김가상', 8)).toBe(true);
    expect(followsNameField('임대인 김가상', 4)).toBe(false);
  });
});

describe('PART 2 역할 칸이 이름 뒤에 나오는 민간임대 계약서 (#205)', () => {
  it('첫 이름은 임대인, 둘째 이름은 임차인으로 읽고, 이름 뒤 주민번호로 생년월일을 읽는다', () => {
    const { contract } = analyze().fields;
    expect(contract.landlords.map((p) => [p.name, p.birthDate])).toEqual([['김가상', '720303']]);
    expect(contract.tenants.map((p) => p.name)).toEqual(['이가상', '이가상']);
    expect(contract.tenants[0].birthDate).toBe('040404');
  });

  it('소유자와 임대인이 같은 사람이라 소유자·임대인 비교가 NO_FLAG다 (확인 불가가 아니라)', () => {
    expect(analyze().riskResults.find((r) => r.ruleId === 'OWNER_MISMATCH')?.status).toBe('NO_FLAG');
  });

  it('임차인 줄이 임대인 가명으로 나가지 않는다', () => {
    const r = prepareForAi(analyze(), MASKING_PURPOSE.FRAUD_CHECK);
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
    const shared = [r.data.prompt, ...Object.values(r.data.maskedText)].join('\n');
    expect(shared).not.toMatch(/성명\(법인명\) \[Landlord/);
    for (const name of ['김가상', '이가상']) expect(shared).not.toContain(name);
  });

  it('원래 순서("임대인" 칸 → 성명) 계약서는 그대로 읽는다', () => {
    const lines = [
      '1. 계약 당사자',
      '임대인',
      '성명 김가상',
      '주민등록번호 720303-1****** 전화번호 010-0000-1111',
      '임차인',
      '성명 이가상',
      '주민등록번호 040404-3123456',
    ];
    const { contract } = analyze(lines).fields;
    expect(contract.landlords.map((p) => [p.name, p.birthDate])).toEqual([['김가상', null]]);
    expect(contract.tenants.map((p) => p.name)).toEqual(['이가상']);
  });

  it('원래 순서 계약서 위에 역할 없는 "확인자 성명"이 있어도 역할이 밀리지 않는다 (#207 리뷰)', () => {
    const lines = [
      '1. 계약 당사자',
      '확인자 성명 최가상',
      '임대인',
      '성명 김가상',
      '주민등록번호 720303-1****** 전화번호 010-0000-1111',
      '임차인',
      '성명 이가상',
      '주민등록번호 040404-3123456',
    ];
    const { contract } = analyze(lines).fields;
    expect(contract.landlords.map((p) => p.name)).toEqual(['김가상']);
    expect(contract.tenants.map((p) => p.name)).toEqual(['이가상']);
  });

  it('한 블록에 "임대인 성명 김가상"처럼 붙어 있어도 위쪽 "확인자 성명" 때문에 밀리지 않는다', () => {
    const lines = ['확인자 성명 최가상', '임대인 성명 김가상', '주소 서울특별시 중구 가상로 7', '임차인 성명 이가상'];
    const { contract } = analyze(lines).fields;
    expect(contract.landlords.map((p) => p.name)).toEqual(['김가상']);
    expect(contract.tenants.map((p) => p.name)).toEqual(['이가상']);
  });
});
