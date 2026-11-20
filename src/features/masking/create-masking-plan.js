// @ts-check
/**
 * PART 4. 목적에 맞는 마스킹 계획 만들기
 *
 *   createMaskingPlan(findings, personGroups, purpose, edits?) → Result<MaskingPlan>
 *   coarsenAddress(address) → 시·구(동)까지 줄인 주소 (못 줄이면 '')
 *
 * 목적별 규칙은 src/config/masking/masking-policy.json, 사용자 수정(edits) 규칙은 user-edits.js
 */

import { ok, fail, ERROR_CODE, MASKING_ACTION, MASKING_PURPOSE, PII_TYPE } from '../../shared/document-model.js';
import { resolveRemovals, addEditsToItems, hasInvalidAddPosition } from './user-edits.js';
import { normalizeName } from './person-matcher.js';
import policy from '../../config/masking/masking-policy.json';
// 시·도 이름 목록 (정식 이름 + 줄임말). PART 2가 관리하는 설정 파일을 같이 읽는다.
import personLabels from '../../config/templates/person-labels.json';

/** @typedef {import('../../shared/document-model.js').PiiFinding} PiiFinding */
/** @typedef {import('./index.js').PersonGroup} PersonGroup */

/** 가린 자리에 넣는 글자 */
export const REDACTED = '[REDACTED]';

/**
 * 이름만 같고 같은 사람인지 확인하지 않은 가명: "[PrevOwner_E]" → "[PrevOwner_E?]"
 * @param {string} alias
 */
export function unconfirmedAlias(alias) {
  return alias.replace(/\]$/, '?]');
}

/** 시·도 이름 목록 (person-labels.json의 addressRegions) */
const ADDRESS_REGIONS = new Set(personLabels.addressRegions ?? []);
/** 이름 뒤에 붙는 조사 (person-labels.json의 nameParticles, PART 2와 같은 목록. 긴 것부터, 한글만이라 그대로 잇는다) */
const NAME_PARTICLE = new RegExp(`(?:${(personLabels.nameParticles ?? []).join('|')})$`);
/** 목록에 없더라도 정식 시·도 이름 모양이면 인정 */
const REGION_PATTERN = /^[가-힣]+(특별시|광역시|특별자치시|특별자치도|도|시)$/;

/**
 * 주소에서 시·도, 시·군·구까지만 남기고 동·번지·호수는 지운다.
 * (최종 제안서 목적별 가림 표: 사기 위험 확인 → "시·구(동)만 남김". 팀에서 시·구까지만으로 정함)
 * 동을 남기면 지번 주소("필동3가")만 동이 보이고 도로명 주소는 안 보여 기준이 달라진다.
 *
 * 예: "서울특별시 중구 필동로 00, 101호"        → "서울특별시 중구"
 *     "경기도 성남시 분당구 정자동 178-1"       → "경기도 성남시 분당구"
 *     "경기도 성남시 분당구 불정로 6 (정자동)"  → "경기도 성남시 분당구"
 *     "경기 수원시 팔달구 …"                  → "경기 수원시 팔달구" (줄임말도 인정)
 *
 * 남길 부분을 하나도 못 찾으면 빈 문자열을 돌려준다 (→ 호출하는 쪽에서 통째로 가림).
 * @param {string} address
 */
export function coarsenAddress(address) {
  const text = String(address ?? '');
  const tokens = text.replace(/\(.*?\)/g, ' ').split(/[\s,]+/).filter(Boolean);

  const kept = [];
  let i = 0;
  // 1) 시·도: 정식 이름("서울특별시")이나 줄임말("서울", "경기") 모두 인정
  if (tokens[0] && (ADDRESS_REGIONS.has(tokens[0]) || REGION_PATTERN.test(tokens[0]))) {
    kept.push(tokens[0]);
    i = 1;
  }
  // 2) 시·군·구: "성남시", "분당구", "양평군"
  while (i < tokens.length && /^[가-힣]+(시|군|구)$/.test(tokens[i])) {
    kept.push(tokens[i]);
    i += 1;
  }
  if (kept.length === 0) return '';

  return kept.join(' ');
}

/**
 * 목적에 맞는 마스킹 계획을 만든다.
 * @param {PiiFinding[]} findings
 * @param {PersonGroup[]} personGroups
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {import('./user-edits.js').MaskingEdits} [edits]  사용자 수정 (없으면 빈 값)
 */
