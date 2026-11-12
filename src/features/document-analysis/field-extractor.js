// @ts-check
/**
 * PART 2. 비교용 항목 추출 (보증금·월세·특약·등기부 권리)
 * extractFields()가 쓸 재료다. 입력은 문서의 글자 줄 목록(블록 text 배열)이다.
 * null 규칙: 항목을 못 찾으면 null(못 읽음), 찾았는데 내용이 없으면 [](없음).
 */

/** @type {Record<string, number>} */
const KOREAN_DIGITS = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
/** @type {Record<string, number>} */
const SMALL_UNITS = { 십: 10, 백: 100, 천: 1000 };
/** @type {Record<string, number>} */
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

/**
 * 날짜 한 덩어리: "2025년 3월 5일", "2025.03.05", "2025. 3. 5.", "2025-03-05"
 * 앞뒤에 숫자가 붙어 있으면 날짜가 아니다. (고유번호 "0000-0000-000000", 주민번호 "800101-1…")
 */
const DATE_REGEX = /(?<!\d)(\d{4})\s*(?:년\s*|[.\-/]\s*)(\d{1,2})\s*(?:월\s*|[.\-/]\s*)(\d{1,2})(?!\d)/g;

/**
 * 연·월·일이 실제로 있는 날짜면 'YYYY-MM-DD', 아니면 null. (2월 30일, 13월은 null)
 * @param {string} y @param {string} m @param {string} d
 */
