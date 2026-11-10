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
 * @typedef {object} RegistryRight
 * @property {string} kind
 * @property {number | null} maxClaimAmount 채권최고액 (근저당만, 못 읽으면 null)
 * @property {boolean | null} cancelled 말소 여부. 말소 줄이 어느 권리를 가리키는지 모르면 null(확인 필요)
 * @property {string | null} receivedAt 접수일 (아직 안 읽는다)
 */

/** 갑구·을구 제목 줄: "【 갑 구 】 (소유권에 관한 사항)" */
const SECTION_HEADING = /^\s*[【[(]?\s*([갑을])\s*구\s*[】\])]?(?=\s|$)/;
/** 기록이 없는 구를 이렇게 적는 경우도 읽은 것으로 본다: "을구 기록사항 없음" */
const EMPTY_SECTION = /([갑을])\s*구.*기\s*록\s*사\s*항\s*없\s*음/;
/** 끝의 요약표는 위 내용을 되풀이하므로 여기서 멈춘다. */
const SUMMARY_HEADING = /주\s*요\s*등\s*기\s*사\s*항\s*요\s*약/;
/** 줄 맨 앞의 순위번호: "3 가압류", "1-1 근저당권변경"(부기등기). "2020년"은 순위번호가 아니다. */
const RANK_REGEX = /^\s*(\d{1,3})(-\d+)?(?![\d,.]|\s*[년월일번호])/;
/** 말소 줄이 가리키는 순위번호: "3번가압류등기말소" → 3 */
const CANCEL_TARGET = /(\d{1,3})\s*번[^\n]*?말\s*소/;
/** 권리 한 건의 이어지는 줄(권리자 칸 등). 새 권리로 세지 않는다. */
const CONTINUATION_LINE =
  /^\s*(?:근\s*저\s*당\s*권\s*자|채\s*권\s*자|채\s*무\s*자|수\s*탁\s*자|위\s*탁\s*자|권\s*리\s*자|전\s*세\s*권\s*자|임\s*차\s*권\s*자|신\s*탁\s*원\s*부)/;
const MAX_CLAIM_LABEL = /채\s*권\s*최\s*고\s*액/;

/**
 * 등기부 권리(근저당·압류·가압류·신탁·전세권·임차권)를 찾는다. 갑구·을구 안의 줄만 본다.
 * - 갑구·을구 제목을 둘 다 찾았을 때만 결과를 준다. 하나라도 못 찾으면 null(못 읽음).
 *   (한쪽만 읽고 []를 주면 "압류 없음"처럼 보이기 때문)
 * - 근저당은 "채권최고액" 뒤 금액을 maxClaimAmount로 읽는다. 다음 줄에 있어도 읽는다.
 * - 말소는 별도 줄("3번가압류등기말소")로 적히므로, 그 줄이 가리키는 순위번호의 권리를 cancelled: true로 바꾼다.
 *   어느 권리인지 모르는 말소 줄이 있으면 그 구에서 말소 표시가 없는 권리는 cancelled: null(확인 필요).
 *   (말소된 칸에 그어진 빨간 줄은 글자로 읽히지 않는다)
 * - 부기등기("1-1 근저당권변경")와 이어지는 줄("근저당권자 …")은 새 권리로 세지 않는다.
 * - receivedAt(접수일)은 아직 안 읽는다. (TODO)
 * @param {string[]} lines
 * @returns {RegistryRight[] | null}
 */
export function findRegistryRights(lines) {
  /** @type {RegistryRight[]} */
  const rights = [];
  /** 권리마다 [구, 순위번호] (순위번호를 못 읽으면 null) */
  /** @type {Array<{ section: string, rank: string | null }>} */
  const places = [];
  /** @type {Array<{ section: string, rank: string | null }>} */
  const cancels = [];
  const seen = new Set();
  /** @type {string | null} */
  let section = null;

  for (const line of lines) {
    if (SUMMARY_HEADING.test(line)) break;
    const empty = EMPTY_SECTION.exec(line);
    if (empty) seen.add(empty[1]);
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      section = heading[1];
      seen.add(section);
      continue;
    }
    if (section === null) continue;

    if (/말\s*소/.test(line)) {
      const target = CANCEL_TARGET.exec(line);
      cancels.push({ section, rank: target ? target[1] : null });
      continue;
    }
    if (CONTINUATION_LINE.test(line)) continue;

    const rankMatch = RANK_REGEX.exec(line);
    if (rankMatch && rankMatch[2]) continue; // 부기등기
    const rank = rankMatch ? rankMatch[1] : null;

    const found = RIGHT_KINDS.find(({ regex }) => regex.test(line));
    const maxClaim = MAX_CLAIM_LABEL.exec(line);
    if (!found) {
      // 채권최고액만 다음 줄에 있는 경우: 바로 앞 근저당에 붙인다.
      const last = rights[rights.length - 1];
      if (maxClaim && last && last.kind === 'MORTGAGE' && last.maxClaimAmount === null) {
        last.maxClaimAmount = parseAmount(line.slice(maxClaim.index + maxClaim[0].length));
      }
      continue;
    }
    if (rank !== null && places.some((p) => p.section === section && p.rank === rank)) continue;

    rights.push({
      kind: found.kind,
      maxClaimAmount:
        found.kind === 'MORTGAGE' && maxClaim ? parseAmount(line.slice(maxClaim.index + maxClaim[0].length)) : null,
      cancelled: false,
      receivedAt: null,
    });
    places.push({ section, rank });
  }

  if (!seen.has('갑') || !seen.has('을')) return null;

  const unknownCancelSections = new Set();
  for (const c of cancels) {
    const i = c.rank === null ? -1 : places.findIndex((p) => p.section === c.section && p.rank === c.rank);
    if (i === -1) unknownCancelSections.add(c.section);
    else rights[i].cancelled = true;
  }
  rights.forEach((r, i) => {
    if (r.cancelled === false && unknownCancelSections.has(places[i].section)) r.cancelled = null;
  });
  return rights;
}