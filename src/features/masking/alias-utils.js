// @ts-check
/**
 * PART 4. 요약(등기부·계약서 인적사항 칸)에서 같이 쓰는 가명 고르기 (#357 리뷰: 공용 모듈로 분리)
 */

import { unconfirmedAlias } from './create-masking-plan.js';

/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */

/**
 * personGroups에서 findingId가 든 그룹의 가명.
 * 범례에 "확인 안 된 같은 이름" 가명만 있으면 그것을 쓴다 (가린 원문과 같은 글자가 되게).
 * @param {string | null | undefined} findingId
 * @param {PersonGroup[]} personGroups
 * @param {Record<string, string>} legend
 * @returns {string | null}
 */
export function aliasOf(findingId, personGroups, legend) {
  if (!findingId) return null;
  const group = personGroups.find((g) => g.findingIds.includes(findingId));
  if (!group) return null;
  const unconfirmed = unconfirmedAlias(group.alias);
  return !(group.alias in legend) && unconfirmed in legend ? unconfirmed : group.alias;
}

/** 이름 비교용: 띄어쓰기를 뺀다 */
export const squash = (/** @type {string} */ s) => s.replace(/\s+/g, '');

/**
 * 회사 이름 목록 (띄어쓰기 뺀 것, 빈 값 제외)
 * @param {unknown} list
 * @returns {string[]}
 */
export function companyNames(list) {
  return (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim() !== '').map((n) => squash(n));
}

/**
 * 두 회사 이름이 같은 회사인가 (띄어쓰기를 빼고, 한쪽이 다른 쪽을 품으면 같다고 본다: "가상신탁주식회사" ↔ "가상신탁 주식회사")
 * @param {string} a
 * @param {string} b
 */
export function sameCompany(a, b) {
  const x = squash(a);
  const y = squash(b);
  return x !== '' && y !== '' && (x.includes(y) || y.includes(x));
}
