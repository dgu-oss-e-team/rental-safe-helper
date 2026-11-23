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
 * 다른 금액 항목의 이름. 라벨 뒤에서 금액을 찾다가 이 이름이 나오면 멈춘다.
 * 예: "임대보증금에 대하여 아래와 같이 … 계약금 금 원정(₩ 0)"에서 보증금을 0원으로 읽지 않게 (실제 양식 서류 점검)
 */
const OTHER_AMOUNT_LABEL = /계\s*약\s*금|중\s*도\s*금|잔\s*금|관\s*리\s*비|월\s*임\s*대\s*료|월\s*세|차\s*임/;
/**
 * 월세를 찾을 때는 "보증금"에서도 멈춘다.
 * 예: "보증금 및 차임: 보증금 ₩20,000,000, 차임 ₩600,000"에서 월세를 2천만 원으로 읽지 않게 (#192, #182 리뷰)
 */
const OTHER_AMOUNT_LABEL_FOR_RENT = new RegExp(`${OTHER_AMOUNT_LABEL.source}|보\\s*증\\s*금`);

/**
 * 라벨 뒤 40글자 안에서 처음 나오는 금액을 찾는다. 금액이 없는 라벨(예: 특약의 "보증금은")은 건너뛴다.
 * 그 사이에 다른 금액 항목 이름이 나오면 그 앞까지만 본다.
 * @param {string[]} lines
 * @param {string[]} labels
 * @param {RegExp} [stopAt] 멈출 다른 항목 이름
 * @returns {number | null}
 */
function findAmountAfterLabel(lines, labels, stopAt = OTHER_AMOUNT_LABEL) {
  for (const line of lines) {
    for (const label of labels) {
      for (const m of line.matchAll(spacedRegex(label))) {
        let after = line.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const other = stopAt.exec(after);
        if (other) after = after.slice(0, other.index);
        const amount = parseAmount(after);
        if (amount !== null) return amount;
      }
    }
  }
  return null;
}

/*
 * 금액 표 (민간임대주택 표준임대차계약서 등, 실제 양식 서류 점검)
 *   "구분 임대보증금 계약금 중도금 잔금 월 임대료"
 *   "금액 ₩30,000,000 ₩0 ₩0 ₩30,000,000 ₩450,000"
 * 제목 줄에서 항목 이름의 순서를 찾고, 바로 아랫줄("금액 …")의 금액을 같은 순서로 짝짓는다.
 * 항목 수와 금액 수가 다르면 추측하지 않는다. (빈 칸이 있으면 어느 금액이 어느 항목인지 모른다)
 */
/** @type {Array<{ key: string, regex: RegExp }>} 표 제목 줄의 항목 이름 */
const TABLE_COLUMNS = [
  { key: 'deposit', regex: /보\s*증\s*금/ },
  { key: 'downPayment', regex: /계\s*약\s*금/ },
  { key: 'middlePayment', regex: /중\s*도\s*금/ },
  { key: 'balance', regex: /잔\s*금/ },
  { key: 'monthlyRent', regex: /월\s*임\s*대\s*료|월\s*세|차\s*임/ },
];
/** 금액 표의 금액 줄 맨 앞 */
const AMOUNT_ROW_START = /^\s*금\s*액/;
/** 금액 하나 (전역). "₩30,000,000", "금 일천만 원정(\ 10,000,000 )" */
const AMOUNT_GLOBAL = new RegExp(AMOUNT_REGEX.source, 'g');

/**
 * 금액 줄의 금액들을 순서대로 읽는다.
 * @param {string} line
 * @returns {Array<number | null>}
 */
function amountsInRow(line) {
  const amounts = [];
  for (const m of line.matchAll(AMOUNT_GLOBAL)) amounts.push(parseAmount(line.slice(m.index ?? 0)));
  return amounts;
}

/**
 * 금액 표에서 항목 하나의 금액을 읽는다. 표가 없거나 짝이 안 맞으면 null.
 * @param {string[]} lines
 * @param {string} key TABLE_COLUMNS의 key
 * @returns {number | null}
 */
function findAmountInTable(lines, key) {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (!AMOUNT_ROW_START.test(lines[i + 1])) continue;
    const columns = TABLE_COLUMNS.map((c) => ({ key: c.key, at: lines[i].search(c.regex) }))
      .filter((c) => c.at !== -1)
      .sort((a, b) => a.at - b.at);
    if (columns.length < 2) continue;
    const amounts = amountsInRow(lines[i + 1]);
    if (amounts.length !== columns.length) continue;
    const index = columns.findIndex((c) => c.key === key);
    if (index !== -1) return amounts[index];
  }
  return null;
}

/**
 * 보증금 (원). 금액 표를 먼저 보고, 없으면 "보증금" 라벨 뒤 금액. 못 찾으면 null.
 * @param {string[]} lines
 */
export function findDeposit(lines) {
  return findAmountInTable(lines, 'deposit') ?? findAmountAfterLabel(lines, ['보증금']);
}

/**
 * 월세 (원). 표준계약서는 "차임", 민간임대 계약서는 "월 임대료"라고 쓴다. 금액 표를 먼저 본다. 못 찾으면 null.
 * @param {string[]} lines
 */
export function findMonthlyRent(lines) {
  return (
    findAmountInTable(lines, 'monthlyRent') ??
    findAmountAfterLabel(lines, ['월세', '차임', '월임대료'], OTHER_AMOUNT_LABEL_FOR_RENT)
  );
}

