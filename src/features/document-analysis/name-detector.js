// @ts-check
/**
 * PART 2. 이름·주소 탐지 (라벨 기반)
 * 정규식만으로는 이름을 알 수 없어서, "임대인", "예금주" 같은 라벨 바로 뒤에 오는 글자를 이름으로 본다.
 * 라벨과 역할 목록은 src/config/templates/person-labels.json에 있다. (코드 수정 없이 파일만 고쳐서 추가)
 * 결과의 start/end는 pii-patterns.js와 같이 "몇 번째 글자부터 몇 번째 글자까지"이다.
 */
import { PII_TYPE } from '../../shared/document-model.js';
import { findIdNumbers } from './pii-patterns.js';
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

/**
 * 이름 모양
 * - 한글 2-4자 (뒤에 한글이 더 붙어 있으면 이름이 아니다. 예: "임대인은")
 * - 영문 대문자로 시작하는 단어 1-4개 (예: NGUYEN VAN A)
 */
// 영문 단어 사이는 [ \t]만 허용한다. \s를 쓰면 줄바꿈을 넘어 다음 줄 단어(예: "Tel")까지 이름에 붙는다.
const NAME_PATTERN = '([가-힣]{2,4}(?![가-힣])|[A-Z][A-Za-z\'-]*(?:[ \\t]+[A-Z][A-Za-z\'-]*){0,3})';

/**
 * 라벨 하나에 대한 정규식을 만든다.
 * 라벨 → (성명) → (:) → 공백이나 콜론 1개 이상 → 이름
 * 라벨과 이름 사이에 구분(공백이나 :)이 꼭 있어야 한다. "임대인과", "임대인은"을 이름으로 잡지 않으려고.
 * @param {string} label
 */
function labelRegex(label) {
  return new RegExp(
    `${spaced(label)}(?:\\s*(?:${NAME_FIELD}))?\\s*[:：]?[\\s:：]+${NAME_PATTERN}`,
    'g',
  );
}

const PERSON_RULES = rules.persons.flatMap(({ role, labels }) =>
  labels.map((label) => ({ role, regex: labelRegex(label) })),
);

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
  `(?<![가-힣])(?:${rules.standaloneNameFields.map(spaced).join('|')})\\s*[:：]?[\\s:：]+${NAME_PATTERN}`,
  'g',
);

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
    if (NOT_NAMES.has(name)) return;
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

  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * 주소 찾기: 시·도 이름 + 공백 + 시·군·구로 시작하는 부분부터 줄 끝(또는 괄호 앞)까지.
 * 예: "소재지 서울특별시 중구 필동로 00, 101호" → "서울특별시 중구 필동로 00, 101호"
 * 등기부처럼 라벨 없이 주소만 있는 줄도 찾는다.
 * "서울 중구"처럼 줄여 쓴 시·도 이름도 찾는다. 약칭("경기", "강원")은 일상 단어와 겹치므로
 * 시·도 이름 앞과 시·군·구 뒤에 한글이 붙어 있으면 주소로 보지 않는다. (예: "경기 도구를", "남서울")
 */
const ADDRESS_REGEX = new RegExp(
  `(?<![가-힣])(?:${rules.addressRegions.map(escapeRegex).join('|')})\\s+[가-힣]+(?:시|군|구)(?![가-힣])(?:[^\\n(]*[^\\s\\n(])?`,
  'g',
);

/**
 * @param {string} text
 * @returns {{type: string, value: string, start: number, end: number}[]}
 */
export function findAddresses(text) {
  const results = [];
  for (const match of text.matchAll(ADDRESS_REGEX)) {
    results.push({
      type: PII_TYPE.ADDRESS,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

/*
 * 두 줄 주소 (줄이 바뀌거나 블록이 나뉜 주소)
 * 윗줄 주소가 줄 끝까지 왔을 때, 아랫줄 맨 앞이 주소의 뒷부분처럼 생겼으면 이어진 주소로 본다.
 * - 동·층·호: "101동 1001호", "제2층 제201호"
 * - 도로명: "필동로 00", "필동로12길 3"
 * - 시·군·구: 윗줄이 "서울특별시"처럼 시·도 이름으로 끝났을 때만 ("중구 필동로 00")
 */
const ADDRESS_TAIL = '(?:[^\\n(]*[^\\s\\n(])?';
const DONG_HO = '제?[ \\t]*[0-9A-Za-z]+(?:-[0-9]+)?[ \\t]*(?:동|층|호)(?![가-힣])';
const ROAD = '[가-힣0-9]+(?:로|길)[ \\t]*\\d';
const SIGUNGU = '[가-힣]+(?:시|군|구)(?![가-힣])';
const CONTINUATION_REGEX = new RegExp(`^[ \\t]*((?:${DONG_HO}|${ROAD})${ADDRESS_TAIL})`);
const CONTINUATION_AFTER_REGION_REGEX = new RegExp(`^[ \\t]*(${SIGUNGU}${ADDRESS_TAIL})`);
const TRAILING_REGION_REGEX = new RegExp(
  `(?<![가-힣])(${rules.addressRegions.map(escapeRegex).join('|')})[ \\t,]*$`,
);
/** 주소 뒤에 이것만 남아 있으면 "줄 끝까지 온 주소"로 본다. (쉼표, 공백, 괄호 하나) */
const ADDRESS_LINE_REST = /^[\s,]*(?:\([^)]*\))?[\s,]*$/;

/**
 * 아랫줄 맨 앞의 주소 뒷부분을 찾는다.
 * @param {string} line 한 줄 (줄바꿈 없음)
 * @param {boolean} [afterRegion] 윗줄이 시·도 이름으로 끝났는지
 * @returns {{ type: string, value: string, start: number, end: number } | null}
 */
export function findAddressContinuation(line, afterRegion = false) {
  const m = line.match(afterRegion ? CONTINUATION_AFTER_REGION_REGEX : CONTINUATION_REGEX);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length - m[1].length;
  return { type: PII_TYPE.ADDRESS, value: m[1], start, end: start + m[1].length };
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
  return ADDRESS_LINE_REST.test(rest) && ADDRESS_LIKE_END.test(value.trim());
}

/**
 * 사람 정보(이름 + 역할 + 생년월일)를 찾는다. extractFields()가 쓸 재료다.
 * 생년월일은 같은 줄에서 이름 뒤에 처음 나오는 주민·외국인등록번호의 앞 6자리다.
 * 찾는 범위는 줄 끝 또는 다음 사람의 이름 중 먼저 오는 곳까지다.
 * (다른 사람의 번호를 가져오면 계좌주 확인이 "확인 불가" 대신 "같은 사람"으로 잘못 나올 수 있다.)
 * 번호가 없으면 birthDate는 null이다. (못 읽음 = null 규칙)
 * @param {string} text
 * @param {string | null} [inheritedRole] 앞 블록에서 이어받은 역할 ("성명" 칸 이름에 붙인다)
 */
export function findPeople(text, inheritedRole = null) {
  const ids = findIdNumbers(text);
  const people = findLabeledNames(text, inheritedRole);
  return people.map((person, idx) => {
    const lineEnd = text.indexOf('\n', person.end);
    const next = people[idx + 1];
    const limit = Math.min(lineEnd === -1 ? text.length : lineEnd, next ? next.start : text.length);
    const id = ids.find((i) => i.start >= person.end && i.start < limit);
    const birthDate = id ? id.value.replace(/\D/g, '').slice(0, 6) || null : null;
    return { ...person, birthDate: birthDate && birthDate.length === 6 ? birthDate : null };
  });
}