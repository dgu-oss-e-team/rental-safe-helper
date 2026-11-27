import { describe, it, expect } from 'vitest';
import { findRegistryRights } from '../src/features/document-analysis/field-extractor.js';

// 이슈 #358: 등기부 을구 전세권의 "전세금", 임차권등기의 "임차보증금"을 depositAmount로 읽는다.
// 모든 줄은 지어낸 값이다.

const GAP = '【 갑 구 】 (소유권에 관한 사항)';
const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
const registry = (/** @type {string[]} */ eul) => [
  '등기사항전부증명서(말소사항 포함)',
  GAP,
  '1 소유권보존 2020년1월1일 소유자 홍가상',
  EUL,
  ...eul,
];

describe('PART 2 등기부 전세금·임차보증금 (depositAmount, #358)', () => {
  it('전세권 줄에 같이 적힌 전세금을 읽는다', () => {
    const r = findRegistryRights(
      registry(['1 전세권설정 2023년1월1일 제1234호 2022년12월20일 설정계약 전세금 금200,000,000원']),
    );
    expect(r?.[0]).toMatchObject({ kind: 'JEONSE', depositAmount: 200000000, maxClaimAmount: null });
  });

  it('다음 줄에 있는 전세금도 읽는다 (권리자 줄과 섞여도)', () => {
    const r = findRegistryRights(
      registry([
        '1 전세권설정 2023년1월1일 제1234호 2022년12월20일 설정계약',
        '전세금 금150,000,000원',
        '범 위 주거용 건물의 전부',
        '전세권자 김가상',
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r?.[0]).toMatchObject({ kind: 'JEONSE', depositAmount: 150000000, holder: '김가상' });
  });

  it('한글 금액("금일억오천만원")과 띄어 쓴 칸 이름("전 세 금")도 읽는다', () => {
    const r = findRegistryRights(registry(['1 전세권설정 2023년1월1일 설정계약', '전 세 금 금일억오천만원']));
    expect(r?.[0].depositAmount).toBe(150000000);
  });

  it('임차권등기의 임차보증금을 읽는다', () => {
    const r = findRegistryRights(
      registry([
        '1 주택임차권 2024년2월1일 제500호 2024년1월15일 서울중앙지방법원의 임차권등기명령(2024카임10)',
        '임차보증금 금80,000,000원',
        '차 임 월 500,000원',
        '임차권자 이가상',
      ]),
    );
    expect(r?.[0]).toMatchObject({ kind: 'LEASEHOLD', depositAmount: 80000000 });
  });

  it('금액이 없으면 null이고, 다음 권리의 채권최고액을 전세금으로 가져오지 않는다', () => {
    const r = findRegistryRights(
      registry([
        '1 전세권설정 2023년1월1일 설정계약',
        '전세권자 김가상',
        '2 근저당권설정 2024년3월3일 설정계약 채권최고액 금120,000,000원',
      ]),
    );
    expect(r?.map((x) => [x.kind, x.depositAmount, x.maxClaimAmount])).toEqual([
      ['JEONSE', null, null],
      ['MORTGAGE', null, 120000000],
    ]);
  });

  it('근저당 등 다른 권리는 "전세금" 글자가 있어도 depositAmount가 null이다', () => {
    const r = findRegistryRights(
      registry(['1 근저당권설정 2024년3월3일 설정계약 채권최고액 금120,000,000원', '전세금 금50,000,000원']),
    );
    expect(r?.[0]).toMatchObject({ kind: 'MORTGAGE', depositAmount: null, maxClaimAmount: 120000000 });
  });

  it('변경 부기등기("1-1 1번전세권변경")의 금액은 읽지 않고 처음 설정한 전세금을 둔다', () => {
    const r = findRegistryRights(
      registry([
        '1 전세권설정 2023년1월1일 설정계약 전세금 금100,000,000원',
        '1-1 1번전세권변경 2024년1월1일 변경계약 전세금 금120,000,000원',
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r?.[0].depositAmount).toBe(100000000);
  });
});
