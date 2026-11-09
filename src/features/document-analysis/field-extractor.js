// @ts-check
/**
 * PART 2. 비교용 항목 추출 (보증금·월세·특약·등기부 권리)
 * extractFields()가 쓸 재료다. 입력은 문서의 글자 줄 목록(블록 text 배열)이다.
 * null 규칙: 항목을 못 찾으면 null(못 읽음), 찾았는데 내용이 없으면 [](없음).
 */

const KOREAN_DIGITS = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL_UNITS = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNITS = { 만: 1e4, 억: 1e8, 조: 1e12 };

/**
 * 숫자·한글이 섞인 금액 글자를 숫자로 바꾼다.
 * 예: "50,000,000" → 50000000, "오천만" → 50000000, "1억 2천만" → 120000000
 * 읽을 수 없는 글자가 섞여 있으면 null.
 * @param {string} s
 * @returns {number | null}
 */
export function parseKoreanNumber(s) {
  const text = s.replace(/[\s,]/g, '');
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number(text);

  let total = 0; // 만·억·조 단위까지 더한 값
  let section = 0; // 만 아래 단위(십·백·천)를 모으는 값
  let num = 0; // 방금 읽은 숫자
  let digits = ''; // 아라비아 숫자를 모으는 글자
  for (const ch of text) {
    if (/\d/.test(ch)) {
      digits += ch;
      continue;
    }
    if (digits) {
      num = Number(digits);
      digits = '';
    }
    if (ch in KOREAN_DIGITS) num = KOREAN_DIGITS[ch];
    else if (ch in SMALL_UNITS) {
      section += (num || 1) * SMALL_UNITS[ch];
      num = 0;
    } else if (ch in BIG_UNITS) {
      section += num;
      total += (section || 1) * BIG_UNITS[ch];
      section = 0;
      num = 0;
    } else return null;
  }
  if (digits) num = Number(digits);
  return total + section + num;
}

const AMOUNT_CHARS = '0-9일이삼사오육칠팔구십백천만억조';
/** 금액 한 덩어리: "₩50,000,000" 또는 "금 오천만원", "금50,000,000원" */
const AMOUNT_REGEX = new RegExp(
  `₩\\s*([\\d,]+)|(?:금\\s*)?([${AMOUNT_CHARS}][${AMOUNT_CHARS},\\s]*?)\\s*원`,
);
/** 금액 바로 뒤 괄호 안 숫자: "금 오천만원정 (₩50,000,000)" → 50000000 */
const PAREN_AMOUNT_REGEX = /^\s*정?\s*\(\s*₩?\s*([\d,]+)\s*원?\s*\)/;

/**
 * 글자에서 처음 나오는 금액을 읽는다. 괄호 안 숫자가 바로 뒤에 있으면 그걸 더 믿는다.
 * @param {string} text
 * @returns {number | null}
 */
export function parseAmount(text) {
  const m = AMOUNT_REGEX.exec(text);
  if (!m) return null;
  if (m[1]) return parseKoreanNumber(m[1]);
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
  const paren = PAREN_AMOUNT_REGEX.exec(after);
  if (paren) return parseKoreanNumber(paren[1]);
  return parseKoreanNumber(m[2]);
}

/** "보증금" → /보\s*증\s*금/g : OCR이 글자 사이에 공백을 넣어도 찾는다. */
const spacedRegex = (/** @type {string} */ word) => new RegExp([...word].join('\\s*'), 'g');

/**
 * 라벨 뒤 40글자 안에서 처음 나오는 금액을 찾는다. 금액이 없는 라벨(예: 특약의 "보증금은")은 건너뛴다.
 * @param {string[]} lines
 * @param {string[]} labels
 * @returns {number | null}
 */
function findAmountAfterLabel(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      for (const m of line.matchAll(spacedRegex(label))) {
        const amount = parseAmount(line.slice(m.index + m[0].length, m.index + m[0].length + 40));
        if (amount !== null) return amount;
      }
    }
  }
  return null;
}

