// PART 2. #351·#352(권리자·등기원인·못 알아본 줄·인적사항 범위) 병합 후 점검에서 찾은 것 (가짜세트 PDF·사진으로 확인)
// - 쪽이 넘어가며 다시 나오는 표 머리줄 "권리자 및 기타사항"을 권리자로 읽음 → 은행 근저당이 "개인" 권리자로 요약됨
// - 권리자 줄의 회사 이름 "가상신탁주식회사"의 "신탁"을 등기원인으로 읽음
// - 사진 OCR 잡글자 줄("107 — —")을 못 알아본 기록으로 셈 (가짜세트4 사진에서 8개)
// - 사진에서 "◈"를 "#"으로 읽어 중개사 칸 범위가 아래 민간임대 안내문까지 먹음
// - 특약 멈춤 규칙의 '\s' 백슬래시 하나: 띄어 읽힌 "임 대 인 :" 줄을 못 잡음
// 이름·번호·주소는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import {
  findRegistryRights,
  findUnknownActiveCount,
  findPersonalInfoRanges,
  findSpecialTerms,
} from '../src/features/document-analysis/field-extractor.js';

const GAP = ['【 갑 구 】 ( 소유권에 관한 사항 )', '1 소유권보존 2019년4월2일 소유자 김가상 790318-*******'];
const EUL = '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )';

describe('PART 2 등기부 권리자·등기원인', () => {
  it('쪽이 넘어가며 다시 나온 표 머리줄은 권리자가 아니다', () => {
    const rights = findRegistryRights([
      ...GAP,
      EUL,
      '1 근저당권설정 2022년6월20일 2022년6월20일 설정계약 채권최고액 금96,000,000원',
      '순위번호 등기목적 접수 등기원인 권리자 및 기타사항',
      '근저당권자 주식회사가상은행 110111-0012345',
    ]);
    expect(rights?.[0]).toMatchObject({ holder: '주식회사가상은행', holderIsCompany: true, cause: '설정계약' });
  });

  it('권리자 줄의 회사 이름 "…신탁주식회사"는 등기원인 "신탁"이 아니다', () => {
    const rights = findRegistryRights([
      ...GAP,
      EUL,
      '1 근저당권설정 2022년6월20일 제1호 채권최고액 금96,000,000원',
      '근저당권자 가상신탁주식회사 110111-0012345',
    ]);
    expect(rights?.[0]).toMatchObject({ holder: '가상신탁주식회사', cause: null });
  });

  it('등기원인과 채무자 회사가 한 줄에 있으면 채무자 칸 앞에서 원인을 읽는다', () => {
    const rights = findRegistryRights([
      ...GAP,
      EUL,
      '1 근저당권설정 2022년3월2일 2022년3월2일 채권최고액 금186,000,000원',
      '제17346호 설정계약 채무자 가상리빙주식회사',
      '근저당권자 주식회사가상은행 110111-0012345',
    ]);
    expect(rights?.[0]).toMatchObject({ cause: '설정계약', holder: '주식회사가상은행' });
  });

  it('신탁 기록: 수탁자 회사 이름이 아니라 다음 줄 등기원인 칸에서 "신탁"을 읽는다', () => {
    const rights = findRegistryRights([
      '【 갑 구 】 ( 소유권에 관한 사항 )',
      '1 소유권보존 2019년4월2일 소유자 김가상',
      '3 소유권이전 2024년9월23일 2024년9월23일 수탁자 가상부동산신탁주식회사 110111-5193746',
      '제71802호 신탁 서울특별시 가상구 가상로 90, 15층(가상동)',
      EUL,
      '기록사항 없음',
    ]);
    expect(rights?.[0]).toMatchObject({ kind: 'TRUST', holder: '가상부동산신탁주식회사', cause: '신탁' });
  });
});

describe('PART 2 못 알아본 등기 기록 수 (사진 OCR 잡글자)', () => {
  it('순위번호 뒤에 한글 등기목적이 없는 잡글자 줄은 세지 않는다', () => {
    const lines = [...GAP, '107 — — ㅣ', '1 ⎸ 2019년4월2일 ⎸ 제3충 제203호', EUL, '1 근저당권설정 2022년6월20일 채권최고액 금1원'];
    expect(findUnknownActiveCount(lines)).toBe(0);
  });

  it('한글 등기목적이 있는 처음 보는 기록은 지금처럼 센다', () => {
    const lines = [...GAP, '2 예고등기 2023년1월2일 제1호', EUL, '기록사항 없음'];
    expect(findUnknownActiveCount(lines)).toBe(1);
  });
});

describe('PART 2 계약서 인적사항 칸 범위 (사진 OCR)', () => {
  const LINES = [
    '표준임대차계약서',
    '1. 계약 당사자',
    '성명(법인명) 김가상 (서명 또는 인)',
    '주민등록번호 750315-1****** 전화번호 010-0000-0000',
    '2. 공인중개사(개업공인중개사가 계약서를 작성하는 경우 해당)',
    '가상공인중개사사무소',
    '개업공인 박가상 (서명 및 인)',
    '소속공인중개사 2|ZH] (Me 및 인)',
    '# 해당 주택은 「민간임대주택에 관한 특별법」 (이하 “법”이라 한다)에 따라 임대사업자가 시장',
    'ㆍ군수ㆍ구청장에게 등록한 민간임대주택으로서 다음과 같은 사항이 적용됩니다.',
    'ㅇ 임대의무기간 중 민간임대주택 양도 제한(법 제43조)',
    '-임대사업자는 해당 민간임대주택을 계속 임대해야 하며, 그 기간 동안에는 양도가 제한됩니다.',
  ];

  it('"◈"를 "#"으로 읽은 안내 상자 앞에서 중개사 칸이 끝난다', () => {
    expect(findPersonalInfoRanges(LINES)).toEqual([
      { startLine: 1, endLine: 3 },
      { startLine: 4, endLine: 7 },
    ]);
  });

  it('"ㅇ"으로 읽은 안내 줄, 문장으로 끝나는 줄에서도 끝난다', () => {
    const lines = ['2. 공인중개사', '개업공인 박가상 (서명 및 인)', 'ㅇ 임대료 증액 제한(법 제44조)', '다음 줄'];
    expect(findPersonalInfoRanges(lines)).toEqual([{ startLine: 0, endLine: 1 }]);
    const sentence = ['2. 공인중개사', '개업공인 박가상 (서명 및 인)', '재계약을 거절할 수 없습니다.'];
    expect(findPersonalInfoRanges(sentence)).toEqual([{ startLine: 0, endLine: 1 }]);
  });
});

describe('PART 2 특약: 띄어 읽힌 당사자 서명 줄', () => {
  it('"임 대 인 : …", "임 차 인 박가상 (서명 또는 인)"에서도 특약이 끝난다', () => {
    expect(findSpecialTerms(['[특약사항]', '1. 반려동물은 키우지 않는다.', '임 대 인 : 김가상'])).toEqual(['1. 반려동물은 키우지 않는다.']);
    expect(findSpecialTerms(['[특약사항]', '1. 반려동물은 키우지 않는다.', '임 차 인 박가상 서명'])).toEqual(['1. 반려동물은 키우지 않는다.']);
  });
});
