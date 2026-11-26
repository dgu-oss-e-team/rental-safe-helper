// @ts-check
/**
 * PART 4. 요약(등기부·계약서 인적사항 칸)에서 같이 쓰는 가명 고르기와 회사 이름 비교 (#355·#357 리뷰: 공용 모듈)
 *
 * 회사 이름 비교는 쓰는 곳에 따라 두 가지다.
 *  - mayBeSameCompany (느슨함): 등기부 요약에서 "소유자 회사 이름을 보내지 않기" 위해 쓴다. 맞을수록 더 많이 가려서 안전하다.
 *  - isSameCompany (엄격함): 계약서 요약에서 "임대인 = 소유자 회사"라고 말할 때 쓴다. 다른 회사를 같다고 하면 사기 점검이 틀어진다.
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

/** 회사 형태 표기: 같은 회사도 서류마다 다르게 쓴다 ("(주)가상신탁" ↔ "가상신탁주식회사") */
const COMPANY_FORM = /주식회사|유한책임회사|유한회사|합자회사|합명회사|㈜|[(（]\s*[주유]\s*[)）]/g;

/**
 * 비교용 회사 이름: 회사 형태 표기·괄호·띄어쓰기·문장부호를 뺀다.
 * @param {string} name
 */
export function normalizeCompany(name) {
  return String(name ?? '')
    .replace(COMPANY_FORM, '')
    .replace(/[()（）[\]【】,.·ㆍ\s-]/g, '');
}

/**
 * 회사 이름 목록 (빈 값 제외, 원래 글자)
 * @param {unknown} list
 * @returns {string[]}
 */
export function companyNames(list) {
  return (Array.isArray(list) ? list : []).filter((n) => typeof n === 'string' && n.trim() !== '');
}

/**
 * 두 글자열이 한 글자 이내로 다른가 (바꾸기·넣기·빼기 하나). OCR이 한 글자 틀린 경우.
 * @param {string} a
 * @param {string} b
 */
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** 포함·한 글자 차이 비교를 하는 최소 길이. 이보다 짧은 이름("국")은 완전히 같을 때만 같다고 본다 */
const MIN_LOOSE_LENGTH = 4;

/**
 * 같은 회사일 수 있는가 (느슨함). 회사 형태 표기를 뺀 이름이 같거나, 둘 다 4자 이상이면서 한쪽이 다른 쪽을 품거나 한 글자 차이.
 * 등기부 요약에서 소유자 회사 이름을 보내지 않으려고 쓴다 (맞을수록 더 가린다).
 * @param {string} a
 * @param {string} b
 */
export function mayBeSameCompany(a, b) {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  if (x.length < MIN_LOOSE_LENGTH || y.length < MIN_LOOSE_LENGTH) return false;
  return x.includes(y) || y.includes(x) || withinOneEdit(x, y);
}

/**
 * 같은 회사인가 (엄격함). 회사 형태 표기를 뺀 이름이 완전히 같을 때만.
 * 계약서 요약에서 "임대인 = 소유자 회사"라고 말할 때 쓴다 ("가상건설" ≠ "가상건설산업").
 * @param {string} a
 * @param {string} b
 */
export function isSameCompany(a, b) {
  const x = normalizeCompany(a);
  return x !== '' && x === normalizeCompany(b);
}