function toIsoDate(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (year < 1900 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 글자에서 처음 나오는 날짜를 'YYYY-MM-DD'로 읽는다. 없는 날짜(2월 30일 등)는 건너뛴다. 못 찾으면 null.
 * @param {string} text
 * @returns {string | null}
 */
export function parseDate(text) {
  for (const m of text.matchAll(DATE_REGEX)) {
    const iso = toIsoDate(m[1], m[2], m[3]);
    if (iso) return iso;
  }
  return null;
}

/**
 * 갑구 한 줄의 등기목적이 소유권이전인지. (순위번호를 뗀 나머지의 맨 앞을 본다)
 * "소유권이전", "소유권일부이전", "공유자전원지분전부이전"은 센다.
 * "소유권이전청구권가등기"는 아직 소유권이 넘어간 게 아니라서 세지 않는다.
 * "소유권이전등기말소"는 소유권이전이 아니라 말소 줄이다.
 */
const TRANSFER_PURPOSE =
  /^\s*(?:소\s*유\s*권\s*(?:일\s*부\s*)?이\s*전|[가-힣]{0,10}지\s*분\s*(?:전\s*부\s*|일\s*부\s*)?이\s*전)(?!\s*청\s*구\s*권|\s*가\s*등\s*기|\s*(?:등\s*기\s*)?말\s*소)/;
/** 말소 줄이 맨 앞에 가리키는 순위번호: "3번소유권이전등기말소" */
const CANCEL_LINE = /^\s*(\d{1,3})\s*번[^\n]*?말\s*소/;
/** 소유권이전이 아닌 다른 등기를 말소하는 줄 (신탁등기말소, 가압류등기말소 등). 소유권이전과 상관없다. */
const OTHER_CANCEL = /신\s*탁|압\s*류|가\s*등\s*기|가\s*처\s*분|경\s*매|등\s*기\s*명\s*의\s*인/;
/** 소유권보존 줄 (처음 등기한 소유자) */
const PRESERVE_PURPOSE = /^\s*소\s*유\s*권\s*보\s*존/;
/**
 * 일부만 넘어간 소유권이전: "소유권일부이전", "김철수지분전부이전"(공유자 한 명의 지분).
 * "공유자전원지분전부이전"은 전부 넘어간 것이라 일부가 아니다.
 */
const PARTIAL_TRANSFER = /^\s*(?:소\s*유\s*권\s*일\s*부|(?![가-힣]{0,3}전\s*원\s*지\s*분\s*전\s*부)[가-힣]{0,10}지\s*분)/;
/** 소유권이전 줄에 접수일이 없을 때, 이어지는 줄을 몇 줄까지 볼지 */
const MAX_DATE_LOOKAHEAD = 3;

/**
 * @typedef {object} GapRow 갑구 기록 한 건 (순위번호 하나)
 * @property {string | null} rank 순위번호 (못 읽으면 null)
 * @property {'PRESERVE' | 'TRANSFER' | 'PARTIAL' | 'OTHER'} kind 소유권보존 / 소유권이전 / 일부 이전 / 그 밖(압류 등)
 * @property {string | null} date 첫 날짜 (소유권이전이면 접수일)
 * @property {boolean} cancelled 말소됐는지
 * @property {number[]} lineIndexes 이 기록에 속한 줄 번호 (lines 기준. 이어지는 줄 포함)
 */

/**
 * 등기부 갑구를 기록(순위번호) 단위로 읽는다. findLastTransferDate·findCurrentOwnerLines가 같이 쓴다.
 * - 부기등기("2-1 …")와 그 뒤 줄은 어느 기록에도 넣지 않는다.
 * - 말소 줄("3번소유권이전등기말소")은 가리키는 기록을 cancelled: true로 바꾼다.
 *   어느 기록인지 모르면 ambiguous: true. (신탁·가압류 등 다른 등기의 말소는 상관없다)
 * - 을구와 끝의 요약표는 보지 않는다.
 * @param {string[]} lines
 * @returns {{ seenGap: boolean, ambiguous: boolean, rows: GapRow[] }}
 */
function readGapRows(lines) {
  /** @type {GapRow[]} */
  const rows = [];
  /** @type {Array<string | null>} 말소 줄이 가리키는 순위번호 (모르면 null) */
  const cancelTargets = [];
  /** 지금 읽는 기록 (이어지는 줄을 붙일 곳) */
  /** @type {GapRow | null} */
  let current = null;
  /** 접수일을 아직 못 찾은 소유권이전과, 그 뒤로 본 줄 수 */
  /** @type {{ row: GapRow, seen: number } | null} */
  let waiting = null;
  let seenGap = false;
  /** @type {string | null} */
  let section = null;

  lines.forEach((line, i) => {
    if (section === 'STOP') return;
    if (SUMMARY_HEADING.test(line)) {
      section = 'STOP';
      return;
    }
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      section = heading[1];
      if (section === '갑') seenGap = true;
      current = null;
      waiting = null;
      return;
    }
    if (section !== '갑') return;

    const rankMatch = RANK_REGEX.exec(line);
    if (rankMatch && rankMatch[2]) {
      // 부기등기: 새 기록이 아니고, 이 줄의 날짜·이름을 앞 기록에 붙이지도 않는다.
      current = null;
      waiting = null;
      return;
    }
    const rank = rankMatch ? rankMatch[1] : null;
    const rest = rankMatch ? line.slice(rankMatch[0].length) : line;

    /** @param {GapRow['kind']} kind */
    const startRow = (kind) => {
      /** @type {GapRow} */
      const row = { rank, kind, date: parseDate(rest), cancelled: false, lineIndexes: [i] };
      rows.push(row);
      current = row;
      waiting = (kind === 'TRANSFER' || kind === 'PARTIAL') && row.date === null ? { row, seen: 0 } : null;
    };

    if (TRANSFER_PURPOSE.test(rest)) return startRow(PARTIAL_TRANSFER.test(rest) ? 'PARTIAL' : 'TRANSFER');
    if (PRESERVE_PURPOSE.test(rest)) return startRow('PRESERVE');
    if (/말\s*소/.test(rest)) {
      current = null;
      waiting = null;
      if (OTHER_CANCEL.test(rest)) return;
      const target = CANCEL_LINE.exec(rest);
      cancelTargets.push(target ? target[1] : null);
      return;
    }
    if (rank !== null) return startRow('OTHER');

    // 순위번호 없는 이어지는 줄: 지금 기록에 붙이고, 접수일을 기다리는 소유권이전이면 여기서 찾는다.
    if (current) current.lineIndexes.push(i);
    if (waiting && waiting.seen < MAX_DATE_LOOKAHEAD) {
      waiting.seen += 1;
      waiting.row.date = parseDate(line);
      if (waiting.row.date !== null) waiting = null;
    }
  });

  let ambiguous = false;
  for (const target of cancelTargets) {
    const row = target === null ? undefined : rows.find((r) => r.rank === target);
    if (row) row.cancelled = true;
    else ambiguous = true;
  }
  return { seenGap, ambiguous, rows };
}

/**
 * 등기부 갑구에서 마지막 소유권이전의 접수일을 'YYYY-MM-DD'로 읽는다. (PART 3 최근 소유권 이전 점검용)
 * - 갑구 표의 칸 순서가 [순위번호, 등기목적, 접수, 등기원인, …]이라서, 소유권이전 줄의 첫 날짜를 접수일로 본다.
 *   줄에 날짜가 없으면 이어지는 줄(다음 순위번호 전까지, 최대 3줄)에서 찾는다.
 * - 신탁으로 인한 소유권이전, 지분 이전도 센다. 소유권이전청구권가등기는 세지 않는다.
 * - 말소된 소유권이전("3번소유권이전등기말소")은 빼고 그 전 소유권이전을 쓴다.
 *   어느 순위번호를 말소했는지 모르면 추측하지 않고 null. (신탁·가압류 등 다른 등기의 말소는 상관없다)
 * - 소유권보존만 있으면 null. (소유권이 바뀐 적 없음. 신축을 "최근 바뀜"으로 보이지 않게)
 * - 마지막 소유권이전의 접수일을 못 읽으면 null. (그 전 날짜로 대신하면 최근 이전을 놓친다)
 * - 갑구 제목을 못 찾으면 null. 을구와 끝의 요약표는 보지 않는다.
 * @param {string[]} lines
 * @returns {string | null}
 */
export function findLastTransferDate(lines) {
  const { seenGap, ambiguous, rows } = readGapRows(lines);
  if (!seenGap || ambiguous) return null;
  const transfers = rows.filter((r) => (r.kind === 'TRANSFER' || r.kind === 'PARTIAL') && !r.cancelled);
  if (transfers.length === 0) return null;
  return transfers[transfers.length - 1].date;
}

/**
 * 등기부에서 "지금 소유자"가 적힌 줄을 찾는다. (registry.owners를 지금 소유자만으로 줄일 때 쓴다)
 * 갑구에는 예전 소유자도 차례로 남아 있어서, 소유자 이름을 전부 모으면 이미 집을 판 사람까지 소유자가 된다.
 * - 말소되지 않은 마지막 소유권보존·소유권이전 기록의 줄 번호를 돌려준다. (이어지는 줄 포함)
 * - 'ALL': 갑구가 없거나 순위번호가 붙은 소유권 기록을 못 찾음 → 줄일 근거가 없으니 지금처럼 전부 쓴다.
 * - null: 지금 소유자를 정할 수 없음 → 추측하지 않는다.
 *   (어느 기록을 말소했는지 모름, 마지막이 일부 이전("소유권일부이전", "김철수지분전부이전")이라 여러 기록에 나뉨)
 * @param {string[]} lines
 * @returns {number[] | 'ALL' | null}
 */
export function findCurrentOwnerLines(lines) {
  const r = readOwnershipRecords(lines);
  if (r === 'ALL' || r === null) return r;
  return r.current.lineIndexes;
}

/**
 * 등기부에서 "예전 소유자"가 적힌 줄을 찾는다. (registry.previousOwners를 만들 때 쓴다)
 * 지금 소유자 기록을 뺀 나머지 소유권보존·소유권이전 기록의 줄 번호다. 말소된 기록도 포함한다.
 * 갑구 기록 줄만 보므로, 끝의 요약표에 적힌 지금 소유자를 예전 소유자로 잘못 넣지 않는다.
 * - 지금 소유자를 정할 수 없거나('ALL', null) 하면 예전 소유자도 정할 수 없어서 null
 * @param {string[]} lines
 * @returns {number[] | null}
 */
export function findPreviousOwnerLines(lines) {
  const r = readOwnershipRecords(lines);
  if (r === 'ALL' || r === null) return null;
  return r.previous.flatMap((row) => row.lineIndexes);
}

/**
 * 갑구의 소유권 기록을 지금 소유자 기록과 예전 소유자 기록으로 나눈다.
 * @param {string[]} lines
 * @returns {{ current: GapRow, previous: GapRow[] } | 'ALL' | null}
 */
function readOwnershipRecords(lines) {
  const { seenGap, ambiguous, rows } = readGapRows(lines);
  const ownership = rows.filter((r) => r.kind !== 'OTHER');
  if (!seenGap || ownership.length === 0) return 'ALL';
  if (ambiguous) return null;
  const live = ownership.filter((r) => !r.cancelled);
  const current = live[live.length - 1];
  if (!current || current.kind === 'PARTIAL') return null;
  return { current, previous: ownership.filter((r) => r !== current) };
}

/** "계약일", "계약일자", "계약체결일" 라벨. 바로 뒤에 날짜가 와야 한다. ("계약일로부터 30일"은 아니다) */
const CONTRACT_DATE_LABEL = /계\s*약\s*(?:체\s*결\s*)?일\s*(?:자\s*)?[:：]?\s*/g;
/** 글자 맨 앞에 있는 날짜 (라벨 바로 뒤 날짜를 읽을 때) */
const DATE_AT_START = new RegExp(`^${DATE_REGEX.source}`);
/** 서명란 문장: "본 계약을 증명하기 위하여 … 서명·날인 후 각 1통씩 보관한다." 그 뒤 날짜가 계약(서명)일이다. */
const SIGNATURE_SENTENCE = /본\s*계\s*약\s*을\s*증\s*명/;
/** 서명란 문장 뒤로 계약일을 찾아볼 줄 수 */
const MAX_SIGNATURE_LOOKAHEAD = 5;

/**
 * 계약서의 계약일을 'YYYY-MM-DD'로 읽는다. (PART 3 최근 소유권 이전 점검용)
 * 1순위: "계약일", "계약일자", "계약체결일" 라벨 바로 뒤 날짜
 * 2순위: 서명란 문장("본 계약을 증명하기 위하여 …") 뒤에 나오는 날짜 (같은 줄 또는 다음 5줄 안)
 * 잔금일·입주일·임대차 시작일 등 다른 날짜는 읽지 않는다. 못 찾으면 null.
 * @param {string[]} lines
 * @returns {string | null}
 */
export function findContractDate(lines) {
  for (const line of lines) {
    for (const m of line.matchAll(CONTRACT_DATE_LABEL)) {
      const after = line.slice(m.index + m[0].length);
      const date = DATE_AT_START.exec(after);
      if (date) {
        const iso = toIsoDate(date[1], date[2], date[3]);
        if (iso) return iso;
      }
    }
  }

  const start = lines.findIndex((line) => SIGNATURE_SENTENCE.test(line));
  if (start === -1) return null;
  const first = lines[start];
  const sentence = SIGNATURE_SENTENCE.exec(first);
  const candidates = [
    first.slice((sentence?.index ?? 0) + (sentence?.[0].length ?? 0)),
    ...lines.slice(start + 1, start + 1 + MAX_SIGNATURE_LOOKAHEAD),
  ];
  for (const text of candidates) {
    const iso = parseDate(text);
    if (iso) return iso;
  }
  return null;
}