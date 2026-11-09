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
 *   4) 이름이 같은데 한쪽 생년월일이 없으면(null) → 알 수 없음 (AMBIGUOUS)
 *
 * TODO(PART 4): OCR 오타("김철슈")도 같은 이름으로 보도록 Fuse.js 유사도 비교 추가
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
 * @param {ReturnType<typeof collectPeople>} people
 */
export function groupPeople(people) {
  /** @type {{ name: string, birthDate: string | null, roles: string[], findingIds: string[], status: string }[]} */
  const groups = [];

  for (const person of people) {
    const name = normalizeName(person.name);
    const sameName = groups.filter((g) => g.name === name);

    // 규칙 2) 이름과 생년월일이 모두 같은 그룹이 있으면 거기에 넣는다
    const match = person.birthDate
      ? sameName.find((g) => g.birthDate === person.birthDate)
      : undefined;

    if (match) {
      if (!match.roles.includes(person.role)) match.roles.push(person.role);
      match.findingIds.push(person.findingId);
      continue;
    }

    // 규칙 4) 이름은 같은데 생년월일이 없어서 확인할 수 없는 경우
    const unsure =
      sameName.length > 0 && (!person.birthDate || sameName.some((g) => !g.birthDate));

    // 규칙 1), 3) 또는 4) → 새 그룹
    groups.push({
      name,
      birthDate: person.birthDate ?? null,
      roles: [person.role],
      findingIds: [person.findingId],
      status: unsure ? 'AMBIGUOUS' : 'CONFIRMED',
    });
  }
  return groups;
}