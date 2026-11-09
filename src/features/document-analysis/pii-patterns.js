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