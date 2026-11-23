import { describe, it, expect } from 'vitest';
import {
  findPhoneNumbers,
  findRegistryIds,
  findBankAccounts,
  findPatternPII,
  findGluedNumbers,
} from '../src/features/document-analysis/pii-patterns.js';
import { PII_TYPE } from '../src/shared/document-model.js';

// 모든 번호는 가짜다. 실제 개인정보를 쓰지 않는다.

describe('PART 2 전화번호 탐지', () => {
  it('하이픈 있는 휴대폰 번호를 찾는다', () => {
    const r = findPhoneNumbers('연락처 010-1234-5678');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.PHONE_NUMBER);
  });

  it('하이픈 없는 번호와 공백 섞인 번호도 찾는다', () => {
    expect(findPhoneNumbers('01012345678')).toHaveLength(1);
    expect(findPhoneNumbers('010 1234 5678')).toHaveLength(1);
  });

  it('서울(02)과 지역번호(031)도 찾는다', () => {
    expect(findPhoneNumbers('02-123-4567')).toHaveLength(1);
    expect(findPhoneNumbers('031-1234-5678')).toHaveLength(1);
  });

  it('날짜와 금액은 잡지 않는다', () => {
    expect(findPhoneNumbers('계약일 2024-01-05')).toHaveLength(0);
    expect(findPhoneNumbers('보증금 50,000,000원')).toHaveLength(0);
  });

  it('주민등록번호 안의 숫자는 잡지 않는다', () => {
    expect(findPhoneNumbers('800101-1234567')).toHaveLength(0);
  });
});

describe('PART 2 등기 고유번호 탐지', () => {
  it('4-4-6 형식을 찾는다', () => {
    const r = findRegistryIds('고유번호 1101-2024-123456');
    expect(r[0].type).toBe(PII_TYPE.REGISTRY_ID);
  });

  it('날짜는 잡지 않는다', () => {
    expect(findRegistryIds('2024-01-05')).toHaveLength(0);
  });

  describe('임대사업자 등록번호 (연도-시·군·구-일련번호)', () => {
    it.each([
      ['한 줄', '임대사업자 등록번호 2017-서울중구-00999', '2017-서울중구-00999'],
      ['번호만 있는 줄', '2017-서울중구-00999', '2017-서울중구-00999'],
      ['하이픈 앞뒤 공백', '등록번호: 2020 - 경기수원 - 0123', '2020 - 경기수원 - 0123'],
      ['앞에 "제", 뒤에 "호" (#220 리뷰)', '임대사업자 등록번호 제2017-서울중구-00999호', '2017-서울중구-00999'],
      ['"제" 뒤 공백', '등록번호 제 2017-서울중구-00999 호', '2017-서울중구-00999'],
    ])('%s', (_name, text, value) => {
      const r = findRegistryIds(text);
      expect(r.map((x) => [x.type, x.value])).toEqual([[PII_TYPE.REGISTRY_ID, value]]);
    });

    it('날짜·지번·연도 뒤 낱말은 잡지 않는다', () => {
      expect(findRegistryIds('2024-01-05')).toEqual([]);
      expect(findRegistryIds('가상동 246-8')).toEqual([]);
      expect(findRegistryIds('2017-서울중구')).toEqual([]);
      expect(findRegistryIds('12017-서울중구-00999')).toEqual([]);
      // "제"가 아닌 한글, 또는 "제"가 낱말 끝인 경우("체제2017-…")는 다른 낱말의 일부다
      expect(findRegistryIds('가2017-서울중구-00999')).toEqual([]);
      expect(findRegistryIds('체제2017-서울중구-00999')).toEqual([]);
    });

    it('findPatternPII에서도 REGISTRY_ID 하나로 나오고, 일련번호가 계좌·전화로 따로 잡히지 않는다', () => {
      const r = findPatternPII('2017-서울중구-00999 전화번호 010-0000-1111');
      expect(r.map((x) => x.type)).toEqual([PII_TYPE.REGISTRY_ID, PII_TYPE.PHONE_NUMBER]);
    });
  });
});

