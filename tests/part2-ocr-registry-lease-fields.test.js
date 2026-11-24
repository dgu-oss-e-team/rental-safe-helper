// PART 2. 사진 OCR 서류에서 위험 점검용 항목 읽기 (상욱님 가짜세트4 사진 피드백 4~6번)
// - 등기부 갑구·을구 제목을 잘못 읽음: "ㅣ [ 갑 구 】", "|  【[ 갑 구 】", "[ 감 구 】", 을구 제목이 통째로 깨짐
// - 보증금: 금액 표 제목 줄을 못 읽어 "가입대상 금액이 0원"의 0을 보증금으로 읽음, "금 _ 삼천만 _ 원정"
// - 특약: 서식 안내("주택월세 소득공제 안내")와 확인 문장 뒤 서명 줄이 특약 목록에 들어감
// 이름·번호·주소는 모두 가짜다.
import { describe, it, expect } from 'vitest';
import {
  findRegistryRights,
  findCurrentOwnerLines,
  findLastTransferDate,
  findDeposit,
  findMonthlyRent,
  findSpecialTerms,
  findContractDate,
} from '../src/features/document-analysis/field-extractor.js';

const GAP_ROWS = [
  '1 소유권보존 2019년4월2일 소유자 전가상 790318-*******',
  '제23118호 서울특별시 가상구 가상로17길 9,',
  '2 소유권이전 2022년6월20일 2022년6월13일 소유자 김가상 820605-*******',
  '제48821호 매매',
];
const EUL_ROWS = ['1 근저당권설정 2022년6월20일 2022년6월20일 채권최고액 금96,000,000원', '제48822호 설정계약 채무자 김가상'];
const MORTGAGE = { kind: 'MORTGAGE', maxClaimAmount: 96000000, cancelled: false, receivedAt: '2022-06-20' };

describe('PART 2 사진 등기부: 갑구·을구 제목', () => {
  for (const heading of ['ㅣ [ 갑 구 】 ( 소 유 권 에 관한 사항 ) ㅣ', '|  【[ 갑 구 】 ( 소유권에 관한 사항 )', '[ 감 구 】 ( 소유권에 관한 사항 )', 'TEE ( 소유권에 관한 사항 )']) {
    it(`"${heading}"을 갑구 제목으로 본다`, () => {
      const lines = [heading, ...GAP_ROWS, '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )', ...EUL_ROWS];
      expect(findCurrentOwnerLines(lines)).toEqual([3, 4]);
      expect(findLastTransferDate(lines)).toBe('2022-06-20');
      expect(findRegistryRights(lines)).toEqual([MORTGAGE]);
    });
  }

  it('부제 "(소유권 이외의 권리에 관한 사항)"만 읽혀도 을구 제목이다', () => {
    const lines = ['【 갑 구 】', ...GAP_ROWS, 'Rae TF ( 소유권 이외의 권리에 관한 사항 ) ㅣ', ...EUL_ROWS];
    expect(findRegistryRights(lines)).toEqual([MORTGAGE]);
  });

  it('긴 문장 속 괄호 부제는 제목이 아니다', () => {
    const long = '이 증명서는 등기기록의 내용과 틀림없음을 증명합니다 (소유권에 관한 사항) 열람용이므로 법적인 효력이 없습니다';
    expect(findRegistryRights([long, '1 소유권보존', '【 을 구 】'])).toBeNull();
  });

  it('을구 제목이 통째로 깨져도 "1 근저당권설정" 줄부터 을구로 본다 (쪽 순서대로)', () => {
    const lines = ['【 갑 구 】 ( 소유권에 관한 사항 )', ...GAP_ROWS, 'eR OR RT ad ARS TR', ...EUL_ROWS];
    // 깨진 제목 줄은 앞 기록의 이어지는 줄로 들어가지만(5), 을구 기록 줄(6, 7)은 들어가지 않는다
    expect(findCurrentOwnerLines(lines)).toEqual([3, 4, 5]);
    expect(findRegistryRights(lines)).toEqual([MORTGAGE]);
  });

  it('을구 쪽 사진을 먼저 올려도 같다 (쪽 순서 거꾸로)', () => {
    const lines = ['eR OR RT ad ARS TR', ...EUL_ROWS, '【 갑 구 】 ( 소유권에 관한 사항 )', ...GAP_ROWS];
    expect(findRegistryRights(lines)).toEqual([MORTGAGE]);
    expect(findCurrentOwnerLines(lines)).toEqual([6, 7]);
  });

  it('"감 구 기록사항 없음"도 갑구를 읽은 것으로 본다', () => {
    expect(findRegistryRights(['감 구 - 기록사항 없음', '【 을 구 】', ...EUL_ROWS])).toEqual([MORTGAGE]);
  });

  it('갑구가 없으면 지금처럼 null (근저당 줄만으로 "압류 없음"을 만들지 않는다)', () => {
    expect(findRegistryRights(EUL_ROWS)).toBeNull();
  });
});

