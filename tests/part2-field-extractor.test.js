import { describe, it, expect } from 'vitest';
import {
  parseKoreanNumber,
  parseAmount,
  findDeposit,
  findMonthlyRent,
  findSpecialTerms,
  findRegistryRights,
  parseDate,
  findLastTransferDate,
  findContractDate,
} from '../src/features/document-analysis/field-extractor.js';
import { mockRegistryDocument, mockLeaseDocument, mockExtractedFields } from '../src/shared/mock-data.js';

/** 문서의 블록 글자를 줄 목록으로 */
const linesOf = (doc) => doc.pages.flatMap((p) => p.blocks.map((b) => b.text));

describe('PART 2 금액 읽기', () => {
  it('숫자 금액을 읽는다', () => {
    expect(parseKoreanNumber('50,000,000')).toBe(50000000);
  });

  it('한글 금액을 읽는다', () => {
    expect(parseKoreanNumber('오천만')).toBe(50000000);
    expect(parseKoreanNumber('일억이천만')).toBe(120000000);
    expect(parseKoreanNumber('오십만')).toBe(500000);
  });

  it('숫자와 한글이 섞여도 읽는다', () => {
    expect(parseKoreanNumber('1억 2천만')).toBe(120000000);
    expect(parseKoreanNumber('5천만')).toBe(50000000);
  });

  it('금액이 아닌 글자가 섞이면 null', () => {
    expect(parseKoreanNumber('오천만원정')).toBeNull();
  });

  it('"금 ... 원" 형식에서 금액을 꺼낸다', () => {
    expect(parseAmount(' 금50,000,000원')).toBe(50000000);
    expect(parseAmount(' 금 오천만원정')).toBe(50000000);
  });

  it('괄호 안 숫자가 있으면 그걸 더 믿는다', () => {
    expect(parseAmount(' 금 오천만원정 (₩50,000,000)')).toBe(50000000);
  });

  it('₩ 표시만 있어도 읽는다', () => {
    expect(parseAmount(' ₩50,000,000')).toBe(50000000);
  });
});

describe('PART 2 보증금·월세', () => {
  it('mock 계약서와 같은 값', () => {
    expect(findDeposit(linesOf(mockLeaseDocument))).toBe(mockExtractedFields.contract.deposit);
    expect(findMonthlyRent(linesOf(mockLeaseDocument))).toBe(mockExtractedFields.contract.monthlyRent);
  });

  it('보증금 다음에 오는 월세 금액을 보증금으로 잡지 않는다', () => {
    expect(findDeposit(['보증금 금 오천만원정 월세 금 오십만원정(₩500,000)'])).toBe(50000000);
  });

  it('"차임"도 월세로 읽는다', () => {
    expect(findMonthlyRent(['차임 금 오십만원정은 매월 25일에 지불한다'])).toBe(500000);
  });

  it('금액 없는 라벨은 건너뛴다', () => {
    expect(findDeposit(['보증금은 계약 종료 시 반환한다', '보증금 금1억원'])).toBe(100000000);
  });

  it('계약금·잔금은 보증금으로 잡지 않는다', () => {
    expect(findDeposit(['계약금 금5,000,000원', '잔금 금45,000,000원'])).toBeNull();
  });

  it('못 찾으면 null', () => {
    expect(findMonthlyRent(['보증금 금50,000,000원'])).toBeNull();
  });
});

describe('PART 2 특약사항', () => {
  it('mock 계약서와 같은 값', () => {
    expect(findSpecialTerms(linesOf(mockLeaseDocument))).toEqual(mockExtractedFields.contract.specialTerms);
  });

  it('제목 다음 줄들을 서명란 전까지 모은다', () => {
    const lines = ['[특약사항]', '1. 반려동물은 키울 수 없다.', '2. 도배는 임대인이 한다.', '본 계약을 증명하기 위하여 서명한다.'];
    expect(findSpecialTerms(lines)).toEqual(['1. 반려동물은 키울 수 없다.', '2. 도배는 임대인이 한다.']);
  });

  it('제목이 없으면 null, 내용이 없으면 []', () => {
    expect(findSpecialTerms(['보증금 금50,000,000원'])).toBeNull();
    expect(findSpecialTerms(['특약사항:', '임대인 김철수 (인)'])).toEqual([]);
  });
});