describe('PART 2 계좌번호 탐지', () => {
  it('은행 이름 뒤의 계좌번호를 찾는다', () => {
    const r = findBankAccounts('국민은행 123-45-678901');
    expect(r[0].type).toBe(PII_TYPE.BANK_ACCOUNT);
  });

  it('"입금계좌", "예금주" 뒤의 번호도 찾는다', () => {
    expect(findBankAccounts('입금계좌: 110-123-456789')).toHaveLength(1);
    expect(findBankAccounts('예금주 김철수 계좌번호 1234567890123')).toHaveLength(1);
  });

  it('은행 관련 단어가 없으면 잡지 않는다', () => {
    expect(findBankAccounts('관리번호 123-45-678901')).toHaveLength(0);
  });

  it('숫자가 10개 미만이면 잡지 않는다', () => {
    expect(findBankAccounts('계좌 2024-01-05')).toHaveLength(0);
  });
});

describe('PART 2 전체 탐지 순서 (findPatternPII)', () => {
  it('고유번호를 계좌번호로 중복해서 잡지 않는다', () => {
    const r = findPatternPII('계좌 1101-2024-123456');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.REGISTRY_ID);
  });

  it('전화번호를 계좌번호로 잘못 잡지 않는다', () => {
    const r = findPatternPII('예금주 연락처 010-1234-5678');
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe(PII_TYPE.PHONE_NUMBER);
  });

  it('한 문장의 여러 개인정보를 문장 순서대로 돌려준다', () => {
    const text = '연락처 010-1234-5678, 입금계좌 국민은행 123-45-678901, 주민번호 800101-1234567';
    expect(findPatternPII(text).map((r) => r.type)).toEqual([
      PII_TYPE.PHONE_NUMBER,
      PII_TYPE.BANK_ACCOUNT,
      PII_TYPE.RESIDENT_ID,
    ]);
  });
});

