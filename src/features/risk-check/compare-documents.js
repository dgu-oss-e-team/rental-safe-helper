// @ts-check
/**
 * 등기부와 계약서의 정보를 비교하는 규칙 3개.
 *   1) 등기부 소유자 ↔ 계약서 임대인   (OWNER_MISMATCH)
 *   2) 계약서 예금주 ↔ 계약서 임대인   (ACCOUNT_HOLDER_MISMATCH)
 *   3) 등기부 소재지 ↔ 계약서 소재지   (ADDRESS_MISMATCH)
 *      - 주소가 정식 시·도 이름으로 시작하지 않거나, 도로명·지번 주소가 섞여 있으면 비교하지 않고 UNVERIFIABLE
 *
 * 규칙
 *  - 값이 null이거나 비어 있으면 UNVERIFIABLE (읽지 못한 것을 "문제없음"으로 판단하지 않는다)
 *  - 같은 사람인지는 이름을 직접 비교하지 않고 PART 4의 personGroups 결과를 쓴다
 *  - personGroups에서 판정이 AMBIGUOUS인 사람이 있으면 UNVERIFIABLE
 *  - 공동 소유(소유자 2명 이상)인데 일부만 임대인으로 서명했으면 CHECK (나머지 소유자의 동의 필요) 
 *  - 문구에는 실제 이름 대신 역할 가명(alias)만 쓴다
 */

import { ok, RISK_STATUS } from '../../shared/document-model.js';
import { buildRiskResult } from './risk-explanations.js';
import rules from '../../config/templates/person-labels.json';

/** PART 4 personGroups의 status 값 */
const PERSON_CONFIRMED = 'CONFIRMED';

/**
 * 사람 목록을 personGroups의 그룹으로 바꾼다. 하나라도 찾지 못하거나 확정이 아니면 null.
 * @param {any[] | null | undefined} people
 * @param {any[]} personGroups
 * @returns {any[] | null}
 */
function resolveGroups(people, personGroups) {
  if (!Array.isArray(people) || people.length === 0) return null;
  const groups = [];
  for (const person of people) {
    const group = personGroups.find((g) => g.findingIds?.includes(person.findingId));
    if (!group || group.status !== PERSON_CONFIRMED) return null;
    groups.push(group);
  }
  return groups;
}

/**
 * 화면 근거 칸에 보여 줄 사람 정보. (화면 전용: 프롬프트에 넣지 않는다)
 * @param {any[] | null | undefined} people
 * @returns {string | null}
 */
function describePeople(people) {
  if (!Array.isArray(people) || people.length === 0) return null;
  return people.map((p) => (p.birthDate ? `${p.name} (birth ${p.birthDate})` : p.name)).join(', ');
}

/** @param {any[]} groups */
const joinAliases = (groups) => [...new Set(groups.map((g) => g.alias))].join(' and ');

/**
 * members(확인 대상)가 모두 allowed(기준) 안의 사람인지 판정한다.
 * @param {object} p
 * @param {string} p.ruleId
 * @param {any[] | null | undefined} p.members  확인 대상 사람 (임대인 또는 예금주)
 * @param {any[] | null | undefined} p.allowed  기준이 되는 사람 (소유자 또는 임대인)
 * @param {string} p.memberKey  문구의 {자리} 이름 (members용)
 * @param {string} p.allowedKey  문구의 {자리} 이름 (allowed용)
 * @param {any[]} p.personGroups
  * @param {{ left: any[] | null | undefined, right: any[] | null | undefined }} p.display  근거 칸 (왼쪽, 오른쪽)
 * @param {boolean} [p.coOwnerCheck]  true면 allowed가 2명 이상인데 members가 일부뿐일 때 CHECK (소유자 비교용)
 */
function comparePeople({ ruleId, members, allowed, memberKey, allowedKey, personGroups, display, coOwnerCheck = false }) {
  const memberGroups = resolveGroups(members, personGroups);
  const allowedGroups = resolveGroups(allowed, personGroups);
  const values = { left: describePeople(display.left), right: describePeople(display.right) };

  if (!memberGroups || !allowedGroups) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values });
  }

    const allowedIds = new Set(allowedGroups.map((g) => g.personId));
  const memberIds = new Set(memberGroups.map((g) => g.personId));
  const same = [...memberIds].every((id) => allowedIds.has(id));
  const aliases = {
    [memberKey]: joinAliases(memberGroups),
    [allowedKey]: joinAliases(allowedGroups),
  };
  if (!same) return buildRiskResult(ruleId, RISK_STATUS.STOP, { aliases, values });

  // 공동 소유: 소유자가 2명 이상인데 그중 일부만 임대인으로 서명했다면 나머지 소유자의 동의가 필요하다
  const everyOwnerSigns = [...allowedIds].every((id) => memberIds.has(id));
  if (coOwnerCheck && !everyOwnerSigns) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'co_owner', aliases, values });
  }
  return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { aliases, values });
}

