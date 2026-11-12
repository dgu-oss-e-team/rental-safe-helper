// @ts-check
/**
 * PART 2. 주소의 시·도 이름을 정식 이름으로 바꾼다.
 * "서울 중구 필동로 00" → "서울특별시 중구 필동로 00"
 * PART 3이 계약서 주소와 등기부 주소를 글자 그대로 비교하므로, 같은 집이 같은 글자가 되도록 맞춘다.
 * 변환표는 src/config/templates/person-labels.json의 formalRegionNames에 있다. (코드 수정 없이 파일만 고쳐서 추가)
 * 이 변환은 PART 2 안에서만 한다. findings(PII_FINDING)의 주소 값은 마스킹에 쓰이므로 원문 그대로 둔다.
 */
import rules from '../../config/templates/person-labels.json';

/** @type {Record<string, string>} */
const FORMAL_NAMES = rules.formalRegionNames;

/** 정규식 특수문자를 글자 그대로 쓰이게 바꾼다. @param {string} s */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 주소 맨 앞의 시·도 이름. 긴 이름부터 비교하고(경기도가 경기보다 먼저), 뒤에는 공백이나 끝이 와야 한다.
 * ("서울대로", "경기장로"처럼 시·도 이름으로 시작하는 다른 단어는 바꾸지 않는다.)
 */
const REGION_KEYS = Object.keys(FORMAL_NAMES).sort((a, b) => b.length - a.length);
const REGION_REGEX = new RegExp(`^(${REGION_KEYS.map(escapeRegex).join('|')})(?:\\s+|$)`);

/**
 * 붙여 쓴 주소: "서울특별시중구", "경기도수원시"처럼 시·도로 끝나는 이름 바로 뒤에 시·군·구가 온다. (OCR에서 자주 생김)
 * 줄임말("서울중구")이나 다른 단어("서울시청")는 바꾸지 않는다.
 */
const REGION_NO_SPACE_REGEX = new RegExp(
  `^(${REGION_KEYS.filter((k) => /[시도]$/.test(k))
    .map(escapeRegex)
    .join('|')})(?=[가-힣]+(?:시|군|구)(?![가-힣]))`,
);

/**
 * 주소의 시·도 이름을 정식 이름으로 바꾼다.
 * - 줄임말("서울")과 옛 이름("강원도", "전라북도", "제주도")을 지금의 정식 이름으로 바꾼다.
 * - 광주는 뒤에 오는 말로 나눈다. 광주·광주시 + 구 → 광주광역시 (경기도 광주시에는 구가 없다),
 *   광주시·광주 + 읍·면 → 경기도 광주시. 광주 뒤에 구·읍·면을 알 수 없으면 추측하지 않고 원문 그대로 둔다.
 * - 붙여 쓴 주소("서울특별시중구")는 띄어서 바꾼다. → "서울특별시 중구"
 * - 시·도 이름이 없거나 바꿀 수 없으면 원문 그대로(앞뒤 공백만 정리) 돌려준다.
 *   (PART 3은 정식 이름으로 시작하지 않는 주소를 비교 불가로 본다.)
 * @param {string} address
 * @returns {string}
 */
export function toFormalAddress(address) {
  if (typeof address !== 'string') return address;
  const text = address.trim();
  const match = REGION_REGEX.exec(text) ?? REGION_NO_SPACE_REGEX.exec(text);
  if (!match) return text;

  const region = match[1];
  const rest = text.slice(match[0].length).trim();
  const first = rest.split(/\s+/)[0];

  if (region === '광주' || region === '광주시') {
    if (/구$/.test(first)) return `광주광역시 ${rest}`;
    if (region === '광주') {
      if (/[읍면]$/.test(first)) return `경기도 광주시 ${rest}`;
      return text;
    }
  }

  const formal = FORMAL_NAMES[region];
  return rest ? `${formal} ${rest}` : formal;
}
