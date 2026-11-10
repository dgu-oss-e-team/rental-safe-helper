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
 * 라벨 뒤의 이름을 찾는다.
 * @param {string} text
 * @returns {{type: string, value: string, start: number, end: number, role: string}[]}
 */
export function findLabeledNames(text) {
  const results = [];
  for (const { role, regex } of PERSON_RULES) {
    for (const match of text.matchAll(regex)) {
      const name = match[1].trim();
      if (NOT_NAMES.has(name)) continue;
      const start = match.index + match[0].lastIndexOf(match[1]);
      results.push({ type: PII_TYPE.PERSON_NAME, value: name, start, end: start + name.length, role });
    }
  }
  return results.sort((a, b) => a.start - b.start);
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

/**
 * 사람 정보(이름 + 역할 + 생년월일)를 찾는다. extractFields()가 쓸 재료다.
 * 생년월일은 같은 줄에서 이름 뒤에 처음 나오는 주민·외국인등록번호의 앞 6자리다.
 * 찾는 범위는 줄 끝 또는 다음 사람의 이름 중 먼저 오는 곳까지다.
 * (다른 사람의 번호를 가져오면 계좌주 확인이 "확인 불가" 대신 "같은 사람"으로 잘못 나올 수 있다.)
 * 번호가 없으면 birthDate는 null이다. (못 읽음 = null 규칙)
 * @param {string} text
 */
export function findPeople(text) {
  const ids = findIdNumbers(text);
  const people = findLabeledNames(text);
  return people.map((person, idx) => {
    const lineEnd = text.indexOf('\n', person.end);
    const next = people[idx + 1];
    const limit = Math.min(lineEnd === -1 ? text.length : lineEnd, next ? next.start : text.length);
    const id = ids.find((i) => i.start >= person.end && i.start < limit);
    const birthDate = id ? id.value.replace(/\D/g, '').slice(0, 6) || null : null;
    return { ...person, birthDate: birthDate && birthDate.length === 6 ? birthDate : null };
  });
}