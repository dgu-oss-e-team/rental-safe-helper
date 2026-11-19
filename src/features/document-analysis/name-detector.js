// @ts-check
/**
 * PART 2. 이름·주소 탐지 (라벨 기반)
 * 정규식만으로는 이름을 알 수 없어서, "임대인", "예금주" 같은 라벨 바로 뒤에 오는 글자를 이름으로 본다.
 * 라벨과 역할 목록은 src/config/templates/person-labels.json에 있다. (코드 수정 없이 파일만 고쳐서 추가)
 * 결과의 start/end는 pii-patterns.js와 같이 "몇 번째 글자부터 몇 번째 글자까지"이다.
 */
import { PII_TYPE } from '../../shared/document-model.js';
import { findIdNumbers, isCorporateNumber } from './pii-patterns.js';
import rules from '../../config/templates/person-labels.json';

/**
 * 정규식 특수문자를 글자 그대로 쓰이게 바꾼다.
 * @param {string} s
 */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "임대인" → "임\s*대\s*인" : OCR이 글자 사이에 공백을 넣어도 찾는다.
 * @param {string} word
 */
const spaced = (word) => [...word].map(escapeRegex).join('\\s*');

const NAME_FIELD = rules.nameFieldWords.map(spaced).join('|');
const NOT_NAMES = new Set(rules.notNames);

/** 낱말 끝의 조사 (긴 것부터, person-labels.json의 nameParticles. PART 4도 같은 목록을 읽는다) */
const TRAILING_PARTICLE = new RegExp(`(?:${rules.nameParticles.map(escapeRegex).join('|')})$`);

/**
 * 조사를 뗀 나머지가 이름이 아닌 단어(notNames)인지. (#158)
 * 예: 특약 "임대인 자산에 대한 수입으로" → "자산에" = "자산" + "에" → 이름 아님
 * 조사로 끝나기만 해서는 빼지 않는다. "김정의", "김지은"처럼 조사 글자로 끝나는 진짜 이름이 있어서다.
 * 목록에 없는 단어는 지금처럼 이름으로 보고 가린다. (놓치는 것보다 넓게 가리기)
 * @param {string} name
 */
function isWordWithParticle(name) {
  const particle = TRAILING_PARTICLE.exec(name);
  return particle !== null && NOT_NAMES.has(name.slice(0, particle.index));
}

/**
 * 영문 한 낱말 1-2글자는 이름으로 보지 않는다. (#165 실제 서류: 서명 그림 조각 "BD", "MD"가 라벨 뒤에 읽힘)
 * 외국인 이름은 "NGUYEN VAN A"처럼 여러 낱말이라 첫 낱말이 3글자 이상이다.
 * 이 글자들은 #145 다시 찾기로 문서 전체에서 가려져서, 보내기 전 검사(PART 4)를 멈추게 하기도 했다.
 */
const TOO_SHORT_LATIN = /^[A-Za-z]{1,2}$/;

/**
 * 이름 모양
 * - 한글 2-4자 (뒤에 한글이 더 붙어 있으면 이름이 아니다. 예: "임대인은")
 * - 영문 대문자로 시작하는 단어 1-4개 (예: NGUYEN VAN A)
 */
// 영문 단어 사이는 [ \t]만 허용한다. \s를 쓰면 줄바꿈을 넘어 다음 줄 단어(예: "Tel")까지 이름에 붙는다.
const NAME_PATTERN = '([가-힣]{2,4}(?![가-힣])|[A-Z][A-Za-z\'-]*(?:[ \\t]+[A-Z][A-Za-z\'-]*){0,3})';

/**
 * 등기부 공유자의 지분 표기: "지분 2분의 1", "지분 1/2". 라벨과 이름 사이에 온다.
 * 예: "공유자 지분 2분의 1 김철수" → 이름은 "김철수" ("지분"이 아니다)
 */
const SHARE = '지\\s*분\\s*(?:\\d+\\s*분\\s*의\\s*\\d+|\\d+\\s*/\\s*\\d+)';

/**
 * 민간임대주택 표준임대차계약서의 이름 칸: "성명(법인명)" (#165 실제 양식 서류)
 * 예: "임대사업자 성명(법인명) 김철수 (서명 또는 인)", "임차인 성명(법인명) 박지훈"
 */
const CORP_NAME_NOTE = '(?:\\s*[(（]\\s*법\\s*인\\s*명\\s*[)）])?';

/**
 * 라벨 하나에 대한 정규식을 만든다.
 * 라벨 → (성명) → (지분 표기) → (:) → 공백이나 콜론 1개 이상 → 이름
 * 라벨과 이름 사이에 구분(공백이나 :)이 꼭 있어야 한다. "임대인과", "임대인은"을 이름으로 잡지 않으려고.
 * @param {string} label
 */
function labelRegex(label) {
  return new RegExp(
    `${spaced(label)}(?:\\s*(?:${NAME_FIELD})${CORP_NAME_NOTE})?(?:\\s*${SHARE})?\\s*[:：]?[\\s:：]+${NAME_PATTERN}`,
    'g',
  );
}

/**
 * 괄호 안 이름: "임대인(김철수)과 임차인(NGUYEN VAN A)은" (계약서 첫 문장)
 * 닫는 괄호가 이름 바로 뒤에 와야 한다. "임대인(이하 갑)"은 이름이 아니다.
 * 역할은 붙이지 않는다(role: null). 서명란에 같은 사람이 번호와 함께 다시 나오므로,
 * 여기에 역할을 붙이면 위험 점검 화면에 같은 임대인이 두 번 보인다.
 * @param {string} label
 */