describe('PART 2 등기부 권리', () => {
  it('mock 등기부와 같은 값', () => {
    expect(findRegistryRights(linesOf(mockRegistryDocument))).toEqual(mockExtractedFields.registry.rights);
  });

  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
  /** 갑구·을구 줄을 받아 등기부 한 장처럼 만든다 */
  const registry = (/** @type {string[]} */ gap, /** @type {string[]} */ eul = []) => [
    '등기사항전부증명서(말소사항 포함)',
    GAP,
    ...gap,
    EUL,
    ...eul,
  ];

  it('가압류와 압류를 구분한다', () => {
    const r = findRegistryRights(registry(['가압류 청구금액 금30,000,000원', '압류 서울특별시']));
    expect(r?.map((x) => x.kind)).toEqual(['PROVISIONAL_SEIZURE', 'SEIZURE']);
  });

  it('신탁·전세권도 찾는다', () => {
    const r = findRegistryRights(registry(['소유권이전 신탁 수탁자 ○○신탁'], ['전세권설정 전세금 금100,000,000원']));
    expect(r?.map((x) => x.kind)).toEqual(['TRUST', 'JEONSE']);
  });

  it('한글 채권최고액도 읽는다', () => {
    expect(findRegistryRights(registry([], ['근저당권설정 채권최고액 금 일억이천만원']))?.[0].maxClaimAmount).toBe(120000000);
  });

  it('제목 줄("말소사항 포함", "을구")은 권리로 잡지 않는다', () => {
    expect(findRegistryRights(registry([]))).toEqual([]);
  });

  it('갑구·을구 밖(표제부)의 글자는 권리로 잡지 않는다', () => {
    expect(findRegistryRights(['표제부 신탁', ...registry([])])).toEqual([]);
  });
});

describe('PART 2 등기부 권리: 갑구·을구를 다 읽었는지', () => {
  it('을구 제목을 못 찾으면 null (압류 없음으로 보이지 않게)', () => {
    expect(findRegistryRights(['【 갑 구 】', '1 소유권보존'])).toBeNull();
  });

  it('갑구 제목을 못 찾으면 null', () => {
    expect(findRegistryRights(['【 을 구 】', '1 근저당권설정 채권최고액 금120,000,000원'])).toBeNull();
  });

  it('제목이 하나도 없으면 null', () => {
    expect(findRegistryRights(['근저당권설정 채권최고액 금120,000,000원'])).toBeNull();
  });

  it('"을구 기록사항 없음"은 을구를 읽은 것으로 본다', () => {
    expect(findRegistryRights(['【 갑 구 】', '1 소유권보존', '을구 - 기록사항 없음'])).toEqual([]);
  });

  it('OCR이 괄호를 놓쳐도 제목으로 본다', () => {
    expect(findRegistryRights(['갑 구 (소유권에 관한 사항)', '을 구 (소유권 이외의 권리에 관한 사항)'])).toEqual([]);
  });
});