/**
 * 특약 제목 줄
 * - "[특약사항]", "특약사항:", "특약 …" (뒤에 한글이 붙은 "특약으로 정한다"는 문장이라 제목이 아니다)
 * - "4. 특약" (민간임대주택 표준임대차계약서처럼 번호가 붙은 제목, #192)
 * - "[표준임대차계약서 제17조에 대한 특약사항]" (괄호 안에 다른 글자가 앞에 있는 제목, #192)
 * "제17조(특약) 임대사업자와 임차인은 … 특약으로 정할 수 있다"처럼 조항 안의 "특약"은 이 정규식의 제목이 아니다.
 * 이런 특약 조항 제목은 아래 SPECIAL_TERMS_CLAUSE로 따로 본다.
 */
const SPECIAL_TERMS_HEADING = new RegExp(
  '^\\s*(?:' +
    '(\\d{1,2})?\\s*[.)]?\\s*[[【(]?\\s*특\\s*약\\s*(?:사\\s*항)?(?![가-힣])\\s*[\\]】)]?' +
    '|[[【]\\s*[^\\]】\\n]{1,40}?특\\s*약\\s*(?:사\\s*항)?\\s*[\\]】]' +
    ')\\s*[:：]?\\s*',
);
/**
 * 특약 구간이 끝나는 서명란 줄. 서명란에 실제로 나오는 모양일 때만 멈춘다. (#219 후속 (3))
 * - 계약 증명 문장: "본 계약을 증명하기 위하여 …", "이 계약을 증명…", "위 계약을 증명…"
 * - 서명 칸 괄호: "(서명 또는 날인)", "(서명 또는 인)", "(서명 및 날인)", 줄 끝의 "(인)"
 * - 줄 맨 앞의 서명 칸 이름: "서명:", "서명란", "날인:", "서명" 한 낱말 줄
 * - 줄 맨 앞의 당사자 칸 + 칸 이름: "임차인 주소 …", "임차인 성명: …", "임대인 주민등록번호 …", "개업공인중개사 사무소소재지 …"
 * 특약 문장 속 "서 명", "날 인"(예: "계약서 명의는 임차인으로 한다", "서명 날인한 후 전입신고")에서는 멈추지 않는다.
 * 줄 맨 앞이 "임대인"이어도 뒤에 칸 이름이 없으면("임대인 사정으로 해지하면 …") 특약이다. (PR #237 리뷰)
 * "(인)"도 줄 끝에 있을 때만 서명 칸이다. ("도장(인) 지참"은 특약, PR #237 리뷰)
 * (줄 어디에서나 멈추면 그 뒤 특약이 모두 사라져 거짓 [](없음)이 된다)
 */
const SIGNATURE_FIELD =
  '(?:성\\s*명|주\\s*소|주\\s*민\\s*(?:등\\s*록\\s*)?번\\s*호|전\\s*화|연\\s*락\\s*처|휴\\s*대\\s*전\\s*화)(?![가-힣])' +
  '|주\\s*민\\s*등\\s*록|사\\s*무\\s*소|등\\s*록\\s*번\\s*호|대\\s*표\\s*자?(?![가-힣])';
const SPECIAL_TERMS_STOP = new RegExp(
  [
    '(?:본|이|위)\\s*계약을\\s*증명',
    '[(（]\\s*(?:서\\s*명|날\\s*인)\\s*(?:또는|및|·|/)\\s*(?:서\\s*명|날\\s*인|인)\\s*[)）]',
    '[(（]\\s*인\\s*[)）]\\s*$',
    '^\\s*(?:서\\s*명|날\\s*인)\\s*(?:란|[:：]|$)',
    `^\\s*(?:임\\s*대\\s*인|임\\s*차\\s*인|개업\\s*공인\\s*중개사)\\s*(?:${SIGNATURE_FIELD})`,
  ].join('|'),
);

/*
 * 특약 조항 제목 (민간임대주택 표준임대차계약서 본문, 실제 서류로 확인)
 *   "제17조(특약) 임대사업자와 임차인은 제1조부터 제15조까지에서 규정한 사항 외에 필요한 사항에 대"
 *   "해서는 따로 특약으로 정할 수 있다. 다만, 특약의 내용은 「약관의 규제에 관한 법률」을 위반해서는"
 *   "안 된다."
 *   "◈ 주택월세 소득공제 안내"
 * 특약 칸은 찾았으므로, 적은 특약이 없으면 null(못 찾음)이 아니라 [](없음)이다.
 * 서식에 원래 적힌 문장은 특약이 아니라서 건너뛴다. 단, 서식 문구 전체가 글자 그대로(띄어쓰기 무시) 맞을 때만이다.
 *   직접 쓴 특약 "임대사업자와 임차인은 … 해지할 수 있다."를 서식으로 오해해 지우면 거짓 [](없음)이 된다. (#219 리뷰)
 * 그 뒤 서식 안내 줄("◈ …", "■ …"), 다음 조항("제18조(…)"), 번호가 끊긴 번호 제목("5. 개인정보 …")에서 멈춘다.
 *   "※"는 사용자가 특약 앞에 쓰기도 해서 멈추지 않는다. (멈추면 특약이 사라진다, #219 리뷰)
 *   번호 줄은 1, 2, 3…으로 이어지면 특약이다. ("1. 반려동물 금지"처럼 마침표가 없어도, #219 리뷰)
 */