describe('PART 2 사진 계약서: 보증금·월세', () => {
  const ARTICLE1 = '제1조(임대보증금, 월임대료 및 임대차 계약기간) ① 임대사업자는 위 주택의 임대보증금, 월임대료(이';

  it('보증보험 칸 "가입대상 금액이 0원 이하"의 0원은 보증금이 아니다', () => {
    expect(findDeposit(['임대보증금 □ 가입대상 금액이 0원 이하(법 제49조제3항)'])).toBeNull();
    expect(findDeposit(['보증금 0원'])).toBeNull();
  });

  it('금액 표 제목 줄을 못 읽으면 제1조 아래 금액 줄의 한글 금액을 읽는다', () => {
    const lines = [ARTICLE1, '하 "임대료"라 한다) 및 임대차 계약기간을 아래와 같이 정하여', '= _ 삼천만 _ 원정(\\30.000.000 )  금 、오십오만 원정(\\ 50090 )'];
    expect(findDeposit(lines)).toBe(30000000);
    expect(findMonthlyRent(lines)).toBe(550000);
  });

  it('한 글자씩 띄어 읽힌 한글 금액도 읽는다', () => {
    const lines = [ARTICLE1, '금액 금 _ 삼 천만 _ 원 정 (\\30,000.000 ) 오 십 오 만 A™(W 50,00 )'];
    expect(findDeposit(lines)).toBe(30000000);
    expect(findMonthlyRent(lines)).toBeNull();
  });

  it('칸이 깨져 순서를 믿을 수 없으면 읽지 않는다 (PR #331 리뷰)', () => {
    // 보증금 칸이 깨지고 월세만 남음: 월세가 보증금이 되면 안 된다
    expect(findDeposit([ARTICLE1, '금액 금 Ae ARE 원정(\\30.000.000 ) 금 오십오만 원정(\\ 550,000 )'])).toBeNull();
    // 앞 금액이 뒤 금액보다 작으면 짝이 맞지 않는다
    expect(findDeposit([ARTICLE1, '금 오십오만 원정  금 삼천만 원정'])).toBeNull();
    // 금액 줄이 다 깨지고 지급 일정 줄만 남음: 계약금·잔금이 보증금이 되면 안 된다
    expect(findDeposit([ARTICLE1, '= ER Te', '계약금 ㅣ금 _ 삼백만 _ 원정(\\ 3000000 )은계약시에 지급'])).toBeNull();
    expect(findDeposit([ARTICLE1, '= ER Te', 'A 금 ㅣ금 이천칠백만 원정(\\27,000.000 )2 Ad 1월 sd 지급'])).toBeNull();
  });

  it('밑줄이 낀 라벨 금액: "보증금 금 _ 일천만 _ 원정"', () => {
    expect(findDeposit(['보증금 금 _ 일천만 _ 원정'])).toBe(10000000);
  });
});