describe('PART 2 등기부 권리: 말소', () => {
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

  it('별도 줄의 "3번가압류등기말소"는 3번 권리를 cancelled로 바꾸고, 새 권리를 만들지 않는다', () => {
    const r = findRegistryRights([
      GAP,
      '1 소유권보존',
      '3 가압류 청구금액 금30,000,000원',
      '4 3번가압류등기말소',
      '5 압류',
      EUL,
    ]);
    expect(r).toEqual([
      { kind: 'PROVISIONAL_SEIZURE', maxClaimAmount: null, cancelled: true, receivedAt: null },
      { kind: 'SEIZURE', maxClaimAmount: null, cancelled: false, receivedAt: null },
    ]);
  });

  it('을구 근저당 말소도 같은 구의 순위번호로 찾는다', () => {
    const r = findRegistryRights([
      GAP,
      '3 가압류',
      EUL,
      '1 근저당권설정 채권최고액 금120,000,000원',
      '3 근저당권설정 채권최고액 금60,000,000원',
      '4 3번근저당권설정등기말소',
    ]);
    expect(r?.map((x) => [x.kind, x.cancelled])).toEqual([
      ['PROVISIONAL_SEIZURE', false], // 갑구 3번은 그대로
      ['MORTGAGE', false],
      ['MORTGAGE', true],
    ]);
  });

  it('어느 권리인지 모르는 말소 줄이 있으면 그 구의 권리는 cancelled: null (확인 필요)', () => {
    const r = findRegistryRights([GAP, '가압류', '압류', '가압류등기말소', EUL, '근저당권설정']);
    expect(r?.map((x) => [x.kind, x.cancelled])).toEqual([
      ['PROVISIONAL_SEIZURE', null],
      ['SEIZURE', null],
      ['MORTGAGE', false], // 다른 구는 영향 없음
    ]);
  });

  it('가리키는 순위번호의 권리가 없어도 cancelled: null', () => {
    const r = findRegistryRights([GAP, '2 압류', '5 7번압류등기말소', EUL]);
    expect(r?.[0].cancelled).toBeNull();
  });
});

describe('PART 2 등기부 권리: 한 권리를 두 번 세지 않는다', () => {
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

  it('"근저당권자 …", "수탁자 …" 같은 이어지는 줄은 새 권리가 아니다', () => {
    const r = findRegistryRights([
      GAP,
      '2 소유권이전 신탁',
      '수탁자 ○○신탁주식회사',
      '신탁원부 제2020-00호',
      EUL,
      '1 근저당권설정',
      '채권최고액 금120,000,000원',
      '근저당권자 주식회사○○은행',
    ]);
    expect(r).toEqual([
      { kind: 'TRUST', maxClaimAmount: null, cancelled: false, receivedAt: null },
      { kind: 'MORTGAGE', maxClaimAmount: 120000000, cancelled: false, receivedAt: null },
    ]);
  });

  it('부기등기("1-1 근저당권변경")는 새 근저당이 아니다', () => {
    const r = findRegistryRights([GAP, EUL, '1 근저당권설정 채권최고액 금120,000,000원', '1-1 1번근저당권변경 채권최고액 금100,000,000원']);
    expect(r).toHaveLength(1);
  });

  it('같은 구의 같은 순위번호가 다시 나와도 한 번만 센다', () => {
    const r = findRegistryRights([GAP, EUL, '1 근저당권설정 채권최고액 금120,000,000원', '1 근저당권설정']);
    expect(r).toHaveLength(1);
  });

  it('"2020년…"처럼 날짜로 시작하는 줄은 순위번호로 보지 않는다', () => {
    const r = findRegistryRights([GAP, EUL, '1 근저당권설정', '2020년3월2일 근저당권설정 채권최고액 금60,000,000원']);
    expect(r).toHaveLength(2);
  });

  it('끝의 "주요 등기사항 요약"은 되풀이라 세지 않는다', () => {
    const r = findRegistryRights([
      GAP,
      EUL,
      '1 근저당권설정 채권최고액 금120,000,000원',
      '주요 등기사항 요약 (참고용)',
      '1 근저당권설정 채권최고액 금120,000,000원 주식회사○○은행',
    ]);
    expect(r).toHaveLength(1);
  });
});