/**
 * 보증금 (원). 못 찾으면 null.
 * @param {string[]} lines
 */
export function findDeposit(lines) {
  return findAmountAfterLabel(lines, ['보증금']);
}

/**
 * 월세 (원). 표준계약서는 "차임"이라고 쓰기도 한다. 못 찾으면 null.
 * @param {string[]} lines
 */
export function findMonthlyRent(lines) {
  return findAmountAfterLabel(lines, ['월세', '차임']);
}

const SPECIAL_TERMS_HEADING = /^\s*[[【(]?\s*특\s*약\s*(?:사\s*항)?\s*[\]】)]?\s*[:：]?\s*/;
const SPECIAL_TERMS_STOP = /본\s*계약을\s*증명|서\s*명|날\s*인|^\s*(?:임\s*대\s*인|임\s*차\s*인|개업\s*공인\s*중개사)\s/;
const MAX_SPECIAL_TERM_LINES = 30;

/**
 * 특약사항 문장들을 모은다.
 * "특약사항" 제목이 있는 줄의 나머지 글자 + 다음 줄들을, 서명란이 나오기 전까지 모은다.
 * 제목이 없으면 null(못 찾음), 제목은 있는데 내용이 없으면 [].
 * @param {string[]} lines
 * @returns {string[] | null}
 */
export function findSpecialTerms(lines) {
  const start = lines.findIndex((line) => SPECIAL_TERMS_HEADING.test(line));
  if (start === -1) return null;
  const terms = [];
  const firstRest = lines[start].replace(SPECIAL_TERMS_HEADING, '').trim();
  if (firstRest) terms.push(firstRest);
  for (const line of lines.slice(start + 1, start + 1 + MAX_SPECIAL_TERM_LINES)) {
    if (SPECIAL_TERMS_STOP.test(line)) break;
    if (line.trim()) terms.push(line.trim());
  }
  return terms;
}

/**
 * 등기부 권리 종류. 위에서부터 먼저 맞는 것 하나만 쓴다. (가압류를 압류보다 먼저 본다)
 * kind 값은 PART 3 위험 점검 규칙과 맞춰야 한다.
 */
const RIGHT_KINDS = [
  { kind: 'MORTGAGE', regex: /근\s*저\s*당/ },
  { kind: 'PROVISIONAL_SEIZURE', regex: /가\s*압\s*류/ },
  { kind: 'SEIZURE', regex: /압\s*류/ },
  { kind: 'TRUST', regex: /신\s*탁/ },
  { kind: 'JEONSE', regex: /전\s*세\s*권/ },
  { kind: 'LEASEHOLD', regex: /임\s*차\s*권/ },
];

/**
 * 등기부 권리(근저당·압류·가압류·신탁·전세권·임차권)를 줄마다 찾는다.
 * - 근저당은 "채권최고액" 뒤 금액을 maxClaimAmount로 읽는다.
 * - 줄에 "말소"가 있으면 cancelled: true
 * - receivedAt(접수일)은 아직 안 읽는다. (TODO)
 * 등기부를 읽었는데 권리가 없으면 [].
 * @param {string[]} lines
 */
export function findRegistryRights(lines) {
  const rights = [];
  for (const line of lines) {
    const found = RIGHT_KINDS.find(({ regex }) => regex.test(line));
    if (!found) continue;
    let maxClaimAmount = null;
    if (found.kind === 'MORTGAGE') {
      const label = /채\s*권\s*최\s*고\s*액/.exec(line);
      maxClaimAmount = label ? parseAmount(line.slice(label.index + label[0].length)) : null;
    }
    rights.push({
      kind: found.kind,
      maxClaimAmount,
      cancelled: /말\s*소/.test(line),
      receivedAt: null,
    });
  }
  return rights;
}