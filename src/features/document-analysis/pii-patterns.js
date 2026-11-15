// @ts-check
/**
 * PART 2. 개인정보 정규식 탐지
 * 글자(text)를 받아서 개인정보가 어디 있는지 찾아 준다.
 * 결과의 start/end는 "몇 번째 글자부터 몇 번째 글자까지"인지를 뜻한다.
 *
 * 규칙 참고: ko-pii (MIT License, Copyright (c) 2026 Marker Inc.)
 *   https://github.com/Marker-Inc-Korea/ko-pii
 *   Python 라이브러리라 실행하지 않고, 아래 규칙만 JavaScript로 옮겼다.
 *   - 주민·외국인등록번호 구분 기호(- . / 공백), 지역번호 목록, +82 국제번호 형식
 *   - 계좌번호 자릿수(10-16)와 은행 이름 키워드, 여권번호 앞글자 목록
 *   우리가 따로 추가한 것: 가려진 번호(*), 안심번호(050X), 등기 고유번호, uncertain 표시
 */
import { PII_TYPE } from '../../shared/document-model.js';

/**
 * 주민등록번호 / 외국인등록번호
 * 형식: 생년월일 6자리 + (구분 기호) + 뒷자리 7자리
 * - 구분 기호는 - . / 공백 중 하나이거나 없어도 된다. (1번 괄호, ko-pii 규칙)
 * - 뒷자리는 *로 가려져 있어도 된다. (예: 800101-1******, 800101-*******)
 * - (?<!\d), (?![\d*]): 앞뒤에 숫자가 더 붙어 있으면 잡지 않는다 (긴 계좌번호 오탐 방지)
 */
const ID_NUMBER_REGEX =
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(\s?[-./]\s?|[-./\s]{0,2})([1-8*])[\d*]{6}(?![\d*])/g;

/**
 * 한국 여권번호
 * 옛 형식: 영문 1자 + 숫자 8자리   (예: M12345678)
 * 새 형식: 영문 1자 + 숫자 3자리 + 영문 1자 + 숫자 4자리 (예: M123A4567)
 * 앞글자: M 복수여권, S 단수여권, G·O 관용, D 외교관, R 거주, T 여행증명서 (ko-pii 규칙)
 * 일련번호가 00000000이면 버린다.
 */
const PASSPORT_REGEX =
  /(?<![A-Za-z0-9])(?:[MSGODRT](?!0{8})\d{8}|[MSROD]\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g;

/**
 * 전화번호
 * 휴대폰: 010, 011, 016-019 / 서울: 02 / 지역: 031-033, 041-044, 051-055, 061-064 (ko-pii 목록)
 * 인터넷전화: 070 / 안심번호: 050X
 * 가운데 3-4자리, 끝 4자리. 구분 기호(- . 공백)는 있어도 되고 없어도 된다.
 * 지역번호 뒤 괄호도 허용한다. 예: (02) 123-4567
 */
const PHONE_REGEX =
  /(?<![0-9+])(?:01[016-9]|02|03[1-3]|04[1-4]|05[1-5]|06[1-4]|070|050\d)[-.\s)\]]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g;

/**
 * 국제 형식 전화번호 (외국인 유학생이 자주 씀). 예: +82 10-1234-5678, +82-2-123-4567
 * +82나 0082 뒤에는 맨 앞 0이 빠진다. (ko-pii 규칙)
 */
const PHONE_INTL_REGEX =
  /(?<!\d)(?:\+82|0082)[-.\s]?(?:\(0\)[-.\s]?)?(?:1[016-9]|2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)[-.\s]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g;

/** 등기 고유번호: 4자리-4자리-6자리 (예: 1101-2024-123456) */
const REGISTRY_ID_REGEX = /(?<!\d)\d{4}-\d{4}-\d{6}(?!\d)/g;

/**
 * 계좌번호 후보: 하이픈이나 공백으로 나뉜 숫자 덩어리(예: 123-45-678901) 또는 10-16자리 연속 숫자
 * 은행마다 형식이 달라서 모양만으로는 판단하기 어렵다.
 * 그래서 번호 앞이나 뒤에 은행 관련 단어가 있을 때만 계좌번호로 본다.
 */