describe('PART 2 날짜 읽기 (parseDate)', () => {
  it('여러 표기를 YYYY-MM-DD로 바꾼다', () => {
    expect(parseDate('2025년 3월 5일')).toBe('2025-03-05');
    expect(parseDate('2025년3월5일')).toBe('2025-03-05');
    expect(parseDate('2025.03.05')).toBe('2025-03-05');
    expect(parseDate('2025. 3. 5.')).toBe('2025-03-05');
    expect(parseDate('2025-03-05')).toBe('2025-03-05');
  });

  it('글자 중간에 있어도 처음 나오는 날짜를 읽는다', () => {
    expect(parseDate('접수 2024년5월10일 제5555호 2024년4월1일 매매')).toBe('2024-05-10');
  });

  it('없는 날짜는 읽지 않는다', () => {
    expect(parseDate('2025년 2월 30일')).toBeNull();
    expect(parseDate('2025.13.01')).toBeNull();
  });

  it('고유번호·주민번호·전화번호는 날짜가 아니다', () => {
    expect(parseDate('고유번호 0000-0000-000000')).toBeNull();
    expect(parseDate('소유자 김철수 800101-1******')).toBeNull();
    expect(parseDate('연락처 010-0000-0000')).toBeNull();
  });
});

describe('PART 2 등기부 마지막 소유권이전 접수일 (findLastTransferDate)', () => {
  const GAP = '【 갑 구 】 (소유권에 관한 사항)';
  const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';

  it('갑구의 마지막 소유권이전 접수일을 읽는다', () => {
    const lines = [
      GAP,
      '1 소유권보존 2015년1월20일 제100호',
      '2 소유권이전 2018년6월1일 제2000호 2018년5월2일 매매',
      '3 소유권이전 2024년5월10일 제5555호 2024년4월1일 매매',
      EUL,
    ];
    expect(findLastTransferDate(lines)).toBe('2024-05-10');
  });

  it('접수일(앞 날짜)을 읽고 원인일(뒤 날짜)은 읽지 않는다', () => {
    expect(findLastTransferDate([GAP, '2 소유권이전 2024년5월10일 제5555호 2024년4월1일 매매'])).toBe('2024-05-10');
  });

  it('신탁으로 인한 소유권이전도 센다', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 소유권이전 2024년7월7일 제7000호 2024년7월7일 신탁'];
    expect(findLastTransferDate(lines)).toBe('2024-07-07');
  });

  it('지분 이전("공유자전원지분전부이전")도 소유권이전으로 센다', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 공유자전원지분전부이전 2024년8월8일 제8000호 매매'];
    expect(findLastTransferDate(lines)).toBe('2024-08-08');
  });

  it('소유권이전청구권가등기는 소유권이전이 아니다', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 소유권이전청구권가등기 2024년9월9일 제9000호 매매예약'];
    expect(findLastTransferDate(lines)).toBe('2018-06-01');
  });

  it('접수일이 다음 줄에 있어도 읽는다', () => {
    expect(findLastTransferDate([GAP, '2 소유권이전', '2023년1월5일 제100호', '2022년12월1일 매매'])).toBe('2023-01-05');
  });

  it('부기등기의 날짜를 소유권이전 접수일로 가져오지 않는다', () => {
    const lines = [GAP, '2 소유권이전', '2-1 2번등기명의인표시변경 2024년3월3일 제300호'];
    expect(findLastTransferDate(lines)).toBeNull();
  });

  it('말소된 소유권이전은 빼고 그 전 소유권이전 접수일을 쓴다', () => {
    const lines = [
      GAP,
      '2 소유권이전 2018년6월1일 제2000호 매매',
      '3 소유권이전 2024년5월10일 제5555호 매매',
      '4 3번소유권이전등기말소 2024년6월1일 제6000호 해제',
    ];
    expect(findLastTransferDate(lines)).toBe('2018-06-01');
  });

  it('어느 순위번호를 말소했는지 모르면 추측하지 않고 null', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 소유권이전 2024년5월10일 제5555호 매매', '4 소유권이전등기말소'];
    expect(findLastTransferDate(lines)).toBeNull();
  });

  it('가리키는 순위번호를 찾을 수 없는 말소도 null', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '4 7번소유권이전등기말소'];
    expect(findLastTransferDate(lines)).toBeNull();
  });

  it('가압류 말소는 소유권이전에 영향을 주지 않는다', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 가압류 2020년1월1일 제10호', '4 3번가압류등기말소', '5 가압류등기말소'];
    expect(findLastTransferDate(lines)).toBe('2018-06-01');
  });

  it('신탁등기 말소는 소유권이전 말소가 아니다 (신탁이 끝나 소유권이 돌아온 경우)', () => {
    const lines = [
      GAP,
      '2 소유권이전 2020년2월2일 제200호 2020년2월2일 신탁',
      '3 소유권이전 2023년3월3일 제300호 2023년3월3일 신탁재산의귀속 2번신탁등기말소',
      '4 2번신탁등기말소',
    ];
    expect(findLastTransferDate(lines)).toBe('2023-03-03');
  });

  it('소유권보존만 있으면 null (소유권이 바뀐 적 없음)', () => {
    expect(findLastTransferDate([GAP, '1 소유권보존 2015년1월20일 제100호', EUL])).toBeNull();
  });

  it('마지막 소유권이전의 접수일을 못 읽으면 그 전 날짜로 대신하지 않고 null', () => {
    const lines = [GAP, '2 소유권이전 2018년6월1일 제2000호 매매', '3 소유권이전 제5555호 매매'];
    expect(findLastTransferDate(lines)).toBeNull();
  });

  it('갑구를 못 찾으면 null', () => {
    expect(findLastTransferDate(['2 소유권이전 2024년5월10일 제5555호 매매'])).toBeNull();
  });

  it('을구와 끝의 요약표는 읽지 않는다', () => {
    const lines = [
      GAP,
      '2 소유권이전 2018년6월1일 제2000호 매매',
      EUL,
      '1 근저당권설정 2024년5월10일 제5555호',
      '주요 등기사항 요약 (참고용)',
      '소유권이전 2025년1월1일',
    ];
    expect(findLastTransferDate(lines)).toBe('2018-06-01');
  });

  it('Mock 등기부에는 소유권이전이 없어서 null', () => {
    expect(findLastTransferDate(linesOf(mockRegistryDocument))).toBeNull();
  });
});

