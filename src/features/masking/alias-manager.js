// @ts-check
/**
 * PART 4. 역할 가명 붙이기
 * 예: 등기부 소유자 → [Owner_A], 계약서 임대인 → [Landlord_B]
 * 같은 그룹(같은 사람)은 항상 같은 가명을 받는다.
 */

const ROLE_LABEL = {
  OWNER: 'Owner',
  LANDLORD: 'Landlord',
  TENANT: 'Tenant',
  ACCOUNT_HOLDER: 'AccountHolder',
  PREVIOUS_OWNER: 'PrevOwner',
};

/**
 * 그룹마다 personId와 가명을 붙인다. 이름·생년월일은 결과에서 뺀다.
 * (생년월일은 판정에만 쓰고 다른 파트로 넘기지 않는다)
 * @param {{ roles: string[], findingIds: string[], status: string }[]} groups
 */
export function assignAliases(groups) {
  return groups.map((g, i) => {
    const letter = String.fromCharCode(65 + i); // 0 → A, 1 → B ...
    const label = ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (g.roles[0])] ?? 'Person';
    return {
      personId: `P${i + 1}`,
      alias: `[${label}_${letter}]`,
      roles: [...g.roles],
      findingIds: [...g.findingIds],
      status: g.status,
    };
  });
}