function parenRegex(label) {
  return new RegExp(`${spaced(label)}\\s*[(（]\\s*${NAME_PATTERN}\\s*[)）]`, 'g');
}

/**
 * 역할은 정하지 않고 이름만 찾는 라벨 (등기부 "채무자 김철수", "채권자 이가상", 계약금 "영수자 김철수")
 * 이 이름들은 위험 점검에 쓰지 않지만 개인정보라서 가린다. (role: null)
 */
const OTHER_LABELS = /** @type {string[]} */ (rules.otherPersonLabels);

/** @type {Array<{ role: string | null, regex: RegExp }>} */
const PERSON_RULES = [
  ...rules.persons.flatMap(({ role, labels }) =>
    labels.map((label) => ({ role, regex: labelRegex(label) })),
  ),
  ...rules.persons.flatMap(({ labels }) => labels.map((label) => ({ role: null, regex: parenRegex(label) }))),
  ...OTHER_LABELS.map((label) => ({ role: null, regex: labelRegex(label) })),
];

/**
 * 역할 라벨이 "항목 이름"으로 쓰인 자리. (뒤에 공백·콜론·줄 끝이 오는 경우)
 * "임대인 주소 …"처럼 이름이 바로 안 와도 역할이 시작됐다는 표시로 쓴다. "임대인과", "임대인은"은 제외.
 */
const ROLE_ANCHORS = rules.persons.flatMap(({ role, labels }) =>
  labels.map((label) => ({ role, regex: new RegExp(`(?<![가-힣])${spaced(label)}(?=[\\s:：]|$)`, 'g') })),
);

/**
 * 역할 라벨 없이 혼자 있는 "성명" 칸 뒤의 이름.
 * 표준계약서 서명란은 "임대인"이 표 왼쪽에 한 번 나오고, 이름은 다른 줄의 "성명" 칸에 있다.
 */
const STANDALONE_NAME_REGEX = new RegExp(
  `(?<![가-힣])(?:${rules.standaloneNameFields.map(spaced).join('|')})${CORP_NAME_NOTE}\\s*[:：]?[\\s:：]+${NAME_PATTERN}`,
  'g',
);

/**
 * 주민·외국인등록번호 바로 앞의 이름 (라벨 없음).
 * 등기부 공유자는 "공유자" 라벨이 윗줄에 있고, 이름은 아랫줄에 "이몽룡 790521-*******"처럼 번호와 함께 나온다. (#165)
 * - 한글 2-4자 + 공백 + 번호(생년월일 6자리 + 구분 기호 + 뒷자리 첫 글자). 앞에 한글·영문이 붙어 있으면 아니다.
 *   ("주식회사가상건설 110111-…"의 "가상건설"은 이름이 아니다)
 * - 라벨 단어("임대인 750315-…"), notNames("번호 …")는 이름이 아니다.
 * - 역할은 "성명" 칸처럼 위쪽에서 가장 최근에 나온 역할 라벨을 이어받는다. ("공유자" → OWNER)
 */
const NAME_BEFORE_ID_REGEX = /(?<![가-힣A-Za-z])([가-힣]{2,4})[ \t]+(?=\d{6}\s?[-./]\s?[1-8*])/g;
/** 이름이 아닌 라벨 단어 (역할 라벨, 이름만 찾는 라벨, "성명" 같은 칸 이름) */
const LABEL_WORDS = new Set([
  ...rules.persons.flatMap((p) => p.labels),
  ...OTHER_LABELS,
  ...rules.nameFieldWords,
  ...rules.standaloneNameFields,
]);

/**
 * 글 안의 역할 라벨 위치를 앞에서부터 모은다.
 * @param {string} text
 * @returns {{ role: string, index: number }[]}
 */
function findRoleAnchors(text) {
  const anchors = [];
  for (const { role, regex } of ROLE_ANCHORS) {
    for (const match of text.matchAll(regex)) anchors.push({ role, index: match.index });
  }
  return anchors.sort((a, b) => a.index - b.index);
}

/**
 * 글에서 마지막으로 나온 역할. 없으면 이어받은 역할을 그대로 돌려준다.
 * 문서를 블록 단위로 훑을 때, 다음 블록에 넘겨줄 역할을 구하는 데 쓴다.
 * @param {string} text
 * @param {string | null} [inheritedRole] 앞 블록에서 이어받은 역할
 * @returns {string | null}
 */
export function lastRoleIn(text, inheritedRole = null) {
  const anchors = findRoleAnchors(text);
  return anchors.length ? anchors[anchors.length - 1].role : inheritedRole;
}

/**
 * 라벨 뒤의 이름을 찾는다.
 * - "임대인 김철수"처럼 역할 라벨 바로 뒤 이름은 그 역할
 * - "성명 김철수"처럼 혼자 있는 성명 칸은 위쪽에서 가장 최근에 나온 역할을 이어받는다.
 *   위쪽에 역할이 없으면 role은 null이다. (역할은 몰라도 이름은 가려야 하므로 일단 찾는다)
 * @param {string} text
 * @param {string | null} [inheritedRole] 앞 블록에서 이어받은 역할
 * @returns {{type: string, value: string, start: number, end: number, role: string | null}[]}
 */
