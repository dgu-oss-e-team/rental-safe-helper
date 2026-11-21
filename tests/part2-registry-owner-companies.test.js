// PART 2. 등기부 지금 소유자의 회사 이름 (registry.ownerCompanies, #250)
// 회사 이름·사람 이름·번호는 모두 가짜다. 화면 전용 값이라 PART 3가 프롬프트에 넣지 않는다.
import { describe, it, expect } from 'vitest';
import { findCurrentOwnerCompanies } from '../src/features/document-analysis/field-extractor.js';
import { extractFields } from '../src/features/document-analysis/index.js';

const HEAD = '등기사항전부증명서 고유번호 0000-0000-000000';
const GAP = '【 갑 구 】 (소유권에 관한 사항)';
const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

/** @param {string[]} lines */
const doc = (lines) => ({
  documentId: 'REG',
  fileName: 'REG.pdf',
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

const trust = [
  GAP,
  '1 소유권보존 2023년12월4일 소유자 가상주택리츠주식회사 110111-3579246',
  '2 소유권이전 2024년3월8일 2024년3월8일 수탁자 가상자산신탁주식회사 110111-6802467',
  '제24689호 신탁 서울특별시 영등포구 가상로 77(가상동)',
  '신탁 신탁원부 제2024-1357호',
  EUL,
];

describe('PART 2 findCurrentOwnerCompanies()', () => {
  it('신탁이면 지금 소유자 기록의 수탁자를 준다 (법인등록번호·예전 소유자 회사는 빼고)', () => {
    expect(findCurrentOwnerCompanies(trust)).toEqual(['가상자산신탁주식회사']);
  });

  it('법인이 소유자인 경우: "주식회사 가상리츠", "가상리츠 주식회사" 두 가지 쓰기', () => {
    const a = [GAP, '1 소유권보존 2015년1월20일 소유자 최민수 650505-1******', '2 소유권이전 2024년5월10일 매매 소유자 주식회사 가상리츠 110111-0000000', EUL];
    const b = [GAP, '1 소유권보존 2015년1월20일 소유자 가상리츠 주식회사 110111-0000000', EUL];
    expect(findCurrentOwnerCompanies(a)).toEqual(['주식회사 가상리츠']);
    expect(findCurrentOwnerCompanies(b)).toEqual(['가상리츠 주식회사']);
  });

  it('개인 소유자만 있으면 [] (사람 이름은 회사로 보지 않는다)', () => {
    expect(findCurrentOwnerCompanies([GAP, '1 소유권보존 2015년1월20일 소유자 최민수 650505-1******', EUL])).toEqual([]);
  });

  it('예전 소유자였던 회사는 넣지 않는다', () => {
    const lines = [GAP, '1 소유권보존 2015년1월20일 소유자 가상리츠주식회사 110111-0000000', '2 소유권이전 2024년5월10일 소유자 김철수 800101-1******', EUL];
    expect(findCurrentOwnerCompanies(lines)).toEqual([]);
  });

  it('지금 소유자를 정할 수 없으면 null (추측하지 않는다)', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 공유자 박영수', '3 박영수지분전부이전 2024년1월1일 공유자 이영희', EUL];
    expect(findCurrentOwnerCompanies(lines)).toBeNull();
  });

  it('수탁자 이름이 ○○처럼 가려져 있어도 회사로 읽는다', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 소유자 박영수', '3 소유권이전 2024년7월7일 신탁 수탁자 ○○신탁', EUL];
    expect(findCurrentOwnerCompanies(lines)).toEqual(['○○신탁']);
  });

  it('순위번호가 없는 등기부는 모든 줄에서 찾는다', () => {
    expect(findCurrentOwnerCompanies(['소유자 김철수 800101-1******'])).toEqual([]);
    expect(findCurrentOwnerCompanies(['소유자 가상리츠주식회사 110111-0000000'])).toEqual(['가상리츠주식회사']);
  });
});

describe('PART 2 extractFields: registry.ownerCompanies', () => {
  it('신탁 등기부는 수탁자 이름을 ownerCompanies에 넣고, 사람 명단(owners)에는 넣지 않는다', () => {
    const { registry } = extractFields([doc([HEAD, ...trust])], []).data;
    expect(registry.ownerCompanies).toEqual(['가상자산신탁주식회사']);
    expect((registry.owners ?? []).map((/** @type {any} */ p) => p.name)).not.toContain('가상자산신탁주식회사');
  });

  it('개인 소유 등기부는 [] 이고, 등기부가 없으면 null', () => {
    const personal = doc([HEAD, GAP, '1 소유권보존 2015년1월20일 소유자 최민수 650505-1******', EUL]);
    expect(extractFields([personal], []).data.registry.ownerCompanies).toEqual([]);
    expect(extractFields([], []).data.registry.ownerCompanies).toBeNull();
  });
});