export function createMaskingPlan(findings, personGroups, purpose, edits) {
  if (!Object.values(MASKING_PURPOSE).includes(purpose)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Unknown purpose.');
  }
  if (!Array.isArray(findings) || !Array.isArray(personGroups)) {
    return fail(ERROR_CODE.INVALID_INPUT, 'Findings or person groups are missing.');
  }
  // 사용자가 더 가린 글자는 PDF 위치가 꼭 있어야 한다 (빼면 PDF에서 안 가려짐)
  if (hasInvalidAddPosition(edits)) {
    return fail(ERROR_CODE.COORDINATE_INVALID, 'A user-selected area has no valid position.');
  }

  /** @type {Record<string, string>} */
  const rules = policy[/** @type {keyof typeof policy} */ (purpose)];
  /** @type {Map<string, string>} findingId → 가명 */
  const aliasByFinding = new Map();
  for (const group of personGroups) {
    for (const id of group.findingIds) aliasByFinding.set(id, group.alias);
  }
  // 역할 없는 이름(등기부 "채무자 김철수", 계약금 "영수자 김철수" 등, role: null)은 인물 묶음에 들어 있지 않다.
  // 글자가 똑같은 이름의 묶음이 딱 하나면 그 가명에 "?"를 붙여 쓰고([PrevOwner_E?]), 둘 이상(동명이인)이거나 없으면 가린다.
  // "?"는 이름만 같을 뿐 같은 사람인지 확인하지 않았다는 표시다. (범례에도 적는다, apply-masking-plan.js)
  // 단, 그 묶음이 같은 서류에도 그 이름으로 나오면 "?" 없이 같은 가명을 쓴다. (계약서 동의서·서명란의 임차인, 등기부 부기 줄의 공유자 본인)
  // 같은 서류에 같은 이름의 다른 사람이 있으면 묶음이 둘 이상이라 위에서 이미 가려진다.
  // 비슷한 이름(Fuse.js)은 연결하지 않는다. 자동으로 같은 사람이라고 정하지 않는 원칙과 같다.
  const findingById = new Map(findings.map((f) => [f.id, f]));
  /** @type {Map<string, Map<string, Set<string>>>} 정리한 이름 → (그 이름을 가진 묶음의 가명 → 그 이름이 나온 서류들) */
  const aliasesByName = new Map();
  for (const group of personGroups) {
    for (const id of group.findingIds) {
      const finding = findingById.get(id);
      if (!finding?.value) continue;
      const key = normalizeName(finding.value);
      const byAlias = aliasesByName.get(key) ?? new Map();
      const docs = byAlias.get(group.alias) ?? new Set();
      docs.add(finding.documentId);
      byAlias.set(group.alias, docs);
      aliasesByName.set(key, byAlias);
    }
  }
  /**
   * 이름 하나에 묶음이 딱 하나면 그 가명 (같은 서류에 나왔으면 그대로, 아니면 "?"를 붙여서)
   * @param {string} name  @param {string} documentId
   */
  const linkedAlias = (name, documentId) => {
    const byAlias = aliasesByName.get(normalizeName(name));
    if (!byAlias || byAlias.size !== 1) return undefined;
    const [[alias, docs]] = byAlias;
    return docs.has(documentId) ? alias : unconfirmedAlias(alias);
  };
  /** @param {PiiFinding} f */
  const aliasFor = (f) => {
    const direct = aliasByFinding.get(f.id);
    if (direct) return direct;
    if (aliasesByName.has(normalizeName(f.value))) return linkedAlias(f.value, f.documentId);
    // 똑같은 이름이 없으면 끝의 조사를 떼고 다시 본다. ("김철수는" → "김철수" + "는" → "[Owner_A?]는")
    // 조사를 뗀 나머지가 이미 있는 사람 이름과 같을 때만 연결한다. "김지은"을 "김지" + "은"으로 쪼개 남의 가명을 붙이지 않게.
    const particle = NAME_PARTICLE.exec(f.value);
    if (!particle || particle.index === 0) return undefined;
    const stem = linkedAlias(f.value.slice(0, particle.index), f.documentId);
    return stem ? stem + particle[0] : undefined;
  };

  // 두 줄 주소: 같은 groupId 조각들의 값을 순서대로 이어 붙여 둔다. (INTERFACES.md 4번 groupId)
  /** @type {Map<string, { firstId: string, text: string }>} */
  const addressGroups = new Map();
  for (const f of findings) {
    if (f.type !== PII_TYPE.ADDRESS || !f.groupId) continue;
    const g = addressGroups.get(f.groupId);
    if (g) g.text += ` ${f.value}`;
    else addressGroups.set(f.groupId, { firstId: f.id, text: f.value });
  }

  // 사용자가 해제한 것 (규칙 적용 후)
  const keepIds = resolveRemovals(findings, personGroups, edits);

  const items = findings.map((f) => {
    let action = rules[f.type] ?? MASKING_ACTION.REDACT; // 모르는 종류는 안전하게 가림
    if (keepIds.has(f.id)) action = MASKING_ACTION.KEEP;
    /** @type {string | null} */
    let replacement = REDACTED;

    if (action === MASKING_ACTION.REPLACE) {
      if (f.type === PII_TYPE.PERSON_NAME) {
        const alias = aliasFor(f);
        // 인물 판정이 없고 같은 이름의 묶음도 하나로 정해지지 않으면 가명을 붙일 수 없으므로 가린다
        if (alias) replacement = alias;
        else action = MASKING_ACTION.REDACT;
      } else if (f.type === PII_TYPE.ADDRESS) {
        const group = f.groupId ? addressGroups.get(f.groupId) : undefined;
        if (group && group.firstId !== f.id) {
          // 두 줄 주소의 둘째 조각부터는 가린다 (줄인 주소는 첫 조각에만 넣음)
          action = MASKING_ACTION.REDACT;
        } else {
          const coarse = coarsenAddress(group ? group.text : f.value);
          // 남길 부분을 못 찾으면 안전하게 통째로 가린다
          if (coarse) replacement = coarse;
          else action = MASKING_ACTION.REDACT;
        }
      }
    } else if (action === MASKING_ACTION.KEEP) {
      replacement = null;
    }

    return {
      findingId: f.id,
      action,
      replacement,
      documentId: f.documentId,
      pageIndex: f.pageIndex,
      bbox: { ...f.bbox },
    };
  });

  // 사용자가 더 가린 글자는 항상 REDACT로 뒤에 붙인다
  items.push(...addEditsToItems(edits));

  return ok({ purpose, items });
}