export function findLabeledNames(text, inheritedRole = null) {
  /** @type {Map<number, {type: string, value: string, start: number, end: number, role: string | null}>} */
  const byStart = new Map();
  /**
   * @param {RegExpMatchArray} match
   * @param {(start: number) => string | null} roleAt
   */
  const add = (match, roleAt) => {
    const name = match[1].trim();
    if (NOT_NAMES.has(name) || isWordWithParticle(name) || TOO_SHORT_LATIN.test(name)) return;
    const start = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
    // 같은 이름을 두 규칙이 모두 찾으면("임대인 성명: 이영희") 역할 라벨 쪽을 남긴다.
    if (byStart.has(start)) return;
    byStart.set(start, { type: PII_TYPE.PERSON_NAME, value: name, start, end: start + name.length, role: roleAt(start) });
  };

  for (const { role, regex } of PERSON_RULES) {
    for (const match of text.matchAll(regex)) add(match, () => role);
  }

  const anchors = findRoleAnchors(text);
  /** @param {number} start */
  const roleBefore = (start) => {
    const before = anchors.filter((a) => a.index < start);
    return before.length ? before[before.length - 1].role : inheritedRole;
  };
  for (const match of text.matchAll(STANDALONE_NAME_REGEX)) add(match, roleBefore);
  for (const match of text.matchAll(NAME_BEFORE_ID_REGEX)) {
    // 법인등록번호 앞의 낱말은 회사 이름이라 사람 이름이 아니다 ("주식회사 가상건설 110111-…", #192)
    const idStart = (match.index ?? 0) + match[0].length;
    if (!LABEL_WORDS.has(match[1]) && !isCorporateNumber(text, idStart)) add(match, roleBefore);
  }

  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * 이미 찾은 이름이 라벨 없이 또 나오는 곳을 찾는다. (예: 위에서 "소유자 김철수"를 찾았으면 "채무자 … 김철수"도 가린다)
 * - 한글 3-4자 이름은 앞에 한글이 붙어 있지 않으면 찾는다. 뒤에는 조사가 붙을 수 있다. ("김철수는")
 * - 한글 2자 이름은 일상 단어와 겹치기 쉬워서 앞뒤 모두 한글이 붙어 있지 않을 때만 찾는다.
 * - 영문 이름은 앞뒤에 영문이 붙어 있지 않을 때만 찾는다. 대소문자는 그대로 비교한다.
 * @param {string} text
 * @param {Iterable<string>} names 이미 찾은 이름
 * @returns {{ type: string, value: string, start: number, end: number, role: null }[]}
 */
export function findKnownNames(text, names) {
  const results = [];
  for (const name of new Set(names)) {
    const hangul = /^[가-힣]+$/.test(name);
    if (hangul && name.length < 2) continue;
    const pattern = hangul
      ? `(?<![가-힣])${escapeRegex(name)}${name.length === 2 ? '(?![가-힣])' : ''}`
      : `(?<![A-Za-z])${escapeRegex(name)}(?![A-Za-z])`;
    for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
      const start = m.index ?? 0;
      results.push({ type: PII_TYPE.PERSON_NAME, value: name, start, end: start + name.length, role: null });
    }
  }
  return results.sort((a, b) => a.start - b.start);
}

/**
 * 이미 찾은 주소 조각이 같은 서류의 다른 곳에 또 나오는 자리를 찾는다.
 * 예: 표제부에서 찾은 지번 "39-30"이 대지권 칸 둘째 줄에 혼자 또 나옴 (그 줄만 보면 주소인지 알 수 없음)
 * 보내기 전 검사(PART 4)는 찾은 값이 어디에든 글자 그대로 보이면 멈추므로, 같은 기준(글자 그대로)으로 찾는다.
 * 긴 조각부터 찾아서, 짧은 조각이 긴 조각 안에서 따로 잡히지 않게 한다.
 * 숫자로 시작하거나 끝나는 조각은 다른 숫자 안에서 찾지 않는다. (보내기 전 검사 #216과 같은 경계, #206)
 *   "740" → "제1740호", "17400000", "246-740" 안에서는 찾지 않는다.
 *   쉼표로 이어진 숫자는 금액·면적일 때만 건너뛴다. ("금740,000,000원", "740,000원", "1,740㎡")
 *   "가상동 740,741"처럼 쉼표로 붙여 쓴 지번은 금액과 모양이 같아서 검사도 건너뛴다.
 *   그래서 금액이라는 표시가 없으면 가린다. (더 가리는 것은 검사를 멈추게 하지 않는다)
 * @param {string} text
 * @param {string[]} values
 */
export function findKnownAddresses(text, values) {
  /** @type {{ type: string, value: string, start: number, end: number }[]} */
  const results = [];
  const sorted = [...new Set(values)].filter((v) => v.trim().length >= 2).sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    const startsWithDigit = /^\d/.test(value);
    const endsWithDigit = /\d$/.test(value);
    for (let start = text.indexOf(value); start !== -1; start = text.indexOf(value, start + 1)) {
      const end = start + value.length;
      if (startsWithDigit && isInsideOtherNumber(text, start, end, start - 1, -1)) continue;
      if (endsWithDigit && isInsideOtherNumber(text, start, end, end, 1)) continue;
      if (results.some((r) => start < r.end && r.start < end)) continue;
      results.push({ type: PII_TYPE.ADDRESS, value, start, end });
    }
  }
  return results.sort((a, b) => a.start - b.start);
}

/** 금액·면적 앞 표시: "금", "₩", "￦", "\" (원화 기호 대신 쓰는 경우) */
const MONEY_BEFORE = /(?:금|₩|￦|\\)\s*$/;
/** 금액·면적 뒤 표시: "원", "㎡", "m²" (소수점이 붙어도 된다: "1,740.5㎡") */
const MONEY_OR_AREA_AFTER = /^(?:\.\d+)?\s*(?:원|㎡|m²)/;