const BANK_CANDIDATE_REGEX = /(?<!\d)(?:\d{2,7}(?:[-\s]\d{2,7}){1,4}|\d{10,16})(?!\d)/g;
/**
 * 은행 관련 단어. "은행"이 안 붙는 이름(농협, 카카오뱅크, 우체국 등)은 ko-pii 목록에서 가져왔다.
 * "국민", "신한", "우리", "하나", "KB", "NH"만 단독으로 쓰는 건 넣지 않았다.
 * 일반 단어나 부동산 용어(예: KB시세)와 겹쳐서 엉뚱한 숫자를 계좌로 잡기 때문이다.
 */
const BANK_KEYWORD_REGEX =
  /계좌|은행|예금주|입금|뱅크|농협|수협|우체국|새마을금고|신협|카뱅|토스|IBK|account|bank/i;
const BANK_KEYWORD_BEFORE = 20; // 번호 앞 20글자 (예: 입금계좌: 110-123-456789)
const BANK_KEYWORD_AFTER = 10; // 번호 뒤 10글자 (예: 110-123-456789 (신한은행))

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

/**
 * 주민등록번호와 외국인등록번호를 찾는다.
 * 뒷자리 첫 숫자가 5-8이면 외국인, 1-4면 내국인이다.
 * 체크섬은 검사하지 않는다. (2020년 10월 이후 번호는 체크섬이 맞지 않을 수 있음)
 * 아래 경우는 uncertain(사용자 확인 필요)으로 표시한다.
 * - 뒷자리가 전부 가려져 내국인/외국인을 구분할 수 없을 때 (예: 800101-*******)
 * - 구분 기호(- . /)가 없을 때 (13자리 계좌번호일 수도 있어서)
 * @param {string} text
 */
export function findIdNumbers(text) {
  const results = [];
  for (const match of text.matchAll(ID_NUMBER_REGEX)) {
    const hasSeparator = /[-./]/.test(match[1]);
    const firstBackDigit = match[2];
    const uncertain = firstBackDigit === '*' || !hasSeparator;
    results.push({
      type: '5678'.includes(firstBackDigit) ? PII_TYPE.FOREIGNER_ID : PII_TYPE.RESIDENT_ID,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
      uncertain,
    });
  }
  return results;
}

/**
 * 여권번호를 찾는다.
 * @param {string} text
 */
export function findPassportNumbers(text) {
  return findByRegex(text, PASSPORT_REGEX, PII_TYPE.PASSPORT_ID);
}

/** @param {string} text */
export function findPhoneNumbers(text) {
  return [
    ...findByRegex(text, PHONE_INTL_REGEX, PII_TYPE.PHONE_NUMBER),
    ...findByRegex(text, PHONE_REGEX, PII_TYPE.PHONE_NUMBER),
  ];
}

/** @param {string} text */
export function findRegistryIds(text) {
  return findByRegex(text, REGISTRY_ID_REGEX, PII_TYPE.REGISTRY_ID);
}

/**
 * 계좌번호를 찾는다. 숫자 개수가 10-16개이고, 앞이나 뒤에 은행 관련 단어가 있을 때만 인정한다.
 * @param {string} text
 * @param {string} [keywordText] 은행 단어를 찾을 글 (같은 길이). OCR 보정한 글로 번호를 찾을 때
 *   은행 단어는 원문에서 찾는다. ("IBK"가 "1BK"로 바뀌면 안 되므로)
 */
export function findBankAccounts(text, keywordText = text) {
  return findByRegex(text, BANK_CANDIDATE_REGEX, PII_TYPE.BANK_ACCOUNT).filter((r) => {
    const digitCount = r.value.replace(/\D/g, '').length;
    if (digitCount < 10 || digitCount > 16) return false;
    const before = keywordText.slice(Math.max(0, r.start - BANK_KEYWORD_BEFORE), r.start);
    const after = keywordText.slice(r.end, r.end + BANK_KEYWORD_AFTER);
    return BANK_KEYWORD_REGEX.test(before) || BANK_KEYWORD_REGEX.test(after);
  });
}

