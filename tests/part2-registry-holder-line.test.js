// PART 2. 권리자 칸 줄이 권리를 한 건 더 만들던 문제 (#362·#369·#370 리뷰)
// "제500호 가처분채권자 박가상"처럼 권리자가 다음 줄에 오면, 라벨 속 "가처분"·"전세권"·"근저당" 때문에
// 순위번호 없는 권리가 하나 더 생겼다. 말소된 가처분 옆에 말소 안 된 가처분이 생겨 PART 3가 STOP을 낼 수 있었다.
// 이름·번호는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import { findRegistryRights } from '../src/features/document-analysis/field-extractor.js';

const GAP = '【 갑 구 】 (소유권에 관한 사항)';
const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
const registry = (/** @type {string[]} */ gap, /** @type {string[]} */ eul = ['기록사항 없음']) => [
  '등기사항전부증명서(말소사항 포함)',
  GAP,
  '1 소유권보존 2020년1월1일 소유자 홍가상',
  ...gap,
  EUL,
  ...eul,
];
const brief = (/** @type {ReturnType<typeof findRegistryRights>} */ rights) =>
  rights?.map((r) => ({ kind: r.kind, cancelled: r.cancelled, holder: r.holder }));

describe('PART 2 권리자 칸 줄은 새 권리가 아니다', () => {
  it('말소된 가처분 + 다음 줄 "제500호 가처분채권자 박가상" → 가처분 1건, 말소됨', () => {
    const r = findRegistryRights(
      registry([
        '2 가처분 2024년3월1일 서울중앙지방법원의 가처분결정(2024카합100)',
        '제500호 가처분채권자 박가상',
        '3 2번가처분등기말소 2024년6월1일 해제',
      ]),
    );
    expect(brief(r)).toEqual([{ kind: 'PROVISIONAL_DISPOSITION', cancelled: true, holder: '박가상' }]);
  });

  it('전세권 + 다음 줄 "제100호 설정계약 전세권자 김가상" → 전세권 1건, 권리자·원인 붙음', () => {
    const r = findRegistryRights(
      registry([], ['1 전세권설정 2023년1월1일 전세금 금300,000,000원', '제100호 설정계약 전세권자 김가상']),
    );
    expect(r).toHaveLength(1);
    expect(r?.[0]).toMatchObject({ kind: 'JEONSE', holder: '김가상', cause: '설정계약', cancelled: false });
  });

  it('근저당 + 다음 줄 "제777호 근저당권자 주식회사가상은행" → 근저당 1건, 회사 권리자', () => {
    const r = findRegistryRights(
      registry([], ['1 근저당권설정 2022년6월20일 설정계약 채권최고액 금120,000,000원', '제777호 근저당권자 주식회사가상은행']),
    );
    expect(r).toHaveLength(1);
    expect(r?.[0]).toMatchObject({ kind: 'MORTGAGE', holder: '주식회사가상은행', holderIsCompany: true, maxClaimAmount: 120000000 });
  });

  it.each([
    ['임차권', '1 주택임차권 2024년2월1일 임차권등기명령', '제5호 임차권자 이가상', 'LEASEHOLD'],
    ['가등기', '2 소유권이전청구권가등기 2024년5월10일 매매예약', '제9호 가등기권리자 주식회사가상개발', 'PROVISIONAL_REGISTRATION'],
  ])('%s + 다음 줄 권리자 칸 → 1건', (_, row, holderLine, kind) => {
    const lines = kind === 'LEASEHOLD' ? registry([], [row, holderLine]) : registry([row, holderLine]);
    const r = findRegistryRights(lines);
    expect(r).toHaveLength(1);
    expect(r?.[0].kind).toBe(kind);
    expect(r?.[0].holder).not.toBeNull();
  });

  it('순위번호를 못 읽은 줄이라도 권리자 라벨 앞에 등기목적이 있으면 새 권리로 센다', () => {
    const r = findRegistryRights(
      registry([], [
        '1 근저당권설정 2022년6월20일 설정계약 채권최고액 금120,000,000원 근저당권자 주식회사가상은행',
        '전세권설정 2023년1월1일 설정계약 전세금 금50,000,000원 전세권자 김가상',
      ]),
    );
    expect(r?.map((x) => x.kind)).toEqual(['MORTGAGE', 'JEONSE']);
  });

  it('순위번호가 있는 권리 줄은 그대로 읽는다 (라벨 뒤 권리자 이름도)', () => {
    const r = findRegistryRights(registry(['2 가처분 2024년3월1일 가처분결정 가처분채권자 박가상']));
    expect(brief(r)).toEqual([{ kind: 'PROVISIONAL_DISPOSITION', cancelled: false, holder: '박가상' }]);
  });
});