/**
 * findKnownAddresses에서 찾은 조각이 다른 숫자의 일부인지 본다.
 *  - 바깥 글자가 숫자이면 같은 숫자다. ("1740")
 *  - 하이픈 너머에 숫자가 이어지면 같은 번호다. ("246-89", "1-740")
 *  - 쉼표 너머에 숫자가 이어지면, 이어진 숫자 전체가 금액·면적 모양일 때만 같은 숫자로 본다.
 *    금액·면적 모양 = 앞에 금·₩ 또는 뒤에 원·㎡가 있거나, "740,000,000"처럼 세 자리 묶음이 두 번 이상 이어진다.
 * @param {string} text
 * @param {number} start  조각 시작
 * @param {number} end  조각 끝
 * @param {number} at  조각 바로 바깥 글자의 위치
 * @param {-1 | 1} step  앞쪽이면 -1, 뒤쪽이면 1
 */
function isInsideOtherNumber(text, start, end, at, step) {
  const c = text[at] ?? '';
  if (/[0-9]/.test(c)) return true;
  if (!/[0-9]/.test(text[at + step] ?? '')) return false;
  if (c === '-') return true;
  if (c !== ',') return false;
  // 조각을 포함해 숫자·쉼표로 이어진 부분 전체
  let from = start;
  while (from > 0 && /[0-9,]/.test(text[from - 1])) from--;
  let to = end;
  while (to < text.length && /[0-9,]/.test(text[to])) to++;
  const run = text.slice(from, to);
  return (
    MONEY_BEFORE.test(text.slice(0, from)) ||
    MONEY_OR_AREA_AFTER.test(text.slice(to)) ||
    /^\d{1,3}(?:,\d{3}){2,}$/.test(run)
  );
}

/**
 * 주소 찾기: 시·도 이름 + 공백 + 시·군·구로 시작하는 부분부터 줄 끝(또는 괄호 앞)까지.
 * 예: "소재지 서울특별시 중구 필동로 00, 101호" → "서울특별시 중구 필동로 00, 101호"
 * 등기부처럼 라벨 없이 주소만 있는 줄도 찾는다.
 * "서울 중구"처럼 줄여 쓴 시·도 이름도 찾는다. 약칭("경기", "강원")은 일상 단어와 겹치므로
 * 시·도 이름 앞과 시·군·구 뒤에 한글이 붙어 있으면 주소로 보지 않는다. (예: "경기 도구를", "남서울")
 * 단, 시·군·구 바로 뒤에 조사(에서·에·의·로 등)가 붙은 경우는 조사 앞까지만 주소로 본다.
 * 예: "서울 강남구에서 계약한다" → "서울 강남구" (조사부터는 주소가 아니므로 값에 넣지 않는다)
 * 경기·대구·세종은 일상 단어와 겹치므로("경기 지시에", "대구 지시에") 조사가 붙은 경우를 주소로 보지 않는다.
 * 시·군·구처럼 끝나는 일상 단어("서울 친구", "부산 가구를")는 주소로 보지 않는다. (person-labels.json의 notSigunguWords)
 * "서울특별시", "경기도"처럼 시·도로 끝나는 이름은 시·군·구가 붙어 있어도 찾는다. (OCR의 "서울특별시중구")
 * 줄임말("서울", "경기")은 붙여 쓰면 일상 문장과 헷갈려서 띄어 쓴 경우만 찾는다.
 */
const PARTICLE = '(?:에서|에|의|으로|로|은|는|이|가|을|를|도|와|과)(?:은|는|도|만)?';
/** 일상 단어 하나 전체(뒤에 조사만 붙을 수 있음)면 시·군·구로 보지 않는다. "도구시"처럼 더 긴 단어는 막지 않는다. */
const NOT_SIGUNGU_GUARD = `(?!(?:${rules.notSigunguWords.map(escapeRegex).join('|')})(?:${PARTICLE})?(?![가-힣]))`;
const SIGUNGU_WORD = `${NOT_SIGUNGU_GUARD}[가-힣]+(?:시|군|구)`;
/** 시·도로 끝나는 이름 ("서울특별시", "서울시", "경기도"): 시·군·구와 붙어 있어도 된다. */
const FULL_REGIONS = rules.addressRegions.filter((r) => /[시도]$/.test(r));
/** 시·도 이름 + 공백. 시·도로 끝나는 이름은 공백이 없어도 된다. @param {string[]} regions */
const regionThenSpace = (regions) =>
  `(?:(?:${regions.map(escapeRegex).join('|')})\\s+|(?:${regions
    .filter((r) => FULL_REGIONS.includes(r))
    .map(escapeRegex)
    .join('|')})\\s*)`;
const REGION_ANY = regionThenSpace(rules.addressRegions);
const REGION_WITH_PARTICLE = regionThenSpace(
  rules.addressRegions.filter((r) => !rules.regionsWithoutParticle.includes(r)),
);
const ADDRESS_REGEX = new RegExp(
  `(?<![가-힣])(?:${REGION_ANY}${SIGUNGU_WORD}(?![가-힣])(?:[^\\n(]*[^\\s\\n(])?` +
    `|${REGION_WITH_PARTICLE}${SIGUNGU_WORD}(?=${PARTICLE}(?![가-힣])))`,
  'g',
);