describe('PART 2 계약일 (findContractDate)', () => {
  it('"계약일" 라벨 뒤 날짜를 읽는다', () => {
    expect(findContractDate(['계약일 2025년 3월 5일'])).toBe('2025-03-05');
    expect(findContractDate(['계약일자: 2025.03.05'])).toBe('2025-03-05');
  });

  it('라벨이 없으면 서명란 날짜(본 계약을 증명하기 위하여 … 다음 날짜)를 읽는다', () => {
    const lines = ['본 계약을 증명하기 위하여 계약 당사자가 이의 없음을 확인하고 각각 서명·날인 후 각 1통씩 보관한다.', '2025년 3월 5일', '임대인 김철수'];
    expect(findContractDate(lines)).toBe('2025-03-05');
  });

  it('서명란 문장과 날짜가 한 줄에 있어도 읽는다', () => {
    expect(findContractDate(['본 계약을 증명하기 위하여 서명·날인 후 각 1통씩 보관한다. 2025년 3월 5일'])).toBe('2025-03-05');
  });

  it('잔금일·입주일·임대차 시작일은 계약일로 읽지 않는다', () => {
    const lines = [
      '잔금 금45,000,000원은 2025년 4월 1일에 지불한다',
      '임대차기간 2025년 4월 1일부터 2027년 3월 31일까지',
      '입주일 2025년 4월 1일',
    ];
    expect(findContractDate(lines)).toBeNull();
  });

  it('"계약일로부터"처럼 날짜가 바로 붙지 않은 라벨은 건너뛴다', () => {
    expect(findContractDate(['계약일로부터 30일 이내 2025년 4월 1일까지 이사한다'])).toBeNull();
  });

  it('라벨과 서명란이 둘 다 있으면 라벨 날짜를 쓴다', () => {
    const lines = ['계약일 2025년 3월 5일', '본 계약을 증명하기 위하여 서명한다.', '2025년 3월 6일'];
    expect(findContractDate(lines)).toBe('2025-03-05');
  });

  it('계약일을 못 찾으면 null (Mock 계약서)', () => {
    expect(findContractDate(linesOf(mockLeaseDocument))).toBeNull();
  });
});