// @ts-check
/**
 * PART 4. "같은 사람인가요?" 답 반영 (docs/INTERFACES.md 6번)
 *
 * personAnswers = { P4: 'P2' }  → P4는 P2와 같은 사람
 *                 { P4: null }  → P4는 다른 사람 (확인함)
 *                 키 없음        → 아직 답하지 않음
 *
 * applyPersonAnswers(personGroups, personAnswers) → Result<PersonGroup[]>
 *   - 같은 사람: 답의 대상(P2)의 personId·가명을 남기고, P4의 역할·findingIds를 합친다. 합친 그룹은 CONFIRMED.
 *   - 다른 사람: 그 그룹을 CONFIRMED로만 바꾼다.
 *   - 답의 키는 원래 AMBIGUOUS인 사람만 된다. (CONFIRMED인 사람을 합치면 근거 없이 STOP이 사라질 수 있음)
 *   - 없는 personId, 자기 자신, 서로 가리키는 답(P2→P4, P4→P2), CONFIRMED인 사람의 답은 실패 → PART 5가 이전 상태를 유지한다.
 *   - 원래 personGroups는 바꾸지 않는다. (답을 바꾸거나 취소하면 원래 그룹에서 다시 계산)
 *
 * buildPersonQuestions(fields, personGroups) → 물어볼 질문 목록 (화면용, 계산만)
 *   - 원래 판정이 AMBIGUOUS인 사람마다, 이름이 같거나 비슷하거나(오타 허용) 생년월일이 같은 다른 사람을 후보로 묻는다.
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { collectPeople, isSimilarName } from './person-matcher.js';

/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */
/** @typedef {Record<string, string | null>} PersonAnswers */

/**
 * 사용자 답으로 사람 그룹을 합친다.
 * @param {PersonGroup[]} personGroups  matchPeople() 결과 (원래 그룹)
 * @param {PersonAnswers | null | undefined} personAnswers
 * @returns {import('../../shared/document-model.js').Result<PersonGroup[]>}
 */
export function applyPersonAnswers(personGroups, personAnswers) {
  if (!Array.isArray(personGroups)) return fail(ERROR_CODE.INVALID_INPUT, 'Person groups are missing.');
  const answers = personAnswers ?? {};
  if (typeof answers !== 'object' || Array.isArray(answers)) return fail(ERROR_CODE.INVALID_INPUT, 'Person answers must be an object.');

  const byId = new Map(personGroups.map((g) => [g.personId, g]));

  // 답 검사
  for (const [id, target] of Object.entries(answers)) {
    if (!byId.has(id)) return fail(ERROR_CODE.INVALID_INPUT, 'An answer refers to an unknown person.');
    // 답은 원래 AMBIGUOUS인 사람에게만 받는다 (이미 확인된 사람을 합치면 근거 없이 STOP이 사라질 수 있음)
    if (byId.get(id)?.status !== 'AMBIGUOUS') return fail(ERROR_CODE.INVALID_INPUT, 'Only unconfirmed people can be answered.');
    if (target === null) continue;
    if (typeof target !== 'string' || !byId.has(target)) return fail(ERROR_CODE.INVALID_INPUT, 'An answer refers to an unknown person.');
    if (target === id) return fail(ERROR_CODE.INVALID_INPUT, 'A person cannot be the same as themselves.');
  }

  /** 원래 순서 (서로 가리킬 때 앞에 있는 사람을 남긴다) */
  const order = new Map(personGroups.map((g, i) => [g.personId, i]));
  /**
   * 답을 따라가 최종으로 남을 사람을 찾는다. (P4→P2→P1이면 P1)
   * 서로 같다고 답한 경우(P1→P3, P3→P1처럼 돌아오는 경우)는 둘 다 같은 사람이라는 뜻이라 합친다.
   * 이때는 돌아오는 고리 안에서 원래 순서가 가장 앞인 사람을 남긴다. (누가 먼저 답했는지와 상관없이 같은 결과)
   * @param {string} id
   * @returns {string}
   */
  const finalOf = (id) => {
    const path = [id];
    let cur = id;
    while (typeof answers[cur] === 'string') {
      cur = /** @type {string} */ (answers[cur]);
      const at = path.indexOf(cur);
      if (at !== -1) {
        // 고리: path[at..]가 서로 같다고 답한 사람들
        return path.slice(at).reduce((a, b) => ((order.get(a) ?? 0) <= (order.get(b) ?? 0) ? a : b));
      }
      path.push(cur);
    }
    return cur;
  };

  /** @type {Map<string, PersonGroup[]>} 남을 사람 → 합쳐질 그룹들 (원래 순서) */
  const members = new Map();
  for (const g of personGroups) {
    const root = finalOf(g.personId);
    if (!members.has(root)) members.set(root, []);
    members.get(root)?.push(g);
  }

  /** @type {PersonGroup[]} */
  const result = [];
  for (const g of personGroups) {
    const list = members.get(g.personId);
    if (!list) continue; // 다른 사람에게 합쳐짐
    if (list.length === 1 && !(g.personId in answers)) {
      result.push({ ...g, roles: [...g.roles], findingIds: [...g.findingIds] }); // 답 없음: 그대로
      continue;
    }
    // 남는 사람(g)을 앞에 두고 나머지를 뒤에 붙인다
    const ordered = [g, ...list.filter((m) => m !== g)];
    result.push({
      personId: g.personId,
      alias: g.alias,
      roles: [...new Set(ordered.flatMap((m) => m.roles))],
      findingIds: [...new Set(ordered.flatMap((m) => m.findingIds))],
      status: 'CONFIRMED',
    });
  }
  return ok(result);
}

/**
 * 질문 하나
 * @typedef {Object} PersonQuestion
 * @property {string} personId           확인할 사람 (원래 AMBIGUOUS)
 * @property {string} alias
 * @property {string[]} roles
 * @property {string[]} names            문서에 적힌 이름 (화면에만 보여 줌)
 * @property {{ personId: string, alias: string, roles: string[], names: string[] }[]} candidates  같은 사람일 수 있는 후보
 */

/**
 * 물어볼 질문을 만든다. 원래 판정(matchPeople 결과) 기준이라, 답한 뒤에도 질문이 사라지지 않는다.
 * @param {any} fields  extractFields() 결과 (이름·생년월일 비교용, 화면 밖으로 내보내지 않음)
 * @param {PersonGroup[]} personGroups  원래 그룹
 * @returns {PersonQuestion[]}
 */
export function buildPersonQuestions(fields, personGroups) {
  const people = new Map(collectPeople(fields).map((p) => [p.findingId, p]));
  const info = (/** @type {PersonGroup} */ g) => {
    const list = g.findingIds.map((id) => people.get(id)).filter(Boolean);
    return {
      names: [...new Set(list.map((p) => p.name))],
      births: new Set(list.map((p) => p.birthDate).filter(Boolean)),
    };
  };

  return personGroups
    .filter((g) => g.status === 'AMBIGUOUS')
    .map((g) => {
      const me = info(g);
      const candidates = personGroups
        .filter((o) => o !== g)
        .filter((o) => {
          const other = info(o);
          const sameName = me.names.some((a) => other.names.some((b) => isSimilarName(a, b)));
          const sameBirth = [...me.births].some((b) => other.births.has(b));
          return sameName || sameBirth;
        })
        .map((o) => ({ personId: o.personId, alias: o.alias, roles: [...o.roles], names: info(o).names }));
      return { personId: g.personId, alias: g.alias, roles: [...g.roles], names: me.names, candidates };
    });
}