/**
 * 주소 뒤에 붙어 읽힌 표 옆 칸의 시작 (#151)
 * 주소는 줄 끝까지 잡으므로, 좁은 표에서는 옆 칸 글자가 주소에 붙는다.
 * 예: "서울특별시 중구 가상동 123 대 5321.4㎡ 2015년3월2일 등기", "… 가상로 20, 1층 사무소명칭 가상공인중개사사무소"
 * 띄어쓰기 뒤에 면적(㎡), 날짜, 항목 이름(person-labels.json의 addressStopWords)이 오면 그 앞에서 끊는다.
 * 가림 상자는 블록 전체라서, 주소 값이 짧아져도 PDF에서 가리는 범위는 그대로다.
 * 다만 AI에게 보내는 글은 주소 값만 바꾸므로, 끊긴 뒷부분은 그대로 남는다.
 * 그래서 짧은 항목 이름(3글자 이하: "대표", "등기", "구조")은 낱말 전체가 같을 때만 끊는다.
 * ("필동로 00, 대표빌딩 101호"처럼 건물 이름으로 시작하는 진짜 주소를 끊어서 호수를 남기지 않게. #152 정연님 리뷰)
 */
const MIN_PREFIX_STOP_WORD = 4;
/**
 * 층과 면적이 붙은 층별 면적: "2층138.48㎡", "옥탑1층19.89㎡" (등기부 표제부 건물내역 칸, 실제 서류로 확인)
 * 도로명주소 줄 옆에 붙어 읽힌다: "[도로명주소] 1층 19.65㎡" / "서울특별시 중구 가상로1길 2층138.48㎡" / "15 3층 138.6㎡"
 * 띄어 쓴 "가상로 1층 410.52㎡"는 지금처럼 면적 앞에서만 끊는다. ("1층"은 주소의 층일 수 있다)
 */
const FLOOR_AREA = '(?:지하|지상|옥탑)?\\d+층\\d[\\d,.]*\\s*(?:㎡|m²|m2)';
/** @param {string} word */
const stopWord = (word) =>
  word.length >= MIN_PREFIX_STOP_WORD ? spaced(word) : `${spaced(word)}(?=[\\s:：]|$)`;
const ADDRESS_STOP = new RegExp(
  '\\s(?:' +
    [
      '\\d[\\d,.]*\\s*(?:㎡|m²|m2)', // 면적
      FLOOR_AREA, // 층별 면적 "2층138.48㎡" (등기부 표제부 건물내역 칸)
      '\\d{4}\\s*년', // 날짜 "2015년3월2일"
      '\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}', // 날짜 "2015.03.02"
      ...rules.addressStopWords.map(stopWord), // 항목 이름
    ].join('|') +
    ')',
);

/**
 * 주소 값에서 표 옆 칸 글자를 잘라낸다. 끝의 쉼표·공백도 지운다.
 * @param {string} value
 */
function cutAtTableCell(value) {
  const stop = ADDRESS_STOP.exec(value);
  return stop ? value.slice(0, stop.index).replace(/[\s,]+$/, '') : value;
}

/** 동·층·호 한 덩어리: "101동", "제2층", "1001호" */
const DONG_HO = '제?[ \\t]*[0-9A-Za-z]+(?:-[0-9]+)?[ \\t]*(?:동|층|호)(?![가-힣])';

/**
 * 주소 바로 뒤의 괄호와 그 뒤 동·호수 (#165 실제 서류 점검)
 * 예: "가상로 00, 3층 (가상동, 가상타운) 301호", "61,107동602호(가상동,가상아파트)", 줄 끝에서 안 닫힌 "304호(가"
 * 끊긴 뒷부분은 AI에게 보내는 글에 그대로 남으므로, 괄호 안(동 이름·아파트 이름)과 뒤 호수까지 주소로 본다.
 * 괄호 뒤에는 동·층·호만 이어 붙인다. (전화번호 등 다른 칸까지 주소로 잡지 않게)
 */
const PAREN_TAIL = new RegExp(`^[ \\t]*\\([^)\\n]*(?:\\)|(?=\\n|$))(?:[ \\t]*${DONG_HO})*`);

/**
 * 주소 끝(end) 뒤에 괄호 부분이 있으면 그 끝까지 늘린다.
 * @param {string} text
 * @param {number} end
 */
function withParenTail(text, end) {
  let e = end;
  for (let i = 0; i < 3; i += 1) {
    const m = PAREN_TAIL.exec(text.slice(e));
    if (!m || m[0].length === 0) break;
    e += m[0].length;
  }
  return e;
}

/** 주소가 줄 끝에서 괄호를 열고 닫지 않았는지 ("… 304호(가" → 아랫줄 "상동,가상빌라)"로 이어짐) */
export const hasOpenParen = (/** @type {string} */ value) => /\([^)]*$/.test(value);

/**
 * @param {string} text
 * @returns {{type: string, value: string, start: number, end: number}[]}
 */
export function findAddresses(text) {
  const results = [];
  for (const match of text.matchAll(ADDRESS_REGEX)) {
    const start = match.index ?? 0;
    const cut = cutAtTableCell(match[0]);
    // 표 옆 칸에서 끊었으면 괄호를 붙이지 않는다. (옆 칸 글자의 괄호일 수 있다)
    const end = cut === match[0] ? withParenTail(text, start + cut.length) : start + cut.length;
    const value = text.slice(start, end).trimEnd();
    // 등기부 표의 건물내역 칸(철근콘크리트구조·면적·날짜 등)에서 끊긴 주소: 아랫줄이 소재지 칸의 뒷부분일 수 있다
    const tableCut = cut !== match[0] && BUILDING_COLUMN_STOP.test(match[0].slice(cut.length));
    results.push({ type: PII_TYPE.ADDRESS, value, start, end: start + value.length, ...(tableCut ? { tableCut } : {}) });
  }
  return results;
}