describe('PART 2 법인등록번호 (#192, 팀 합의: 등기 고유번호 종류로)', () => {
  const typeOf = (text) => findPatternPII(text).map((r) => [r.type, r.value]);

  it('"법인등록번호" 라벨 뒤 번호는 REGISTRY_ID로 잡아서 가린다', () => {
    expect(typeOf('법인등록번호 110111-3579246 전화번호 02-0000-5791')[0]).toEqual([PII_TYPE.REGISTRY_ID, '110111-3579246']);
  });

  it('바로 앞이 회사 이름이면 REGISTRY_ID다 (붙여 쓴 이름, 띄어 쓴 이름, 은행·신탁·회사로 끝나는 이름)', () => {
    for (const text of [
      '소유자 가상주택리츠주식회사 110111-3579246',
      '소유자 주식회사 가상건설 110111-2000001',
      '근저당권자 주식회사가상은행 110111-2468013',
      '수탁자 가상자산신탁 110111-6802467',
      '가상부동산투자회사 110111-6901999',
    ]) {
      expect(typeOf(text)[0][0], text).toBe(PII_TYPE.REGISTRY_ID);
    }
  });

  it('회사 끝말 앞에 1글자뿐인 사람 이름이나 "법인" 낱말 하나는 회사가 아니다 (#197 리뷰)', () => {
    expect(typeOf('임차인 김공사 900101-1234567')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
    expect(typeOf('위탁자 김신탁 900101-2234567')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
    expect(typeOf('공동담보 법인 900101-1234567')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
    expect(typeOf('임차인 김은행 900101-1234567')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
  });

  it('뒷자리가 0·9로 시작하는 법인등록번호도 회사 이름·라벨 뒤면 REGISTRY_ID다 (PR #253 평가)', () => {
    expect(typeOf('1 소유권보존 2015년3월2일 소유자 주식회사가상건설 110111-0000001')).toEqual([
      [PII_TYPE.REGISTRY_ID, '110111-0000001'],
    ]);
    // 전에는 계좌번호로 잡혔다 (가려지긴 했지만 종류가 틀림)
    expect(typeOf('근저당권자 주식회사가상은행 110111-0000002')).toEqual([[PII_TYPE.REGISTRY_ID, '110111-0000002']]);
    expect(typeOf('법인등록번호 110111-9000003')).toEqual([[PII_TYPE.REGISTRY_ID, '110111-9000003']]);
  });

  it('회사 이름·라벨이 없는 6-7자리(뒷자리 0)는 지금처럼 다른 규칙(계좌번호 등)에 맡긴다', () => {
    expect(typeOf('계좌번호 110111-0000001').map(([t]) => t)).not.toContain(PII_TYPE.REGISTRY_ID);
  });

  it('회사 이름이 없으면 지금처럼 주민·외국인등록번호로 본다 (애매하면 넓게 가리기)', () => {
    expect(typeOf('소유자 김철수 800101-1******')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
    expect(typeOf('110111-3579246')[0][0]).toBe(PII_TYPE.RESIDENT_ID);
  });
});

describe('PART 2 붙어서 읽힌 번호 (이슈 #166)', () => {
  const found = (text) => findPatternPII(text).map((r) => [r.type, r.value, r.uncertain]);

  it('주민번호 두 개가 붙어 있어도 각각 찾는다 (휴대폰 앱으로 채운 계약서)', () => {
    expect(found('주민등록번호 900101-1234567800202-2345678')).toEqual([
      [PII_TYPE.RESIDENT_ID, '900101-1234567', true],
      [PII_TYPE.RESIDENT_ID, '800202-2345678', true],
    ]);
  });

  it('전화번호 두 개가 붙어 있어도 각각 찾는다', () => {
    expect(found('전화번호 010-1111-2222010-3333-4444')).toEqual([
      [PII_TYPE.PHONE_NUMBER, '010-1111-2222', true],
      [PII_TYPE.PHONE_NUMBER, '010-3333-4444', true],
    ]);
  });

  it('가려진 번호(*), 외국인등록번호, 주민번호+전화번호가 섞여도 찾는다', () => {
    expect(found('900101-1******990505-5******')).toEqual([
      [PII_TYPE.RESIDENT_ID, '900101-1******', true],
      [PII_TYPE.FOREIGNER_ID, '990505-5******', true],
    ]);
    expect(found('900101-1234567010-1111-2222').map((r) => r[0])).toEqual([
      PII_TYPE.RESIDENT_ID,
      PII_TYPE.PHONE_NUMBER,
    ]);
  });

  it('번호 모양으로 빈틈없이 나눠지지 않는 덩어리는 건드리지 않는다 (계좌·고유번호·날짜는 지금과 같음)', () => {
    expect(findGluedNumbers('계좌번호 110-482-913570 은행')).toEqual([]);
    expect(findGluedNumbers('고유번호 1101-2024-123456')).toEqual([]);
    expect(findGluedNumbers('계약일 2026-11-17')).toEqual([]);
    expect(findGluedNumbers('900101-1234567800202')).toEqual([]); // 뒤 번호가 모자라면 나누지 않는다
    expect(found('계좌번호 110-482-913570 은행')).toEqual([[PII_TYPE.BANK_ACCOUNT, '110-482-913570', undefined]]);
  });

  it('번호 하나만 있으면 지금처럼 원래 규칙으로 찾는다 (uncertain 아님)', () => {
    expect(found('연락처 010-1234-5678')).toEqual([[PII_TYPE.PHONE_NUMBER, '010-1234-5678', undefined]]);
  });
});

describe('PART 2 OCR이 숫자를 비슷한 글자로 잘못 읽은 번호 (이슈 #100)', () => {
  it('0을 O로 읽은 주민번호·연락처·계좌번호도 찾는다 (PR #98 사례)', () => {
    const cases = [
      ['소유자 김철수 8OO1O1-1******', '8OO1O1-1******', PII_TYPE.RESIDENT_ID],
      ['임대인 김철수 75O315-1******', '75O315-1******', PII_TYPE.RESIDENT_ID],
      ['연락처 01O-0000-0000', '01O-0000-0000', PII_TYPE.PHONE_NUMBER],
      ['입금 계좌 가상은행 000-0OO000-00000 예금주 김철수', '000-0OO000-00000', PII_TYPE.BANK_ACCOUNT],
    ];
    for (const [text, value, type] of cases) {
      const r = findPatternPII(text);
      expect(r.map((x) => [x.value, x.type])).toEqual([[value, type]]);
    }
  });

  it('1을 l·I·|로 읽은 번호도 찾는다', () => {
    expect(findPatternPII('연락처 0l0-l234-5678')[0].value).toBe('0l0-l234-5678');
    expect(findPatternPII('주민번호 80OI0I-I234567')[0].type).toBe(PII_TYPE.RESIDENT_ID);
    expect(findPatternPII('연락처 010-|234-5678')[0].value).toBe('010-|234-5678');
  });

  it('값과 위치는 원문 그대로다 (마스킹이 원래 글자를 덮도록)', () => {
    const text = '소유자 김철수 8OO1O1-1******';
    const [r] = findPatternPII(text);
    expect(text.slice(r.start, r.end)).toBe('8OO1O1-1******');
  });

  it('잘못 읽은 글자가 섞인 번호는 uncertain(확인 필요)이다', () => {
    expect(findPatternPII('연락처 01O-1234-5678')[0].uncertain).toBe(true);
    expect(findPatternPII('연락처 010-1234-5678')[0].uncertain).toBeUndefined();
  });

  it('번호 앞에 붙은 영어 글자 때문에 원래 찾던 번호를 놓치지 않는다', () => {
    const r = findPatternPII('Tel010-1234-5678');
    expect(r.map((x) => [x.value, x.uncertain])).toEqual([['010-1234-5678', undefined]]);
  });

  it('진짜 숫자가 절반도 안 되면 번호로 보지 않는다 (영어 글자 오탐 방지)', () => {
    expect(findPatternPII('연락처 OlO-lOOO-OOOO')).toEqual([]);
  });

  it('은행 단어는 원문에서 찾는다 ("IBK"가 "1BK"로 바뀌어도 계좌로 인정)', () => {
    expect(findPatternPII('IBK 123-45O-678901')[0].type).toBe(PII_TYPE.BANK_ACCOUNT);
  });

  it('여권번호의 영문 앞글자(O 등)는 바꾸지 않는다', () => {
    expect(findPatternPII('여권 O12345678')).toEqual([
      { type: PII_TYPE.PASSPORT_ID, value: 'O12345678', start: 3, end: 12 },
    ]);
  });

  it('보통 글의 영어 단어는 번호로 잡지 않는다', () => {
    expect(findPatternPII('Hello World, Ollie lol IOI')).toEqual([]);
  });
});

describe('PART 2 사업자등록번호 (상욱님 평가 세트 #302)', () => {
  const values = (/** @type {string} */ t) => findPatternPII(t).map((r) => [r.type, r.value]);

  it('"주민등록번호(사업자등록번호)" 칸의 3-2-5자리 번호를 REGISTRY_ID로 찾는다', () => {
    expect(values('주민등록번호 (사업자등록번호) 214-86-35071 전화번호 02-0000-4127')).toEqual([
      [PII_TYPE.REGISTRY_ID, '214-86-35071'],
      [PII_TYPE.PHONE_NUMBER, '02-0000-4127'],
    ]);
    expect(findRegistryIds('사업자등록번호: 000-00-00000').map((r) => r.value)).toEqual(['000-00-00000']);
  });

  it('은행 단어 근처의 3-2-5자리 번호는 계좌번호로 둔다 (계좌번호 오탐 주의, 상욱님 리뷰)', () => {
    expect(values('계좌번호 123-45-67890 가상은행 예금주 김가상')).toEqual([[PII_TYPE.BANK_ACCOUNT, '123-45-67890']]);
  });

  it('더 긴 번호의 일부("110-482-307915", "214-86-350712"), 다른 모양은 사업자등록번호가 아니다', () => {
    expect(findRegistryIds('110-482-307915')).toEqual([]);
    expect(findRegistryIds('214-86-350712')).toEqual([]);
    expect(findRegistryIds('1214-86-35071')).toEqual([]);
    expect(findRegistryIds('2026-11-20')).toEqual([]);
  });
});