/*
 * OCR이 숫자를 비슷한 글자로 잘못 읽은 번호 (이슈 #100)
 * 스캔 서류에서 OCR이 0을 O로, 1을 l로 읽으면("8OO1O1-1******") 위 정규식이 번호를 못 찾는다.
 * 사용자가 확인 단계에서 고치지 않고 넘어가면 번호가 AI 프롬프트에 그대로 남는다.
 * 그래서 번호를 찾을 때만 비슷한 글자를 숫자로 보고 한 번 더 찾는다.
 * - 한 글자를 한 글자로 바꿔서 위치(start/end)가 원문과 같다. 값은 원문 글자 그대로 돌려준다. (마스킹이 원래 글자를 덮도록)
 * - 원문으로 찾은 결과를 먼저 쓰고, 보정한 글에서 새로 찾은 것만 더한다.
 *   (글 전체를 바꾸면 "Tel010-…"의 l이 1이 되어 원래 찾던 번호를 놓친다)
 * - 새로 찾은 것은 uncertain(확인 필요)이다.
 * - 번호의 숫자 자리 중 진짜 숫자가 절반 이상일 때만 인정한다. (영어 글자만으로 된 오탐 방지)
 * - 여권번호는 앞글자가 영문(O 등)이라 보정하지 않는다.
 * - 생년월일(동일 인물 판정용)은 원문 그대로의 번호에서만 읽는다. (name-detector.js의 findIdNumbers, 추측한 숫자로 판단하지 않음)
 */
/** @type {Record<string, string>} OCR이 숫자 대신 자주 읽는 글자 → 숫자 */
const OCR_DIGIT_LOOKALIKES = { O: '0', o: '0', l: '1', I: '1', '|': '1' };
const OCR_LOOKALIKE_REGEX = /[OolI|]/g;
/** 글자가 하나라도 있는지만 볼 때 (g 없이: .test()가 이전 위치를 기억하지 않게) */
const HAS_OCR_LOOKALIKE = /[OolI|]/;
const MIN_REAL_DIGIT_RATIO = 0.5;

/**
 * 숫자처럼 생긴 글자를 숫자로 바꾼다. 글자 수는 그대로다.
 * @param {string} text
 */
function toOcrDigits(text) {
  return text.replace(OCR_LOOKALIKE_REGEX, (ch) => OCR_DIGIT_LOOKALIKES[ch]);
}

/**
 * 번호의 숫자 자리(진짜 숫자 + 숫자처럼 생긴 글자) 중 진짜 숫자가 충분한지
 * @param {string} value 원문 글자
 */
function hasEnoughRealDigits(value) {
  const real = (value.match(/\d/g) ?? []).length;
  const lookalike = (value.match(OCR_LOOKALIKE_REGEX) ?? []).length;
  return real > 0 && real / (real + lookalike) >= MIN_REAL_DIGIT_RATIO;
}

/**
 * 탐지 함수 하나에 OCR 보정 찾기를 더한다.
 * @param {(text: string, original: string) => {type: string, value: string, start: number, end: number, uncertain?: boolean}[]} find
 * @returns {(text: string) => {type: string, value: string, start: number, end: number, uncertain?: boolean}[]}
 */
function withOcrLookalikes(find) {
  return (text) => {
    const exact = find(text, text);
    const fixed = toOcrDigits(text);
    if (fixed === text) return exact;
    const extra = find(fixed, text)
      .map((r) => ({ ...r, value: text.slice(r.start, r.end), uncertain: true }))
      .filter((r) => HAS_OCR_LOOKALIKE.test(r.value) && hasEnoughRealDigits(r.value))
      .filter((r) => !exact.some((e) => r.start < e.end && e.start < r.end));
    return [...exact, ...extra];
  };
}

/**
 * 모든 정규식 탐지를 정해진 순서로 실행한다.
 * 구체적인 패턴을 먼저 찾고, 이미 찾은 구간과 겹치는 결과는 버린다.
 * 예: 등기 고유번호를 먼저 찾았으면, 같은 숫자를 계좌번호로 다시 잡지 않는다.
 * 숫자를 비슷한 글자로 잘못 읽은 번호(OCR)도 찾는다. (위 withOcrLookalikes 설명)
 * @param {string} text
 */
export function findPatternPII(text) {
  const finders = [
    withOcrLookalikes(findIdNumbers), // 1. 주민·외국인등록번호
    withOcrLookalikes(findRegistryIds), // 2. 등기 고유번호
    findPassportNumbers, // 3. 여권번호 (영문 앞글자라 보정 안 함)
    withOcrLookalikes(findPhoneNumbers), // 4. 전화번호
    withOcrLookalikes(findBankAccounts), // 5. 계좌번호 (가장 느슨하니까 마지막)
  ];
  /** @type {{type: string, value: string, start: number, end: number, uncertain?: boolean}[]} */
  const results = [];
  for (const find of finders) {
    for (const r of find(text)) {
      const overlaps = results.some((prev) => r.start < prev.end && prev.start < r.end);
      if (!overlaps) results.push(r);
    }
  }
  return results.sort((a, b) => a.start - b.start);
}