/*
 * 두 줄 주소 (줄이 바뀌거나 블록이 나뉜 주소)
 * 윗줄 주소가 줄 끝까지 왔을 때, 아랫줄 맨 앞이 주소의 뒷부분처럼 생겼으면 이어진 주소로 본다.
 * - 동·층·호: "101동 1001호", "제2층 제201호"
 * - 도로명: "필동로 00", "필동로12길 3"
 * - 시·군·구: 윗줄이 "서울특별시"처럼 시·도 이름으로 끝났을 때만 ("중구 필동로 00")
 * - 건물번호 + 동·호: "61,107동602호", "31, 502호" (윗줄이 "가상대로"나 "가상대로 1"에서 끊긴 경우, #165)
 *   표 칸이 섞여 줄 앞에 다른 칸 글자가 있어도("경 제57913호 전거 61,107동602호") 이 모양은 줄 안에서 찾는다.
 * - 윗줄이 괄호를 열고 끝났으면("304호(가") 아랫줄의 닫는 괄호까지 ("상동,가상빌라)")
 * 모두 뒤의 괄호(동 이름·아파트 이름)까지 포함한다.
 */
const ADDRESS_TAIL = '(?:[^\\n(]*[^\\s\\n(])?';
const ROAD = '[가-힣0-9]+(?:로|길)[ \\t]*\\d';
const SIGUNGU = `${NOT_SIGUNGU_GUARD}[가-힣]+(?:시|군|구)(?![가-힣])`;
/** 건물번호 + 쉼표 + 동·호: "61,107동602호", "31, 502호" */
const BUILDING_THEN_UNIT = `\\d+(?:-\\d+)?[ \\t]*,[ \\t]*${DONG_HO}`;
const CONTINUATION_REGEX = new RegExp(`^[ \\t]*((?:${BUILDING_THEN_UNIT}|${DONG_HO}|${ROAD})${ADDRESS_TAIL})`);
const CONTINUATION_AFTER_REGION_REGEX = new RegExp(`^[ \\t]*(${SIGUNGU}${ADDRESS_TAIL})`);
/** 줄 중간의 "건물번호, 동·호" (앞에 숫자·쉼표가 붙어 있으면 아니다) */
const BUILDING_THEN_UNIT_INSIDE = new RegExp(`(?<![\\d,])(${BUILDING_THEN_UNIT}${ADDRESS_TAIL})`);
/** 윗줄에서 열린 괄호의 나머지: "상동,가상빌라)" + 뒤 동·호 */
const PAREN_REST_REGEX = new RegExp(`^[ \\t]*([^)\\n]*\\)(?:[ \\t]*${DONG_HO})*)`);
const TRAILING_REGION_REGEX = new RegExp(
  `(?<![가-힣])(${rules.addressRegions.map(escapeRegex).join('|')})[ \\t,]*$`,
);
/** 주소 뒤에 이것만 남아 있으면 "줄 끝까지 온 주소"로 본다. (쉼표, 공백, 괄호 하나) */
const ADDRESS_LINE_REST = /^[\s,]*(?:\([^)]*\))?[\s,]*$/;

/**
 * 아랫줄 맨 앞의 주소 뒷부분을 찾는다.
 * @param {string} line 한 줄 (줄바꿈 없음)
 * @param {boolean} [afterRegion] 윗줄이 시·도 이름으로 끝났는지
 * @param {boolean} [openParen] 윗줄 주소가 괄호를 열고 끝났는지
 * @returns {{ type: string, value: string, start: number, end: number } | null}
 */
export function findAddressContinuation(line, afterRegion = false, openParen = false) {
  if (openParen) {
    const p = line.match(PAREN_REST_REGEX);
    if (p) {
      const start = (p.index ?? 0) + p[0].length - p[1].length;
      return { type: PII_TYPE.ADDRESS, value: p[1], start, end: start + p[1].length };
    }
  }
  const m =
    line.match(afterRegion ? CONTINUATION_AFTER_REGION_REGEX : CONTINUATION_REGEX) ??
    (afterRegion ? null : line.match(BUILDING_THEN_UNIT_INSIDE));
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length - m[1].length;
  const cut = cutAtTableCell(m[1]);
  const end = cut === m[1] ? withParenTail(line, start + cut.length) : start + cut.length;
  const value = line.slice(start, end).trimEnd();
  return { type: PII_TYPE.ADDRESS, value, start, end: start + value.length };
}

/**
 * 줄 끝에 시·도 이름만 있는지 찾는다. (예: "소재지 서울특별시" → "서울특별시")
 * 아랫줄이 시·군·구로 시작할 때만 주소 조각으로 쓴다.
 * @param {string} line 한 줄 (줄바꿈 없음)
 * @returns {{ type: string, value: string, start: number, end: number } | null}
 */
export function findTrailingRegion(line) {
  const m = line.match(TRAILING_REGION_REGEX);
  if (!m) return null;
  const start = m.index ?? 0;
  return { type: PII_TYPE.ADDRESS, value: m[1], start, end: start + m[1].length };
}

/** 주소답게 끝나는 모양: 숫자, 쉼표, 동·층·호·로·길·시·군·구 (예: "필동로 00,", "서울특별시 중구") */
const ADDRESS_LIKE_END = /(?:\d|,|[동층호로길시군구])$/;