describe('PART 2 사진 계약서: 특약 별지', () => {
  const HEAD = '제17조(특약) 임대사업자와 임차인은 제1조부터 제15조까지에서 규정한 사항 외에 필요한 사항에 대';
  const FORM = ['해서는 따로 특약으로 정할 수 있다. 다만, 특약의 내용은 「약관의 규제에 관한 법률」을 위반해서는', '안 된다.'];
  const NOTICE = ['주택월세 소득공제 안내', '근로소득이 있는 거주자(일용근로자는 제외한다)는 「소득세법」 및 「조세특례제한법」에 따', '라 주택월세에 대한 소득공제를 받을 수 있으며, 자세한 사항은 국세청 콜센터(국번 없이 126)', '문의하시기 바랍니다.'];
  const TERMS = ['1. 이 계약의 중개보수는 임차인이 전액 부담한다.', '2. 관리비는 월 6만 원으로 한다.'];
  const END = ['위 특약사항을 확인하고 서명합니다. 2026년 11월 22일', '임대사업자 전가상 (서명 또는 인)', '임차인 SATO YUKI (서명 또는 인)'];

  it('서식 안내를 건너뛰고, 확인 문장에서 멈춘다', () => {
    expect(findSpecialTerms([HEAD, ...FORM, ...NOTICE, ...TERMS, ...END])).toEqual(TERMS);
    // 사진에서 읽는 순서가 바뀌어 안내가 특약 뒤에 와도
    expect(findSpecialTerms([HEAD, ...FORM, ...TERMS, ...NOTICE, ...END])).toEqual(TERMS);
  });

  it('별지 제목("[… 특약사항]") 아래에서도 확인 문장 뒤 서명 줄은 특약이 아니다', () => {
    expect(findSpecialTerms(['[표준임대차계약서 제17조에 대한 특약사항]', ...TERMS, ...END])).toEqual(TERMS);
  });

  it('한 글자씩 띄어 읽힌 확인 문장에서도 멈춘다', () => {
    expect(findSpecialTerms([HEAD, ...FORM, ...TERMS, '| 항 을 확 인 하고 서 명 합니다. ppd 11 월 일', '임 대 사업자'])).toEqual(TERMS);
  });

  it('서식 문장의 "필요한"을 OCR이 잘못 읽어도 서식으로 본다', () => {
    const head = HEAD.replace('필요한', '필 유한');
    expect(findSpecialTerms([head, ...FORM, ...TERMS])).toEqual(TERMS);
  });

  it('안내는 "문의하시기 바랍니다."에서 끝난다: 안내 뒤 번호 없는 특약도 남는다 (PR #331 리뷰)', () => {
    expect(findSpecialTerms(['[특약사항]', ...NOTICE, '반려동물은 키우지 않는다.', '도배는 임대인이 한다.'])).toEqual([
      '반려동물은 키우지 않는다.',
      '도배는 임대인이 한다.',
    ]);
    // 끝 문장을 못 읽어도 안내 줄 수(제목 뒤 3줄)를 넘으면 다시 특약으로 본다
    const broken = NOTICE.slice(0, 3).concat(['문의 Ah RE']);
    expect(findSpecialTerms(['[특약사항]', ...broken, '반려동물은 키우지 않는다.'])).toEqual(['반려동물은 키우지 않는다.']);
  });

  it('번호 없는 특약 문장 뒤의 안내 제목도 건너뛴다 (안내 뒤 번호 특약은 다시 읽는다)', () => {
    expect(findSpecialTerms(['[특약사항]', '반려동물은 키우지 않는다.', ...NOTICE, '1. 도배는 임대인이 한다.'])).toEqual([
      '반려동물은 키우지 않는다.',
      '1. 도배는 임대인이 한다.',
    ]);
  });
});

describe('PART 2 사진 계약서: 계약일', () => {
  it('"계약일" 라벨 뒤 밑줄 낀 날짜', () => {
    expect(findContractDate(['계약일: 2026 년 _11 월 _22 일'])).toBe('2026-11-22');
  });

  it('계약일 라벨을 못 읽으면 특약 확인 문장의 날짜', () => {
    expect(findContractDate(['Herd: 20264 118 22¢', '위 특약사항을 확인하고 서명합니다. 2026년 11월 22일'])).toBe('2026-11-22');
    expect(findContractDate(['위 특약사항을 확인하고 서명합니다.', '2026년 11월 22일'])).toBe('2026-11-22');
    expect(findContractDate(['위 특약사항을 확인하고 서명합니다. ped 11월 22'])).toBeNull();
  });
});