/** 등기부 소유자 ↔ 계약서 임대인 */
export function compareOwnerAndLandlord(fields, personGroups) {
  const owners = fields?.registry?.owners;
  const landlords = fields?.contract?.landlords;
  return comparePeople({
    ruleId: 'OWNER_MISMATCH',
    members: landlords,
    allowed: owners,
    memberKey: 'landlord',
    allowedKey: 'owner',
    personGroups,
    display: { left: owners, right: landlords },
    coOwnerCheck: true,
  });
}

/** 계약서 예금주 ↔ 계약서 임대인 */
export function compareAccountHolderAndLandlord(fields, personGroups) {
  const holders = fields?.contract?.accountHolders;
  const landlords = fields?.contract?.landlords;
  return comparePeople({
    ruleId: 'ACCOUNT_HOLDER_MISMATCH',
    members: holders,
    allowed: landlords,
    memberKey: 'accountHolder',
    allowedKey: 'landlord',
    personGroups,
    display: { left: holders, right: landlords },
  });
}

/**
 * 주소를 비교하기 쉽게 정리한다.
 * - 괄호 안 내용((새싹동 123-4) 등), 공백, 쉼표 제거
 * - "제2층 제201호" → "2층201호" 처럼 숫자 앞의 "제" 제거
 * @param {string} address
 */
export function normalizeAddress(address) {
  return address
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s,]/g, '')
    .replace(/제(?=\d)/g, '');
}

/**
 * 정식 시·도 이름 목록. PART 2의 formalRegionNames(person-labels.json)를 그대로 쓴다.
 * 긴 이름부터 비교한다. (경기도 광주시 → 경기도)
 */
const FORMAL_REGION_NAMES = [...new Set(Object.values(rules.formalRegionNames))].sort((a, b) => b.length - a.length);

/** 주소 맨 앞이 정식 시·도 이름이고, 그 뒤에 공백이나 끝이 오는지. ("서울대로", "서울 중구"는 아니다) */
const FORMAL_REGION_START = new RegExp(`^(?:${FORMAL_REGION_NAMES.join('|')})(?:\\s|$)`);

/** 도로명 주소: "필동로 45", "테헤란로12길 5" 처럼 로·길 뒤에 번호가 온다 */
const ROAD_ADDRESS = /[가-힣0-9]+(?:로|길)\s*\d/;

/** 지번 주소: "필동 123-4", "상계리 산 12" 처럼 동·읍·면·리 뒤에 번지가 온다 */
const LOT_ADDRESS = /[가-힣]+(?:동|읍|면|리)\s*(?:산\s*)?\d/;

/**
 * 주소 형식을 알아본다. 괄호 안(건물 옆의 지번 등)은 normalizeAddress가 먼저 지운다.
 * @param {string} address  normalizeAddress()를 거친 주소
 * @returns {'ROAD' | 'LOT' | null}  알 수 없으면 null
 */
function addressStyle(address) {
  if (ROAD_ADDRESS.test(address)) return 'ROAD';
  if (LOT_ADDRESS.test(address)) return 'LOT';
  return null;
}

/**
 * 등기부 소재지 ↔ 계약서 소재지
 *  - 한쪽이라도 읽지 못했으면 UNVERIFIABLE
 *  - 한쪽이라도 정식 시·도 이름으로 시작하지 않으면 UNVERIFIABLE (region_unclear)
 *    (OCR 오류나 줄임말이면 다른 주소가 아닌데도 달라 보일 수 있다)
 *  - 글자가 같으면 NO_FLAG
 *  - 글자가 다른데 도로명과 지번이 섞였거나 형식을 알 수 없으면 UNVERIFIABLE (format_differs)
 *  - 같은 형식인데 다르면 STOP
 */
export function compareAddresses(fields) {
  const ruleId = 'ADDRESS_MISMATCH';
  const registryAddress = fields?.registry?.address;
  const contractAddress = fields?.contract?.address;
  const values = { left: registryAddress ?? null, right: contractAddress ?? null };

  if (!registryAddress || !contractAddress) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values });
  }
  if (!FORMAL_REGION_START.test(registryAddress.trim()) || !FORMAL_REGION_START.test(contractAddress.trim())) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'region_unclear', values });
  }

  const registry = normalizeAddress(registryAddress);
  const contract = normalizeAddress(contractAddress);
  if (registry === contract) return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { values });

  const registryStyle = addressStyle(registry);
  const contractStyle = addressStyle(contract);
  if (registryStyle === null || registryStyle !== contractStyle) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'format_differs', values });
  }
  return buildRiskResult(ruleId, RISK_STATUS.STOP, { values });
}

/**
 * 비교 규칙 3개를 모두 실행한다. 하나라도 규칙 파일 오류로 실패하면 그 오류를 그대로 돌려준다.
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').RiskResult[]>}
 */
export function compareDocuments(fields, personGroups) {
  const results = [];
  for (const run of [
    () => compareOwnerAndLandlord(fields, personGroups),
    () => compareAccountHolderAndLandlord(fields, personGroups),
    () => compareAddresses(fields),
  ]) {
    const r = run();
    if (!r.ok) return r;
    results.push(r.data);
  }
  return ok(results);
}