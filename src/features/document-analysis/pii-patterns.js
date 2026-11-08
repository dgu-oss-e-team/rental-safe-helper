// @ts-check
/**
 * PART 2. 개인정보 정규식 탐지
 * 글자(text)를 받아서 개인정보가 어디 있는지 찾아 준다.
 * 결과의 start/end는 "몇 번째 글자부터 몇 번째 글자까지"인지를 뜻한다.
 */
import { PII_TYPE } from '../../shared/document-model.js';

/**
 * 주민등록번호 / 외국인등록번호
 * 형식: 생년월일 6자리 - 뒷자리 7자리
 * (?<!\d), (?!\d): 앞뒤에 숫자가 더 붙어 있으면 잡지 않는다 (긴 계좌번호 오탐 방지)
 */
const ID_NUMBER_REGEX =
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s*-\s*([1-8])\d{6}(?!\d)/g;

/**
 * 한국 여권번호
 * 옛 형식: 영문 1자 + 숫자 8자리   (예: M12345678)
 * 새 형식: 영문 1자 + 숫자 3자리 + 영문 1자 + 숫자 4자리 (예: M123A4567)
 */
const PASSPORT_REGEX = /(?<![A-Z0-9])[MSRGDT](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Z0-9])/g;

/**
 * 주민등록번호와 외국인등록번호를 찾는다.
 * 뒷자리 첫 숫자가 5~8이면 외국인, 1~4면 내국인이다.
 * 체크섬은 검사하지 않는다. (2020년 10월 이후 번호는 체크섬이 맞지 않을 수 있음)
 * @param {string} text
 */
export function findIdNumbers(text) {
  const results = [];
  for (const match of text.matchAll(ID_NUMBER_REGEX)) {
    const firstBackDigit = match[1];
    results.push({
      type: '5678'.includes(firstBackDigit) ? PII_TYPE.FOREIGNER_ID : PII_TYPE.RESIDENT_ID,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

/**
 * 여권번호를 찾는다.
 * @param {string} text
 */
export function findPassportNumbers(text) {
  const results = [];
  for (const match of text.matchAll(PASSPORT_REGEX)) {
    results.push({
      type: PII_TYPE.PASSPORT_ID,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

/**
 * 전화번호
 * 휴대폰: 010, 011, 016~019 / 서울: 02 / 지역: 031~064 / 인터넷전화: 070
 * 가운데 3~4자리, 끝 4자리. 하이픈(-)이나 공백이 있어도 되고 없어도 된다.
 */
const PHONE_REGEX =
  /(?<!\d)(?:01[016-9]|02|0[3-6][1-5]|070)[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g;

/** 등기 고유번호: 4자리-4자리-6자리 (예: 1101-2024-123456) */
const REGISTRY_ID_REGEX = /(?<!\d)\d{4}-\d{4}-\d{6}(?!\d)/g;

/**
 * 계좌번호 후보: 하이픈으로 나뉜 숫자 덩어리(예: 123-45-678901) 또는 10~14자리 연속 숫자
 * 은행마다 형식이 달라서 모양만으로는 판단하기 어렵다.
 * 그래서 아래 BANK_KEYWORD_REGEX가 바로 앞에 있을 때만 계좌번호로 본다.
 */
const BANK_CANDIDATE_REGEX = /(?<!\d)(?:\d{2,6}(?:-\d{2,6}){1,4}|\d{10,14})(?!\d)/g;
const BANK_KEYWORD_REGEX = /계좌|은행|예금주|입금|account|bank/i;
const BANK_KEYWORD_WINDOW = 20; // 숫자 앞 20글자 안에 키워드가 있어야 한다

/**
 * 정규식 하나로 찾은 결과를 공통 모양으로 만든다.
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} type
 */
function findByRegex(text, regex, type) {
  const results = [];
  for (const match of text.matchAll(regex)) {
    results.push({
      type,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

/** @param {string} text */
export function findPhoneNumbers(text) {
  return findByRegex(text, PHONE_REGEX, PII_TYPE.PHONE_NUMBER);
}

/** @param {string} text */
export function findRegistryIds(text) {
  return findByRegex(text, REGISTRY_ID_REGEX, PII_TYPE.REGISTRY_ID);
}

/**
 * 계좌번호를 찾는다. 숫자 개수가 10~14개이고, 앞에 은행 관련 단어가 있을 때만 인정한다.
 * @param {string} text
 */
export function findBankAccounts(text) {
  return findByRegex(text, BANK_CANDIDATE_REGEX, PII_TYPE.BANK_ACCOUNT).filter((r) => {
    const digitCount = r.value.replace(/\D/g, '').length;
    if (digitCount < 10 || digitCount > 14) return false;
    const before = text.slice(Math.max(0, r.start - BANK_KEYWORD_WINDOW), r.start);
    return BANK_KEYWORD_REGEX.test(before);
  });
}

/**
 * 모든 정규식 탐지를 정해진 순서로 실행한다.
 * 구체적인 패턴을 먼저 찾고, 이미 찾은 구간과 겹치는 결과는 버린다.
 * 예: 등기 고유번호를 먼저 찾았으면, 같은 숫자를 계좌번호로 다시 잡지 않는다.
 * @param {string} text
 */
export function findPatternPII(text) {
  const finders = [
    findIdNumbers, // 1. 주민·외국인등록번호
    findRegistryIds, // 2. 등기 고유번호
    findPassportNumbers, // 3. 여권번호
    findPhoneNumbers, // 4. 전화번호
    findBankAccounts, // 5. 계좌번호 (가장 느슨하니까 마지막)
  ];
  /** @type {{type: string, value: string, start: number, end: number}[]} */
  const results = [];
  for (const find of finders) {
    for (const r of find(text)) {
      const overlaps = results.some((prev) => r.start < prev.end && prev.start < r.end);
      if (!overlaps) results.push(r);
    }
  }
  return results.sort((a, b) => a.start - b.start);
}