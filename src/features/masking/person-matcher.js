// @ts-check
/**
 * PART 4. 동일 인물 판별
 *
 * 하는 일: 등기부·계약서에 나온 사람들(소유자, 임대인, 임차인, 예금주, 예전 소유자)을
 *          "같은 사람끼리" 묶는다.
 *
 * 판정 규칙 (비슷한 이름은 Fuse.js 유사도로 찾는다: isSimilarName)
 *   1) 이름이 같고 생년월일도 같으면 → 같은 사람 (CONFIRMED)
 *   2) 이름이 같거나 비슷한데 생년월일이 다르면 → 동명이인, 다른 사람
 *   3) 이름이 같거나 비슷한데(OCR 오타 포함) 생년월일이 없으면(null) → 알 수 없음 (AMBIGUOUS)
 *   4) 생년월일은 같은데 이름이 다르면 → 자동으로 합치지 않고 확인 (AMBIGUOUS)
 *      예: 김철수 / 김철슈(오타일 수 있음), 김철수 / 박철수(다른 사람일 수 있음)
 *   5) 그 밖에는 → 다른 사람
 *
 * 비슷한 이름이라고 자동으로 합치지 않는다. 합치면 "소유자≠임대인" STOP이 추측만으로 사라질 수 있어서,
 * AMBIGUOUS로 두고 ② "같은 사람인가요?"에서 사용자가 확인한 뒤 합친다. (applyPersonAnswers)
 *
 * 비슷한 이름 기준
 *   - 한글: 성(첫 글자)이 같고 길이 차이 1글자 이하, Fuse.js 점수 0.34 이하 (김철수 / 김철슈)
 *   - 영문 등: 성·이름 순서가 나라마다 달라 첫 글자 규칙 없이 전체 이름으로 비교, 점수 0.2 이하
 *     (NGUYEN VAN A / NGUYEN VAN = 비슷함, JOHN SMITH / JANE SMITH = 다름)
 */

import Fuse from 'fuse.js/basic';

/** extractFields() 결과에서 사람 목록이 들어 있는 자리 */
const PEOPLE_SOURCES = [
  ['registry', 'owners'],
  ['contract', 'landlords'],
  ['contract', 'tenants'],
  ['contract', 'accountHolders'],
  ['registry', 'previousOwners'], // 예전 소유자 (맨 끝에 둬서 기존 가명 글자 A~D가 바뀌지 않게)
];

/**
 * 이름 비교용으로 다듬는다. 띄어쓰기를 지우고 영문은 대문자로 맞춘다.
 * 예: "김 철수" → "김철수", "Nguyen Van A" → "NGUYENVANA"
 * @param {string} name
 */
export function normalizeName(name) {
  return String(name ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Fuse.js 점수 기준 (0 = 똑같음, 1 = 전혀 다름) */
const SIMILAR_SCORE = {
  HANGUL: 0.34, // 3글자 이름에서 1글자 차이까지 ("김철수" / "김철슈" = 0.33)
  OTHER: 0.2, // 영문 등은 첫 글자 규칙 없이 더 엄격하게 ("NGUYENVAN" / "NGUYENVANA" = 0.1, "JOHNSMITH" / "JANESMITH" = 0.33은 다른 이름)
};

/**
 * a 안에서 b를 찾았을 때의 Fuse.js 점수 (못 찾으면 1)
 * @param {string} a
 * @param {string} b
 */
function fuseScore(a, b) {
  const fuse = new Fuse([a], { includeScore: true, threshold: 1, ignoreLocation: true });
  return fuse.search(b)[0]?.score ?? 1;
}

/**
 * 두 이름이 같은 사람의 이름일 만큼 비슷한지 (OCR 오타 허용)
 * 똑같으면 true. 한글 이름은 성(첫 글자)이 같고 길이 차이가 1글자 이하일 때만 비교한다.
 * 영문 등은 성·이름 순서가 나라마다 달라서(NGUYEN VAN A는 성이 앞) 첫 글자 규칙 없이 전체로 비교한다.
 * @param {string} a
 * @param {string} b
 */
export function isSimilarName(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const hangul = /^[가-힣]+$/;
  if (hangul.test(x) && hangul.test(y)) {
    if (x[0] !== y[0] || Math.abs(x.length - y.length) > 1) return false;
    return Math.min(fuseScore(x, y), fuseScore(y, x)) <= SIMILAR_SCORE.HANGUL;
  }
  return Math.min(fuseScore(x, y), fuseScore(y, x)) <= SIMILAR_SCORE.OTHER;
}

/**
 * extractFields() 결과에서 사람을 전부 꺼내 한 줄로 모은다.
 * 목록이 null(읽지 못함)이거나 [](없음)이면 그냥 건너뛴다.
 * @param {any} fields
 * @returns {{ findingId: string, name: string, birthDate: string | null, role: string }[]}
 */
export function collectPeople(fields) {
  const people = [];
  for (const [docKey, listKey] of PEOPLE_SOURCES) {
    const list = fields?.[docKey]?.[listKey];
    if (!Array.isArray(list)) continue;
    for (const person of list) {
      if (!person?.name) continue; // 이름을 못 읽었으면 판정할 수 없음
      people.push(person);
    }
  }
  return people;
}

/**
 * 같은 사람끼리 묶는다. (가명은 아직 붙이지 않는다)
 *
 * 1단계: 이름과 생년월일이 모두 같은 사람끼리만 한 그룹으로 묶는다. (비슷한 이름은 묶지 않음)
 * 2단계: 모든 그룹을 다 만든 다음에 확실한지(CONFIRMED) 애매한지(AMBIGUOUS) 정한다.
 *        → 사람이 나온 순서와 상관없이 같은 결과가 나온다.
 * @param {ReturnType<typeof collectPeople>} people
 */
export function groupPeople(people) {
  /** @type {{ name: string, birthDate: string | null, roles: string[], findingIds: string[], status: string }[]} */
  const groups = [];

  // 1단계: 묶기
  for (const person of people) {
    const name = normalizeName(person.name);
    const birthDate = person.birthDate ?? null;

    // 이름과 생년월일이 모두 같은 그룹 (비슷한 이름은 합치지 않음, 생년월일이 없으면 확정할 수 없음)
    const match = birthDate
      ? groups.find((g) => g.name === name && g.birthDate === birthDate)
      : undefined;

    if (match) {
      if (!match.roles.includes(person.role)) match.roles.push(person.role);
      match.findingIds.push(person.findingId);
    } else {
      groups.push({ name, birthDate, roles: [person.role], findingIds: [person.findingId], status: 'CONFIRMED' });
    }
  }

  // 2단계: 애매한 그룹 표시
  for (const g of groups) {
    for (const other of groups) {
      if (other === g) continue;

      // 규칙 3) 이름이 같거나 비슷한데(오타 포함) 내 생년월일이 없음 → 저 사람과 같은 사람인지 모름
      const sameNameNoBirth = !g.birthDate && isSimilarName(other.name, g.name);

      // 규칙 4) 생년월일은 같은데 이름이 다름 (오타든 다른 이름이든) → 자동으로 합치지 않고 사용자에게 확인
      const sameBirthDiffName = g.birthDate !== null && g.birthDate === other.birthDate && other.name !== g.name;

      if (sameNameNoBirth || sameBirthDiffName) g.status = 'AMBIGUOUS';
    }
  }
  return groups;
}