const SPECIAL_TERMS_CLAUSE = /^\s*제\s*\d{1,2}\s*조\s*[(（]\s*특\s*약\s*(?:사\s*항)?\s*[)）]\s*/;
/**
 * 서식 문장 전체 (한글·숫자만 남긴 글자로 비교). 뒤의 "다만, …" 문장은 서식마다 있을 수도 없을 수도 있다.
 * "임대사업자와 임차인은 제1조부터 제15조까지에서 규정한 사항 외에 필요한 사항에 대해서는 따로 특약으로 정할 수 있다.
 *  다만, 특약의 내용은 「약관의 규제에 관한 법률」을 위반해서는 안 된다."
 * 띄어쓰기·문장부호를 지우고 비교한다. OCR이 「를 [나 <로, "된다."를 "된다,"로 읽어도 서식으로 본다. (#219 후속 (2))
 */
const CLAUSE_FORM_TEXT = new RegExp(
  '^(?:임대사업자와|임대인과)임차인은제\\d+조부터제\\d+조까지에서규정한사항외에필요한사항에대(?:하여|해서)는' +
    '따로특약으로정할수있다(?:다만특약의내용은약관의규제에관한법률을위반해서는(?:안|아니)된다)?$',
);
/** 서식 비교용 글자: 한글·숫자만 남긴다 */
const formTextKey = (/** @type {string} */ s) => s.replace(/[^가-힣0-9]/g, '');
const MAX_CLAUSE_FORM_TEXT_LINES = 4;
/**
 * 특약 조항 뒤에 오는 서식의 다음 구간 제목: "5. 개인정보의 제3자 제공 동의서" (#219 후속 (1))
 * 사용자가 특약을 1~4번 적으면 "5."가 이어지는 번호처럼 보이므로, 번호와 상관없이 이 제목에서 멈춘다.
 * 서식 제목은 "동의서"·"확인서"로 끝날 때만 본다. "2. 개인정보 제3자 제공 금지" 같은 짧은 특약은 제목이 아니다. (PR #237 리뷰)
 */
const FORM_SECTION_TITLE = /(?:동\s*의\s*서|확\s*인\s*서)\s*$/;
/** 특약 조항 구간이 끝나는 줄: 서식 안내 줄, 다음 조항 */
const CLAUSE_SECTION_STOP = /^\s*[◈■]|^\s*제\s*\d{1,3}\s*조\s*[(（]/;
/** 번호 줄: "1. …", "2) …" → [1] 번호 */
const NUMBERED_LINE = /^\s*(\d{1,2})\s*[.)]\s*\S/;
const MAX_SPECIAL_TERM_LINES = 30;

/*
 * 특약 별지 (민간임대주택 표준임대차계약서의 "[표준임대차계약서 제17조에 대한 특약사항]", #192)
 * 별지는 여러 쪽이고, 특약 조항("특) 제1조 …") 사이사이에 설명 확인란이 있다.
 *   "본인은 계약 체결 후 명의변경은 불가하다는 내용에 대한 설명을 듣고 이해하였음." / "성명: (서명 또는 인)"
 * 확인란에서 멈추면 뒤쪽 조항(예: 특) 제18조 [신탁계약 안내])을 못 읽으므로, 별지에서는 확인란 줄을 건너뛰고
 * 다음 서식("■ … [별지 제25호의2서식]")이나 "본 계약을 증명" 문장이 나올 때까지 읽는다. (최대 200줄)
 */
/** 별지 제목: 괄호 안에서 "특약사항" 앞에 다른 글자가 있다 */
const ANNEX_HEADING = /^\s*[[【]\s*[^\]】\n]{1,40}?특\s*약\s*(?:사\s*항)?\s*[\]】]/;
const MAX_ANNEX_LINES = 200;
/**
 * 별지의 설명 확인란 줄 (특약이 아니다). 줄 모양으로만 좁게 본다. (#197 리뷰)
 * - "본인은 … 설명을 듣고 이해하였음." (줄 끝이 이해·확인·동의)
 * - "성명: (서명 또는 인)", "임차인 성명: …" (줄 맨 앞이 "(○○) 성명:")
 * - "(서명 또는 날인)"만 있는 줄
 * "임차인은 계약서에 서명 날인한 후 전입신고를 하지 않는다."처럼 특약 문장 속 "서명 날인"은 확인란이 아니다.
 */
