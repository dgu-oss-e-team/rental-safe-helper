// @ts-check
/**
 * PART 4. 동일 인물 판별
 *
 * 하는 일: 등기부·계약서에 나온 사람들(소유자, 임대인, 임차인, 예금주)을
 *          "같은 사람끼리" 묶는다.
 *
 * 판정 규칙
 *   1) 이름이 다르면 → 다른 사람
 *   2) 이름이 같고 생년월일도 같으면 → 같은 사람 (CONFIRMED)
 *   3) 이름이 같은데 생년월일이 다르면 → 동명이인, 다른 사람
 *   4) 이름이 같은데 생년월일이 없으면(null) → 알 수 없음 (AMBIGUOUS)
 *   5) 이름은 다른데 생년월일이 같으면 → OCR 오타일 수 있음 (AMBIGUOUS)
 *      ("김철수"를 "김철슈"로 잘못 읽어 "소유자≠임대인" STOP이 잘못 뜨는 것을 막는다)
 *
 * TODO(PART 4): Fuse.js 유사도로 오타 이름도 같은 사람 후보로 찾기 (지금은 규칙 5로 확인 불가 처리)
 */
 
/** extractFields() 결과에서 사람 목록이 들어 있는 자리 */
const PEOPLE_SOURCES = [
  ['registry', 'owners'],
  ['contract', 'landlords'],
  ['contract', 'tenants'],
  ['contract', 'accountHolders'],
];
 
/**
 * 이름 비교용으로 다듬는다. 띄어쓰기를 지우고 영문은 대문자로 맞춘다.
 * 예: "김 철수" → "김철수", "Nguyen Van A" → "NGUYENVANA"
 * @param {string} name
 */
export function normalizeName(name) {
  return String(name ?? '').replace(/\s+/g, '').toUpperCase();
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
 * 1단계: 이름과 생년월일이 모두 같은 사람끼리 한 그룹으로 묶는다.
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
 
    // 이름과 생년월일이 모두 같은 그룹 (생년월일이 없으면 같은 사람이라고 확정할 수 없음)
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
 
      // 규칙 4) 이름이 같은데 내 생년월일이 없음 → 저 사람과 같은 사람인지 모름
      const sameNameNoBirth = other.name === g.name && !g.birthDate;
 
      // 규칙 5) 이름은 다른데 생년월일이 같음 → OCR 오타일 수 있음 (예: 김철수 / 김철슈)
      const sameBirthDiffName =
        other.name !== g.name && g.birthDate !== null && g.birthDate === other.birthDate;
 
      if (sameNameNoBirth || sameBirthDiffName) g.status = 'AMBIGUOUS';
    }
  }
  return groups;
}