/**
 * 주소가 아랫줄과 이어질 수 있는지.
 * - 주소 뒤에 쉼표·공백·괄호 하나만 남아 있어야 한다. (줄 끝까지 온 주소)
 * - 주소가 주소답게 끝나야 한다. "서울특별시 중구 필동로 00 소재 주택을 임대한다"처럼
 *   문장이 붙어 줄 끝까지 잡힌 경우는 잇지 않는다.
 * @param {string} value 주소 조각
 * @param {string} rest 주소 끝부터 줄 끝까지의 글자
 */
export function reachesLineEnd(value, rest) {
  return reachesLineEndCore(value, rest);
}

/*
 * 표 칸이 섞인 두 줄 주소 (#196, 실제 등기부 표제부)
 * 등기부 표제부는 소재지 칸이 좁아 주소가 여러 줄로 나뉘고, 같은 높이의 건물내역 칸 글자와 한 줄로 섞인다.
 *   "1 2023년12월4일 서울특별시 성동구 가상동 246-8 철근콘크리트구조 …" / "가상타운 (철근)콘크리트지붕"
 *   "[도로명주소] 서울특별시 성동구 22층 공동주택(아파트) 및" / "가상로 00 근린생활시설"
 *   "… 서울특별시 ○○구 ○○동 철근콘크리트구조" / "123 (철근)콘크리트지붕 ○층"
 * 윗줄 주소가 줄 끝까지 오지 않았어도(옆 칸 글자가 붙음) 아랫줄 맨 앞이 주소 모양이면 그 부분만 잇는다.
 * 1) 도로명 + 번호 ("가상로 00")
 * 2) 윗줄이 동·가·리·로·길로 끝났으면 번지·건물번호 숫자 ("123", "246-8")
 * 3) 윗줄이 건물내역 칸에서 끊겼고(tableCut) 번지로 끝났으면 첫 낱말을 건물 이름으로 ("가상타운")
 *    표 밖(계약서 등)에서는 쓰지 않는다. 칸 이름("주민등록번호")을 주소로 잘못 가리지 않게.
 */
/** 등기부 건물내역 칸의 시작 (이 앞에서 끊긴 주소는 표 안의 주소다) */
const BUILDING_COLUMN_STOP = new RegExp(
  '\\s(?:철\\s*근\\s*콘\\s*크\\s*리\\s*트|\\(?\\s*철\\s*근\\s*\\)|[가-힣]*구\\s*조|\\d[\\d,.]*\\s*(?:㎡|m²|m2)|' +
    `${FLOOR_AREA}|\\d{4}\\s*년|도\\s*면\\s*편\\s*철\\s*장|지\\s*목|대(?=\\s+\\d))`,
);
const MIXED_ROAD = /^[ \t]*([가-힣0-9]+(?:로|길)[ \t]*\d+(?:-\d+)?)(?![\d가-힣])/;
const MIXED_LOT_NUMBER = /^[ \t]*(\d{1,5}(?:-\d{1,5})?)(?![\d.,/]|\s*(?:층|호|동|㎡|년|분의))/;
const MIXED_BUILDING_NAME = /^[ \t]*((?![제(\[【])[가-힣A-Za-z][가-힣A-Za-z0-9]{1,19})(?=\s|$)/;
/** 건물 이름으로 보지 않는 첫 낱말 (표 칸 글자) */
const NOT_BUILDING_NAME = /^(?:지하|지상|옥탑|철근|콘크리트|표시번호|열람|고유번호|등기|도면편철장|소유권|대지권|갑구|을구|표제부)/;

/**
 * 도로명(…로·…길) 뒤 다음 줄의 짧은 건물번호("15")는 잇지 않는다.
 * 짧은 숫자를 주소로 잡으면 보내기 전 검사(PART 4)가 다른 서류의 "제15조", "15일"까지 새어 나간 주소로 보고 멈춘다.
 * 도로 이름은 가려지므로 숫자만 남아도 집을 알 수 없다. (하이픈이 있거나 4자리 이상이면 잇는다)
 * 지번(…동·…가·…리 뒤 "123")은 지금처럼 잇는다.
 * @param {string} core 윗줄 주소 조각
 * @param {RegExpExecArray | null} m
 */
function shortRoadNumberOk(core, m) {
  if (m && /[로길]$/.test(core) && /^\d{1,3}$/.test(m[1])) return null;
  return m;
}

/**
 * 칸이 섞여 줄 끝까지 오지 않은 주소 다음 줄에서 이어지는 조각을 찾는다. (위 설명)
 * @param {string} line 한 줄
 * @param {string} prevValue 윗줄 주소 조각
 * @param {boolean} tableCut 윗줄 주소가 등기부 건물내역 칸에서 끊겼는지
 * @returns {{ type: string, value: string, start: number, end: number } | null}
 */
export function findMixedContinuation(line, prevValue, tableCut) {
  const core = prevValue.trim().replace(/\s*\([^)]*\)?$/, '');
  const m =
    MIXED_ROAD.exec(line) ??
    (/[동가리로길]$/.test(core) ? shortRoadNumberOk(core, MIXED_LOT_NUMBER.exec(line)) : null) ??
    (tableCut && /\d$/.test(core) ? MIXED_BUILDING_NAME.exec(line) : null);
  if (!m || NOT_BUILDING_NAME.test(m[1]) || NOT_NAMES.has(m[1])) return null;
  const start = (m.index ?? 0) + m[0].length - m[1].length;
  return { type: PII_TYPE.ADDRESS, value: m[1], start, end: start + m[1].length };
}

/**
 * @param {string} value
 * @param {string} rest
 */
function reachesLineEndCore(value, rest) {
  // 끝의 괄호("(가상동,가상아파트)", 안 닫힌 "(가")는 빼고 주소답게 끝나는지 본다.
  const core = value.trim().replace(/\s*\([^)]*\)?$/, '');
  return ADDRESS_LINE_REST.test(rest) && ADDRESS_LIKE_END.test(core);
}