const ANNEX_CONFIRM_LINE =
  /^\s*본인은.*(?:이해|확인|동의)(?:하였음|했음|함|합니다)?\.?\s*$|^\s*(?:[가-힣]{1,6}\s*)?성\s*명\s*[:：]|^\s*(?:[가-힣]{1,6}\s*)?성\s*명\s+[가-힣A-Za-z ]{2,20}\s*\(\s*(?:인|서\s*명|날\s*인)|^\s*\(?\s*서\s*명\s*(?:또는|및)/;
// 세 번째 모양: 콜론 없는 확인란 "성명 이영희 (인)" (#197 리뷰)
/**
 * 별지가 끝나는 곳: 줄 맨 앞의 다음 서식("■ …", "[별지 제25호의2서식]"), 계약 증명 문장.
 * 조항 안의 "별지 제1호 서식에 따라"에서는 멈추지 않는다. (#197 리뷰)
 */
const ANNEX_STOP = /^\s*■|^\s*[[【]?\s*별\s*지\s*제?\s*\d+\s*호|본\s*계약을\s*증명/;
/** 쪽 번호만 있는 줄: "2/3", "(3쪽 / 3쪽)". 특약이 아니다. */
const PAGE_MARK_LINE = /^\s*(?:\(?\s*\d+\s*쪽\s*\/\s*\d+\s*쪽\s*\)?|\d+\s*\/\s*\d+)\s*$/;
/**
 * 특약 제목인지. 번호가 붙은 제목("4. 특약")은 줄이 제목만 있거나("4. 특약사항", "4. 특약 (별지 참조)") 콜론이 올 때만 제목이다.
 * "2) 특약 위반 시 계약을 해제한다."처럼 "특약"으로 시작하는 번호 조항은 제목이 아니다. (#197 리뷰)
 * @param {string} line
 */
function isSpecialTermsHeading(line) {
  if (SPECIAL_TERMS_CLAUSE.test(line)) return true;
  const m = SPECIAL_TERMS_HEADING.exec(line);
  if (!m) return false;
  if (!m[1]) return true;
  const rest = line.slice(m[0].length).trim();
  return rest === '' || /[:：]\s*$/.test(m[0]) || rest.startsWith('(');
}

/** 문장으로 끝나는 줄 ("… 한다.", "… 따름", "… 없음"): 번호 특약 문장이지 다음 제목이 아니다 */
const SENTENCE_END = /(?:다|함|음|름|것|요|임)\.?\s*$/;
const MAX_SECTION_TITLE = 30;

/**
 * 특약 제목 하나부터 그 구간이 끝날 때까지 읽는다.
 * @param {string[]} lines
 * @param {number} start 제목 줄
 * @returns {{ start: number, body: number[], next: number, headRest: string }}
 *   next: 다음에 볼 줄, headRest: 제목 줄에서 제목 뒤에 적힌 특약 (없으면 '')
 */
function readSpecialTermSection(lines, start) {
  if (SPECIAL_TERMS_CLAUSE.test(lines[start])) return readSpecialTermClause(lines, start);
  const headingNumber = SPECIAL_TERMS_HEADING.exec(lines[start])?.[1];
  // 다음 번호 제목: "5. 개인정보의 제3자 제공 동의서" (문장으로 끝나는 특약 "5. … 한다."는 제목이 아니다)
  const nextSection = headingNumber ? new RegExp(`^\\s*${Number(headingNumber) + 1}\\s*[.)]\\s*\\S`) : null;
  const annex = ANNEX_HEADING.test(lines[start]);
  const end = Math.min(lines.length, start + 1 + (annex ? MAX_ANNEX_LINES : MAX_SPECIAL_TERM_LINES));
  /** @type {number[]} */
  const body = [];
  let i = start + 1;
  for (; i < end; i += 1) {
    const line = lines[i];
    if (isSpecialTermsHeading(line)) break; // 다른 특약 제목 ("4. 특약" 다음의 별지 제목 등)
    if (annex) {
      if (ANNEX_STOP.test(line)) break;
      if (ANNEX_CONFIRM_LINE.test(line) || PAGE_MARK_LINE.test(line)) continue;
      body.push(i);
      continue;
    }
    if (SPECIAL_TERMS_STOP.test(line)) break;
    if (nextSection && nextSection.test(line) && !SENTENCE_END.test(line) && line.trim().length <= MAX_SECTION_TITLE) break;
    if (PAGE_MARK_LINE.test(line)) continue;
    body.push(i);
  }
  return { start, body, next: i, headRest: lines[start].replace(SPECIAL_TERMS_HEADING, '').trim() };
}

/**
 * 특약 조항("제17조(특약) …") 구간을 읽는다. (위 SPECIAL_TERMS_CLAUSE 설명)
 * @param {string[]} lines
 * @param {number} start 조항 제목 줄
 * @returns {{ start: number, body: number[], next: number, headRest: string }}
 */
function readSpecialTermClause(lines, start) {
  let headRest = lines[start].replace(SPECIAL_TERMS_CLAUSE, '').trim();
  let i = start + 1;
  // 서식 문장은 건너뛴다: 제목 줄 나머지부터 이어 붙인 글자가 서식 문장 전체와 맞는 마지막 줄까지 (최대 4줄)
  let joined = formTextKey(headRest);
  let formEnd = CLAUSE_FORM_TEXT.test(joined) ? start : -1;
  const last = Math.min(lines.length, start + 1 + MAX_CLAUSE_FORM_TEXT_LINES);
  for (let j = start + 1; j < last; j += 1) {
    joined += formTextKey(lines[j]);
    if (CLAUSE_FORM_TEXT.test(joined)) formEnd = j;
  }
  if (formEnd >= 0) {
    headRest = '';
    i = formEnd + 1;
  }
  const end = Math.min(lines.length, i + MAX_SPECIAL_TERM_LINES);
  /** @type {number[]} */
  const body = [];
  let nextNumber = 1;
  for (; i < end; i += 1) {
    const line = lines[i];
    if (isSpecialTermsHeading(line)) break;
    if (CLAUSE_SECTION_STOP.test(line) || SPECIAL_TERMS_STOP.test(line)) break;
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered) {
      const isTitle = !SENTENCE_END.test(line) && line.trim().length <= MAX_SECTION_TITLE;
      // 서식의 다음 구간 제목은 번호가 이어져 보여도 멈춘다 (특약 1~4번 뒤의 "5. 개인정보의 제3자 제공 동의서")
      if (isTitle && FORM_SECTION_TITLE.test(line)) break;
      // 번호가 이어지면 특약, 끊긴 짧은 제목은 다음 서식 구간
      if (Number(numbered[1]) === nextNumber) nextNumber += 1;
      else if (isTitle) break;
    }
    if (PAGE_MARK_LINE.test(line)) continue;
    body.push(i);
  }
  return { start, body, next: i, headRest };
}

/**
 * 특약 구간들을 모두 찾는다. 제목이 여러 개면 각 구간을 차례로 읽는다. (#197 리뷰)
 * 예: "4. 특약" → "별지 특약사항 참조" → "5. …" → "[표준임대차계약서 제17조에 대한 특약사항]" → "특) 제1조 …"
 * @param {string[]} lines
 */
function findSpecialTermSections(lines) {
  const sections = [];
  for (let i = 0; i < lines.length; ) {
    if (isSpecialTermsHeading(lines[i])) {
      const section = readSpecialTermSection(lines, i);
      sections.push(section);
      i = Math.max(section.next, i + 1);
    } else {
      i += 1;
    }
  }
  return sections;
}

/**
 * 특약사항이 적힌 줄 번호 (제목 줄 포함). 제목이 없으면 [].
 * "특약사항" 제목 줄부터, 서명란이 나오기 전까지(최대 30줄).
 * 제목에 번호가 붙어 있으면("4. 특약") 다음 번호의 제목("5. 개인정보의 제3자 제공 동의서")에서도 멈춘다.
 * 쪽 번호 줄("2/3")은 넣지 않는다.
 * 특약 별지("[… 특약사항]")는 설명 확인란 줄을 건너뛰고 다음 서식까지 읽는다. (위 ANNEX_* 설명)
 * 특약 제목이 여러 개면("4. 특약"과 별지) 모든 구간의 줄을 모은다.
 * findSpecialTerms()와, 특약 속 이름에 역할을 붙이지 않을 때(index.js) 같이 쓴다.
 * @param {string[]} lines
 * @returns {number[]}
 */
export function findSpecialTermLines(lines) {
  return findSpecialTermSections(lines).flatMap((s) => [s.start, ...s.body]);
}

/**
 * 특약사항 문장들을 모은다.
 * "특약사항" 제목이 있는 줄의 나머지 글자 + 다음 줄들을, 서명란이 나오기 전까지 모은다. 제목이 여러 개면 차례로 이어 붙인다.
 * 제목이 없으면 null(못 찾음), 제목은 있는데 내용이 없으면 [].
 * @param {string[]} lines
 * @returns {string[] | null}
 */
export function findSpecialTerms(lines) {
  const sections = findSpecialTermSections(lines);
  if (sections.length === 0) return null;
  const terms = [];
  for (const { body, headRest } of sections) {
    if (headRest) terms.push(headRest);
    for (const i of body) if (lines[i].trim()) terms.push(lines[i].trim());
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
  // "신탁재산귀속", "신탁재산의귀속"은 신탁이 끝나 소유권이 돌아오는 등기라 신탁이 아니다. (#183 리뷰)
  { kind: 'TRUST', regex: /신\s*탁(?!\s*재\s*산\s*(?:의\s*)?귀\s*속)/ },
  { kind: 'JEONSE', regex: /전\s*세\s*권/ },
  { kind: 'LEASEHOLD', regex: /임\s*차\s*권/ },
];

/**
 * @typedef {object} RegistryRight
 * @property {string} kind
 * @property {number | null} maxClaimAmount 채권최고액 (근저당만, 못 읽으면 null)
 * @property {boolean | null} cancelled 말소 여부. 말소 줄이 어느 권리를 가리키는지 모르면 null(확인 필요)
 * @property {string | null} receivedAt 접수일 'YYYY-MM-DD' (못 읽으면 null)
 */

/** 갑구·을구 제목 줄: "【 갑 구 】 (소유권에 관한 사항)" */
const SECTION_HEADING = /^\s*[【[(]?\s*([갑을])\s*구\s*[】\])]?(?=\s|$)/;
/** 기록이 없는 구를 이렇게 적는 경우도 읽은 것으로 본다: "을구 기록사항 없음" */
const EMPTY_SECTION = /([갑을])\s*구.*기\s*록\s*사\s*항\s*없\s*음/;
/** 끝의 요약표는 위 내용을 되풀이하므로 여기서 멈춘다. */
const SUMMARY_HEADING = /주\s*요\s*등\s*기\s*사\s*항\s*요\s*약/;
/**
 * 기록이 아닌 안내 줄 (#298 외부 AI 평가)
 * 열람본 끝의 "* 실선으로 그어진 부분은 말소사항을 표시함. …", 쪽마다 반복되는 제목 "등기사항전부증명서(말소사항 포함)",
 * "- - 이 하 여 백 - -"에도 "말소" 글자가 있어서, 을구의 "어느 권리인지 모르는 말소 줄"로 세면
 * 유효한 근저당까지 cancelled: null(확인 필요)이 됐다. 이런 줄은 권리·말소 기록으로 보지 않는다.
 */
const NOTE_LINE = /^\s*\*|말\s*소\s*사\s*항|이\s*하\s*여\s*백/;
/**
 * 줄 맨 앞의 순위번호: "3 가압류", "1-1 근저당권변경"(부기등기).
 * 순위번호가 아닌 것: "2020년…"(날짜), "2/3"(쪽 번호), "23층(○○동)"·"101동"·"502호"(주소 둘째 줄) (#183 실제 신탁 등기부)
 */
const RANK_REGEX = /^\s*(\d{1,3})(-\d+)?(?![\d,./]|\s*[년월일번호층동])/;
/** 말소 줄이 가리키는 순위번호: "3번가압류등기말소" → 3 */
const CANCEL_TARGET = /(\d{1,3})\s*번[^\n]*?말\s*소/;
/** 권리 한 건의 이어지는 줄(권리자 칸 등). 새 권리로 세지 않는다. */
const CONTINUATION_LINE =
  /^\s*(?:근\s*저\s*당\s*권\s*자|채\s*권\s*자|채\s*무\s*자|수\s*탁\s*자|위\s*탁\s*자|권\s*리\s*자|전\s*세\s*권\s*자|임\s*차\s*권\s*자|신\s*탁\s*원\s*부)/;
const MAX_CLAIM_LABEL = /채\s*권\s*최\s*고\s*액/;
/**
 * 등기원인 칸의 글자: "서울중앙지방법원의 가압류결정(2021카단…)", "압류(세무과-1234)".
 * 좁은 칸에서 다음 줄로 넘어가 순위번호 없는 줄이 되면, 등기목적("가압류")처럼 보여도 새 권리가 아니다.
 */
const CAUSE_TEXT = /(?:가\s*)?(?:압\s*류|가\s*처\s*분|경\s*매\s*개\s*시)\s*(?:결\s*정|\()/;

/**
 * 순위번호 없는 줄이 다음 줄로 넘어간 등기원인 칸인지.
 * 줄에서 처음 나오는 권리 글자가 등기원인 글자("가압류결정(")일 때만 그렇다.
 * "가압류 2021년4월8일 … 가압류결정(…)"처럼 등기목적이 먼저 오면 순위번호만 못 읽은 진짜 권리다.
 * @param {string} line
 */
function isWrappedCause(line) {
  const cause = CAUSE_TEXT.exec(line);
  if (!cause) return false;
  const firstRight = Math.min(...RIGHT_KINDS.map(({ regex }) => regex.exec(line)?.index ?? Infinity));
  return cause.index <= firstRight;
}
/** 다른 순위번호를 가리키는 줄의 시작: "1번근저당권설정등기말소"의 "1번" */
const REFERENCE_START = /^\s*\d{1,3}\s*번/;
/** 다음 줄로 넘어간 말소 글자: "기말소", "등기말소", "말소" */
const WRAPPED_CANCEL_START = /^\s*[가-힣]{0,4}말\s*소/;

/**
 * 말소 줄이 좁은 칸 때문에 두 줄로 잘린 경우("2 1번근저당권설정등" / "기말소 제51204호 해지") 두 줄을 붙인다.
 * 다른 순위번호를 가리키는 줄인데 말소가 없고, 바로 다음 줄(순위번호 없음)이 말소 글자로 시작할 때만 붙인다.
 * @param {string[]} lines
 * @param {number} i
 * @returns {string | null} 붙인 줄. 붙일 게 아니면 null
 */
function joinWrappedCancel(lines, i) {
  const line = lines[i];
  const rankMatch = RANK_REGEX.exec(line);
  const rest = rankMatch ? line.slice(rankMatch[0].length) : line;
  if (!REFERENCE_START.test(rest) || /말\s*소/.test(rest)) return null;
  const next = lines[i + 1];
  if (next === undefined || RANK_REGEX.test(next) || !WRAPPED_CANCEL_START.test(next)) return null;
  return `${line}${next.trim()}`;
}

/**
 * 등기부 권리(근저당·압류·가압류·신탁·전세권·임차권)를 찾는다. 갑구·을구 안의 줄만 본다.
 * - 갑구·을구 제목을 둘 다 찾았을 때만 결과를 준다. 하나라도 못 찾으면 null(못 읽음).
 *   (한쪽만 읽고 []를 주면 "압류 없음"처럼 보이기 때문)
 * - 근저당은 "채권최고액" 뒤 금액을 maxClaimAmount로 읽는다. 다음 줄에 있어도 읽는다.
 * - 말소는 별도 줄("3번가압류등기말소")로 적히므로, 그 줄이 가리키는 순위번호의 권리를 cancelled: true로 바꾼다.
 *   어느 권리인지 모르는 말소 줄이 있으면 그 구에서 말소 표시가 없는 권리는 cancelled: null(확인 필요).
 *   (말소된 칸에 그어진 빨간 줄은 글자로 읽히지 않는다)
 * - 부기등기("1-1 근저당권변경")와 이어지는 줄("근저당권자 …")은 새 권리로 세지 않는다.
 * - receivedAt(접수일)은 'YYYY-MM-DD'로 읽는다. 표의 칸 순서가 [순위번호, 등기목적, 접수, 등기원인, …]이라
 *   권리 줄의 첫 날짜를 접수일로 본다. 줄에 날짜가 없으면 다음 순위번호 전까지 최대 3줄에서 찾는다. (갑구 소유권이전 접수일과 같은 방식)
 *   순위번호 없는 줄에서 찾은 권리(기록 중간의 "신탁" 줄 등)와 못 읽은 경우는 null. (#301 외부 AI 평가: 근저당 설정 시점)
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
  /** 지금 읽는 기록(순위번호 하나)의 순위번호와, 그 기록에서 이미 센 권리 종류 */
  /** @type {string | null} */
  let rowRank = null;
  let rowKinds = new Set();
  /** 부기등기("2-1 신탁주의사항") 줄 다음의 설명 줄인지 (다음 순위번호까지) */
  let inSupplement = false;
  /** 접수일을 다음 줄에서 기다리는 권리 (권리 줄에 날짜가 없을 때) */
  /** @type {{ right: RegistryRight, seen: number } | null} */
  let waitingDate = null;

  for (let i = 0; i < lines.length; i += 1) {
    const joined = joinWrappedCancel(lines, i);
    const line = joined ?? lines[i];
    if (joined !== null) i += 1; // 붙인 다음 줄은 다시 보지 않는다
    if (SUMMARY_HEADING.test(line)) break;
    const empty = EMPTY_SECTION.exec(line);
    if (empty) seen.add(empty[1]);
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      section = heading[1];
      seen.add(section);
      rowRank = null;
      rowKinds = new Set();
      inSupplement = false;
      continue;
    }
    if (section === null) continue;
    if (NOTE_LINE.test(line)) continue; // 안내 줄의 "말소사항"은 말소 기록이 아니다

    const rankMatch = RANK_REGEX.exec(line);
    if (rankMatch) {
      inSupplement = Boolean(rankMatch[2]);
      waitingDate = null; // 다음 기록이 시작되면 앞 권리의 접수일은 더 찾지 않는다
      if (!rankMatch[2]) {
        rowRank = rankMatch[1];
        rowKinds = new Set();
      }
    } else if (inSupplement) {
      continue; // 부기등기의 설명 줄 ("이 부동산에 관하여 … 신탁원부를 통하여 …")는 권리가 아니다
    } else if (waitingDate && waitingDate.seen < MAX_DATE_LOOKAHEAD) {
      // 권리 줄에 없던 접수일: 이어지는 줄에서 찾는다 (좁은 칸에서 접수 칸이 다음 줄로 넘어간 경우)
      waitingDate.seen += 1;
      waitingDate.right.receivedAt = parseDate(line);
      if (waitingDate.right.receivedAt !== null) waitingDate = null;
    }

    if (/말\s*소/.test(line)) {
      const target = CANCEL_TARGET.exec(line);
      cancels.push({ section, rank: target ? target[1] : null });
      continue;
    }
    if (CONTINUATION_LINE.test(line)) continue;

    if (rankMatch && rankMatch[2]) continue; // 부기등기
    const rank = rankMatch ? rankMatch[1] : null;
    if (rank === null && isWrappedCause(line)) continue; // 다음 줄로 넘어간 등기원인 칸

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
    // 신탁은 한 기록 안에 여러 줄로 나온다: "2 소유권이전 … 수탁자 ○○자산신탁(주)" / "신탁" / "신탁 신탁원부 제…호".
    // 순위번호 없는 신탁 줄은, 같은 기록에서 신탁을 이미 셌으면 새 권리가 아니다. (실제 양식 서류 점검)
    if (rank === null && found.kind === 'TRUST' && rowKinds.has('TRUST')) continue;

    /** @type {RegistryRight} */
    const right = {
      kind: found.kind,
      maxClaimAmount:
        found.kind === 'MORTGAGE' && maxClaim ? parseAmount(line.slice(maxClaim.index + maxClaim[0].length)) : null,
      cancelled: false,
      // 순위번호가 있는 권리 줄만 접수일을 읽는다 (줄의 첫 날짜 = 접수 칸)
      receivedAt: rank !== null ? parseDate(line) : null,
    };
    rights.push(right);
    if (rank !== null && right.receivedAt === null) waitingDate = { right, seen: 0 };
    // 순위번호 없는 신탁 줄은 지금 기록의 순위번호를 쓴다. ("3번신탁등기말소"가 이 신탁을 가리킬 수 있게)
    places.push({ section, rank: rank ?? (found.kind === 'TRUST' ? rowRank : null) });
    rowKinds.add(found.kind);
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
/**
 * "소유권일부이전": 소유자가 지분 일부를 넘긴 것이라 넘긴 사람도 나머지 지분으로 계속 소유자다.
 * ("김철수지분전부이전"은 공유자 한 명이 빠지는 것이라 누가 빠졌는지 이름을 맞춰야 해서 여기에 넣지 않는다)
 */
const WHOLE_OWNERSHIP_PARTIAL = /^\s*소\s*유\s*권\s*일\s*부\s*이\s*전/;
/** 다음 줄로 넘어간 등기목적의 끝 "이전" ("공유자전원지분전부" / "이전 제80246호 매매 …") */
const WRAPPED_TRANSFER_END = /^\s*이\s*전(?![가-힣])/;

/**
 * 등기목적 칸이 좁아 "이전"이 다음 줄로 넘어간 소유권이전인지. (#165)
 * 예: "2 공유자전원지분전부 2025년9월15일 …" / "이전 제80246호 매매 …"
 * 줄의 첫 낱말에 "이전"을 붙였을 때 소유권이전 모양이 되고, 다음 줄(순위번호 없음)이 "이전"으로 시작할 때만 그렇다.
 * @param {string} rest 순위번호 뒤의 글자
 * @param {string | undefined} next 다음 줄
 */
function isWrappedTransfer(rest, next) {
  if (next === undefined || RANK_REGEX.test(next) || !WRAPPED_TRANSFER_END.test(next)) return false;
  const first = /^\s*(\S+)/.exec(rest);
  return first !== null && TRANSFER_PURPOSE.test(`${first[1]}이전`);
}

/** 소유권이전 줄에 접수일이 없을 때, 이어지는 줄을 몇 줄까지 볼지 */
const MAX_DATE_LOOKAHEAD = 3;

/**
 * @typedef {object} GapRow 갑구 기록 한 건 (순위번호 하나)
 * @property {string | null} rank 순위번호 (못 읽으면 null)
 * @property {'PRESERVE' | 'TRANSFER' | 'PARTIAL' | 'OTHER'} kind 소유권보존 / 소유권이전 / 일부 이전 / 그 밖(압류 등)
 * @property {string | null} date 첫 날짜 (소유권이전이면 접수일)
 * @property {boolean} cancelled 말소됐는지
 * @property {number[]} lineIndexes 이 기록에 속한 줄 번호 (lines 기준. 이어지는 줄 포함)
 * @property {boolean} [keepsRest] "소유권일부이전": 넘긴 사람이 나머지 지분을 그대로 갖는 일부 이전
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

  /** 앞 줄에 붙여서 이미 읽은 줄 번호 (잘린 말소 줄의 뒷부분) */
  let joinedLine = -1;

  lines.forEach((original, i) => {
    if (section === 'STOP' || i === joinedLine) return;
    const joined = joinWrappedCancel(lines, i);
    if (joined !== null) joinedLine = i + 1;
    const line = joined ?? original;
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
      if (kind === 'PARTIAL' && WHOLE_OWNERSHIP_PARTIAL.test(rest)) row.keepsRest = true;
      rows.push(row);
      current = row;
      waiting = (kind === 'TRANSFER' || kind === 'PARTIAL') && row.date === null ? { row, seen: 0 } : null;
    };

    if (TRANSFER_PURPOSE.test(rest) || (rank !== null && isWrappedTransfer(rest, lines[i + 1]))) {
      return startRow(PARTIAL_TRANSFER.test(rest) ? 'PARTIAL' : 'TRANSFER');
    }
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

/** 회사 이름에 들어 있는 낱말 (사람 이름과 구분한다) */
const COMPANY_WORD = /주식회사|유한회사|유한책임회사|합자회사|㈜|\(주\)|리츠|투자회사|신탁|법인/;
/** 등기부 소유권 기록의 소유자 칸 라벨 뒤 이름: "수탁자 가상신탁주식회사", "소유자 주식회사 가상리츠", "소유자 가상리츠 주식회사" */
const OWNER_LABEL_NAME = /(?:수\s*탁\s*자|소\s*유\s*자|공\s*유\s*자)\s+((?:주식회사|유한회사|㈜|\(주\))\s*\S+|\S+(?:\s+(?:주식회사|유한회사))?)/g;

/**
 * 등기부 "지금 소유자" 기록에 적힌 회사 이름들. (②카드 법인명 표시용 · 개인정보 아님 · 사람 명단 registry.owners와 별개)
 * 신탁이면 수탁자(신탁회사), 법인 소유면 그 법인이다. 예전 소유자 기록의 회사는 넣지 않는다.
 * - 지금 소유자를 정할 수 없으면(일부 이전 등) null. 회사가 없으면 [].
 * - 순위번호 있는 소유권 기록이 없어 줄일 근거가 없으면('ALL') 모든 줄에서 찾는다.
 * - 법인등록번호(110111-…)는 이름에 넣지 않는다.
 * @param {string[]} lines
 * @returns {string[] | null}
 */
export function findCurrentOwnerCompanies(lines) {
  const current = findCurrentOwnerLines(lines);
  if (current === null) return null;
  const target = current === 'ALL' ? lines : current.map((i) => lines[i] ?? '');
  /** @type {string[]} */
  const names = [];
  for (const line of target) {
    for (const m of line.matchAll(OWNER_LABEL_NAME)) {
      const name = m[1].replace(/[,.;:)]+$/, (tail) => (m[1].includes('(') ? tail : '')).trim();
      if (COMPANY_WORD.test(name) && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * 갑구의 소유권 기록을 지금 소유자 기록과 예전 소유자 기록으로 나눈다.
 * - 지금 소유자: 말소되지 않은 마지막 소유권보존·소유권이전(전부) 기록
 * - 그 뒤에 "소유권일부이전"만 이어지면, 넘긴 사람도 나머지 지분으로 계속 소유자라서 그 기록들을 합쳐 지금 소유자로 본다.
 *   예: "1 소유권보존 전우치" → "2 소유권일부이전 공유자 지분 2분의 1 황진이" → 지금 소유자 전우치·황진이 (상욱님 가짜세트4)
 * - 그 뒤에 다른 일부 이전("김철수지분전부이전" 등)이 있으면 누가 빠졌는지 이름을 맞춰야 해서 정하지 않는다(null).
 * @param {string[]} lines
 * @returns {{ current: GapRow, previous: GapRow[] } | 'ALL' | null}
 */
function readOwnershipRecords(lines) {
  const { seenGap, ambiguous, rows } = readGapRows(lines);
  const ownership = rows.filter((r) => r.kind !== 'OTHER');
  if (!seenGap || ownership.length === 0) return 'ALL';
  if (ambiguous) return null;
  const live = ownership.filter((r) => !r.cancelled);
  let lastWhole = -1;
  live.forEach((r, i) => {
    if (r.kind !== 'PARTIAL') lastWhole = i;
  });
  if (lastWhole === -1) return null;
  const after = live.slice(lastWhole + 1);
  if (!after.every((r) => r.keepsRest)) return null;
  const group = [live[lastWhole], ...after];
  /** @type {GapRow} */
  const current =
    after.length === 0 ? live[lastWhole] : { ...live[lastWhole], lineIndexes: group.flatMap((r) => r.lineIndexes) };
  return { current, previous: ownership.filter((r) => !group.includes(r)) };
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