/** 이름 바로 앞의 "성명" 칸 라벨 (표준계약서 서명란: "주민등록번호 … 전화 … 성명 김철수") */
const NAME_FIELD_BEFORE = new RegExp(
  `(?:${rules.standaloneNameFields.map(spaced).join('|')})${CORP_NAME_NOTE}\\s*[:：]?\\s*$`,
);

/** "성명(법인명)"처럼 이름 칸 이름만 있는 블록 (이름은 다음 블록에 있다) */
const NAME_FIELD_ONLY = new RegExp(
  `^\\s*(?:${rules.standaloneNameFields.map(spaced).join('|')})${CORP_NAME_NOTE}\\s*[:：]?\\s*$`,
);

/**
 * 이름이 "성명" 칸 바로 뒤에 있는지 (같은 블록 안에서)
 * @param {string} text
 * @param {number} start 이름 시작 위치
 */
export function followsNameField(text, start) {
  return NAME_FIELD_BEFORE.test(text.slice(0, start));
}

/**
 * 글 안의 역할 라벨 위치 (앞에서부터). "임대인 주소"처럼 이름 없이 나온 역할 칸도 포함한다.
 * @param {string} text
 */
export function roleAnchorsIn(text) {
  return findRoleAnchors(text);
}

/**
 * 윗 블록이 "성명(법인명)"뿐이면, 이 블록 맨 앞의 이름을 찾는다. (#205)
 * 민간임대 표준계약서를 PDF로 읽으면 칸 이름과 이름이 다른 블록으로 나온다.
 *   "성명(법인명)" / "김철수 (서명 또는 인)"
 * 이름을 거르는 규칙(notNames 등)과 같은 줄 생년월일 읽기는 findPeople과 같다.
 * @param {string} prevText 윗 블록 글
 * @param {string} text 이 블록 글
 * @param {string | null} [inheritedRole]
 */
export function findNameAfterFieldBlock(prevText, text, inheritedRole = null) {
  if (!NAME_FIELD_ONLY.test(prevText ?? '')) return [];
  const label = prevText.trim();
  const offset = label.length + 1;
  const lead = text.length - text.trimStart().length;
  return findPeople(`${label} ${text}`, inheritedRole)
    .filter((p) => p.start - offset === lead)
    .map((p) => ({ ...p, start: p.start - offset, end: p.end - offset }));
}

/**
 * 주민·외국인등록번호의 앞 6자리 (6자리가 아니면 null)
 * @param {{ value: string }} id
 */
const birthDateOf = (id) => {
  const digits = id.value.replace(/\D/g, '').slice(0, 6);
  return digits.length === 6 ? digits : null;
};

/**
 * 사람 정보(이름 + 역할 + 생년월일)를 찾는다. extractFields()가 쓸 재료다.
 * 생년월일은 같은 줄에서 이름 뒤에 처음 나오는 주민·외국인등록번호의 앞 6자리다.
 * 찾는 범위는 줄 끝 또는 다음 사람의 이름 중 먼저 오는 곳까지다.
 * (다른 사람의 번호를 가져오면 계좌주 확인이 "확인 불가" 대신 "같은 사람"으로 잘못 나올 수 있다.)
 * 이름 뒤에 번호가 없고 이름이 "성명" 칸에 있으면, 같은 줄 이름 앞의 번호를 쓴다.
 * (표준계약서 서명란은 "주민등록번호 750315-1… 전화 … 성명 김철수" 순서다)
 * 이때도 앞사람 이름보다 뒤에 있고, 다른 사람이 이미 쓴 번호가 아니어야 한다.
 * 번호가 없으면 birthDate는 null이다. (못 읽음 = null 규칙)
 * @param {string} text
 * @param {string | null} [inheritedRole] 앞 블록에서 이어받은 역할 ("성명" 칸 이름에 붙인다)
 */
export function findPeople(text, inheritedRole = null) {
  // 생년월일은 사람 번호(주민·외국인등록번호)에서만 읽는다. 법인등록번호(REGISTRY_ID)는 쓰지 않는다. (#192)
  const ids = findIdNumbers(text).filter((i) => i.type !== PII_TYPE.REGISTRY_ID);
  const people = findLabeledNames(text, inheritedRole);
  const after = people.map((person, idx) => {
    const lineEnd = text.indexOf('\n', person.end);
    const next = people[idx + 1];
    const limit = Math.min(lineEnd === -1 ? text.length : lineEnd, next ? next.start : text.length);
    return ids.find((i) => i.start >= person.end && i.start < limit);
  });
  const used = new Set(after.filter(Boolean));
  return people.map((person, idx) => {
    let id = after[idx];
    if (!id && NAME_FIELD_BEFORE.test(text.slice(0, person.start))) {
      const lineStart = text.lastIndexOf('\n', person.start - 1) + 1;
      const from = Math.max(lineStart, idx > 0 ? people[idx - 1].end : 0);
      id = ids.filter((i) => i.start >= from && i.end <= person.start && !used.has(i)).pop();
      if (id) used.add(id);
    }
    return { ...person, birthDate: id ? birthDateOf(id) : null };
  });
}
