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
 *  - 등기부가 지번, 계약서가 도로명이면 등기부 표제부의 [도로명주소](registry.roadAddress)로 비교 (#177)
 *    (계약서에서 같은 동·호수 조각을 찾아 비교한다. 위치와 건물 이름은 상관없다)
 *  - 다르다고 나와도 OCR 이름(confidence가 숫자)이 한글 이름 모양(2~4자)이 아니거나 신뢰도가 낮으면 STOP이 아니라 UNVERIFIABLE (#275, #312)
 *    글자 PDF 이름(confidence가 null)은 모양을 보지 않는다. 영문 이름 임대인이 진짜 다른 사람이면 STOP
 *  - 사진·스캔 서류의 주소가 숫자 몇 자만 다르면 STOP이 아니라 CHECK (#312). 글자 PDF끼리는 STOP
 *  - 사진·스캔 서류 주소에 영문이 섞였거나 동·호수를 못 읽었으면 STOP이 아니라 CHECK (#343).
*/

import { ok, RISK_STATUS, SOURCE_TYPE } from '../../shared/document-model.js';
import { buildRiskResult } from './risk-explanations.js';
import { hasActiveTrust } from './assess-risks.js';
import rules from '../../config/templates/person-labels.json';
import { isPhotoDocument } from './photo-document.js';

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

/** 한글 이름 모양: 한글 2~4자. (OCR이 글자 사이에 끼워 넣는 공백은 뺀다) */
const KOREAN_NAME = /^[가-힣]{2,4}$/;

/** 이름의 OCR 신뢰도가 이 값보다 낮으면 믿고 비교하지 않는다. PART 2의 LOW_CONFIDENCE(0.8)와 같은 기준 (#275) */
const MIN_NAME_CONFIDENCE = 0.8;

/**
 * OCR이 이름을 잘못 읽었을 수 있는 사람이 있는지. (#275, #312)
 * 실제 사진에서 "홍길동"을 "BUS"로 읽은 이름을 그대로 비교해 "소유자 ≠ 임대인" STOP이 나온 일이 있었다.
 * OCR로 읽은 이름만 본다. person.confidence가 숫자이면 OCR 이름이고, null이거나 없으면 글자 PDF라서 그대로 믿는다.
 * (글자 PDF의 영문 이름 임대인이 진짜 다른 사람일 때 STOP이 약해지지 않게 하려는 것이다)
 *  - 신뢰도가 기준보다 낮으면 읽기 오류일 수 있다.
 *  - 한글 이름 모양(2~4자)이 아니면 읽기 오류일 수 있다. (회사 이름은 따로 처리하므로 모양 검사에서 뺀다)
 * @param {any[]} people
 */
function hasUnreliableName(people) {
  return people.some((p) => {
    if (typeof p?.confidence !== 'number') return false;
    if (p.confidence < MIN_NAME_CONFIDENCE) return true;
    const name = typeof p?.name === 'string' ? p.name.replace(/\s+/g, '') : '';
    return !COMPANY_NAME.test(name) && !KOREAN_NAME.test(name);
  });
}

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
function comparePeople({ ruleId, members, allowed, memberKey, allowedKey, personGroups, display, displayValues, coOwnerCheck = false }) {
  const memberGroups = resolveGroups(members, personGroups);
  const allowedGroups = resolveGroups(allowed, personGroups);
  const values = displayValues ?? { left: describePeople(display.left), right: describePeople(display.right) };

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
  if (!same) {
    // OCR이 이름을 잘못 읽었을 수 있으면 다른 사람이라고 단정하지 않는다 (#275)
    if (hasUnreliableName([...members, ...allowed])) {
      return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'unreliable_name', values });
    }
    return buildRiskResult(ruleId, RISK_STATUS.STOP, { aliases, values });
  }
  // 공동 소유: 소유자가 2명 이상인데 그중 일부만 임대인으로 서명했다면 나머지 소유자의 동의가 필요하다
  const everyOwnerSigns = [...allowedIds].every((id) => memberIds.has(id));
  if (coOwnerCheck && !everyOwnerSigns) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'co_owner', aliases, values });
  }
  return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { aliases, values });
}

/** 회사 이름으로 보는 글자 (법인은 생년월일이 없어서 이름·생년월일로 사람을 비교할 수 없다) */
const COMPANY_NAME = /주식회사|\(주\)|㈜|유한회사|유한책임회사|합자회사|리츠|법인/;

/** 법인명 목록(PART 2가 넘겨 주는 문자열 배열)을 깨끗한 배열로 */
function companyNamesOf(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n) => typeof n === 'string' && n.trim() !== '').map((n) => n.trim()))];
}

/**
 * 화면 근거 칸용: 사람 정보 + 법인명. (화면 전용: 프롬프트에 넣지 않는다, #250)
 * @param {any[] | null | undefined} people
 * @param {unknown} companies
 */
function describeParties(people, companies) {
  const parts = [];
  const persons = describePeople(people);
  if (persons) parts.push(persons);
  const known = new Set((Array.isArray(people) ? people : []).map((p) => p?.name));
  parts.push(...companyNamesOf(companies).filter((c) => !known.has(c)));
  return parts.length > 0 ? parts.join(', ') : null;
}

const isCompanyName = (/** @type {unknown} */ name) => typeof name === 'string' && COMPANY_NAME.test(name);
const isPersonName = (/** @type {unknown} */ name) =>
  typeof name === 'string' && name.trim() !== '' && !COMPANY_NAME.test(name);

/**
 * 임대인 칸의 법인명만 (화면 전용).
 * 계약서의 "성명(법인명)" 칸 회사는 임차인 칸(사택 등)의 것일 수도 있다.
 * 사람 임대인이 읽혔으면 그 회사는 임대인이 아니라고 보고 쓰지 않는다. (#250 리뷰)
 * @param {any[] | null | undefined} landlords
 * @param {unknown} companies
 */
function landlordCompaniesOf(landlords, companies) {
  const names = companyNamesOf(companies);
  const hasPersonLandlord = Array.isArray(landlords) && landlords.some((p) => isPersonName(p?.name));
  return hasPersonLandlord ? [] : names;
}

/** 임대인이 법인인지: 임대인 칸 법인명이 있거나, 임대인 이름이 회사 이름 */
function isCompanyLandlord(landlords, landlordCompanies) {
  return (
    landlordCompanies.length > 0 || (Array.isArray(landlords) && landlords.some((p) => isCompanyName(p?.name)))
  );
}

/** 예금주가 모두 이름이 있는 개인인지 (없음·빈 배열·회사 이름이면 false) */
function hasPersonHolder(holders) {
  return (
    Array.isArray(holders) &&
    holders.length > 0 &&
    holders.every((p) => typeof p?.name === 'string' && p.name.trim() !== '' && !isCompanyName(p.name))
  );
}

/**
 * 소유자·임대인 비교를 사람 비교로 못 하는 경우인지.
 *  - 소유자나 임대인 이름이 회사 이름이면: 법인은 사람 비교(이름·생년월일)가 맞지 않는다
 *  - 유효한 신탁이 있는데 소유자를 못 읽었으면: 비교할 대상이 수탁자인지 위탁자인지 알 수 없다
 * 유효한 신탁이 있어도 소유자·임대인이 둘 다 사람 이름이면 여기에 해당하지 않는다.
 * (PART 2는 회사(수탁자) 이름을 소유자 명단에 넣지 않아서, 명단에 사람이 있으면 보통 위탁자다.
 *  위탁자도 수탁자도 아닌 사람이 임대인이면 가장 강한 사기 신호라서 STOP을 낮추지 않는다)
 * @param {any} fields
 */
function involvesCompanyOrUnreadOwner(fields) {
  const owners = Array.isArray(fields?.registry?.owners) ? fields.registry.owners : [];
  const landlords = Array.isArray(fields?.contract?.landlords) ? fields.contract.landlords : [];
  if ([...owners, ...landlords].some((p) => typeof p?.name === 'string' && COMPANY_NAME.test(p.name))) return true;
  return hasActiveTrust(fields) && owners.length === 0;
}

/**
 * 등기부 소유자 ↔ 계약서 임대인
 * 회사 이름이 끼어 있거나 신탁이 있는데 소유자를 못 읽었으면 사람 비교로 판정하지 못하므로:
 *  - 다르다고 나와도 STOP이 아니라 CHECK
 *  - 비교하지 못했으면 UNVERIFIABLE (NO_FLAG로 두지 않는다)
 *  - 같다(NO_FLAG)·공동 소유 확인(CHECK.co_owner)은 그대로 둔다
 * 신탁이 있어도 소유자·임대인이 둘 다 사람 이름이고 서로 다르면 STOP을 유지한다.
 */
export function compareOwnerAndLandlord(fields, personGroups) {
  const owners = fields?.registry?.owners;
  const landlords = fields?.contract?.landlords;
  const displayValues = {
    left: describeParties(owners, fields?.registry?.ownerCompanies),
    right: describeParties(landlords, landlordCompaniesOf(landlords, fields?.contract?.landlordCompanies)),
  };
  const result = comparePeople({
    ruleId: 'OWNER_MISMATCH',
    members: landlords,
    allowed: owners,
    memberKey: 'landlord',
    allowedKey: 'owner',
    personGroups,
    display: { left: owners, right: landlords },
    displayValues,
    coOwnerCheck: true,
  });
  if (!result.ok || !involvesCompanyOrUnreadOwner(fields)) return result;

  const { status } = result.data;
  if (status === RISK_STATUS.NO_FLAG || status === RISK_STATUS.CHECK) return result;

  const entityStatus = status === RISK_STATUS.STOP ? RISK_STATUS.CHECK : RISK_STATUS.UNVERIFIABLE;
  return buildRiskResult('OWNER_MISMATCH', entityStatus, { variant: 'entity', values: displayValues });
}

/** 계약서 예금주 ↔ 계약서 임대인 */
export function compareAccountHolderAndLandlord(fields, personGroups) {
  const holders = fields?.contract?.accountHolders;
  const landlords = fields?.contract?.landlords;
  const landlordCompanies = landlordCompaniesOf(landlords, fields?.contract?.landlordCompanies);

  if (isCompanyLandlord(landlords, landlordCompanies) && hasPersonHolder(holders)) {
    return buildRiskResult('ACCOUNT_HOLDER_MISMATCH', RISK_STATUS.CHECK, {
      variant: 'company_landlord',
      values: { left: describePeople(holders), right: describeParties(landlords, landlordCompanies) },
    });
  }
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
 * 호수 앞의 "N층"을 뺀다. 층이 호수의 앞자리와 일치할 때만 뺀다.
 *  - "3동 7층 702호" → "3동 702호"  (7층 ↔ 702호, 1203호 ↔ 12층)
 *  - 층과 호수가 안 맞는 "7층 802호"는 그대로 둔다. (잘못 뺀 채 같은 주소로 보는 일을 막는다)
 *  - 호수가 없는 "7층"만 있는 주소, "지하1층"은 그대로 둔다.
 * 등기부는 "제7층 제702호", 계약서는 "702호"로 적는 경우가 많아서 필요하다. (#141, #143)
 * @param {string} address  괄호와 "제"를 이미 정리한 주소 (공백은 아직 있어도 된다)
 */
function removeFloorBeforeUnit(address) {
  return address.replace(/(?<![0-9]|지하\s*)(\d{1,2})\s*층\s*(\d{3,4})\s*호/g, (whole, floor, unit) =>
    Number(unit.slice(0, -2)) === Number(floor) ? `${unit}호` : whole,
  );
}

/**
 * 주소를 비교하기 쉽게 정리한다.
 * - 괄호 안 내용((새싹동 123-4) 등), 공백, 쉼표 제거
 * - "제2층 제201호" → "2층201호" 처럼 숫자 앞의 "제" 제거
 * - 호수가 있고 층이 호수 앞자리와 맞으면 "N층" 제거 ("3동 7층 702호" → "3동702호")
 * @param {string} address
 */
export function normalizeAddress(address) {
  const cleaned = address.replace(/\([^)]*\)/g, '').replace(/제\s*(?=\d)/g, '');
  return removeFloorBeforeUnit(cleaned).replace(/[\s,]/g, '');
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
 * 건물 "동" 이름: 숫자(103동) 또는 글자 한 개(가동, A동). (#202 리뷰)
 * 글자 한 개일 때는 앞에 글자·숫자가 붙어 있지 않아야 한다.
 * ("가상동"의 "상동"처럼 행정동 이름 끝을 건물 동으로 잘못 읽지 않기 위해서)
 */
const DONG_NAME = '(?:\\d+|(?<![가-힣A-Za-z0-9])[가-힣A-Za-z])';

/**
 * 동 이름을 비교용으로 정리한다. 숫자는 앞의 0을 뺀 숫자 글자로("03" → "3"), 영문은 대문자로("a" → "A").
 * @param {string} name  "103", "가", "A" 처럼 "동"을 뺀 이름
 */
function normalizeDongName(name) {
  return /^\d+$/.test(name) ? String(Number(name)) : name.toUpperCase();
}

/**
 * 지번으로 적힌 등기부 주소에서 동·층·호수 부분만 꺼낸다. (정리한 글자로 돌려준다)
 *  - "…가상동 246-8 가상타운 제3층 제301호" → "301호" (층은 호수와 맞으면 빠진다)
 *  - "…가상아파트 제3동 제7층 제702호" → "3동702호"
 *  - "…가상빌라 가동 제101호" → "가동101호" (동이 글자여도 같다)
 * 호수가 없으면 ''.
 * @param {string} lotAddress
 */
function unitPart(lotAddress) {
  const cleaned = lotAddress.replace(/\([^)]*\)/g, '').replace(/제\s*(?=\d)/g, '');
  const m = new RegExp(`(?:${DONG_NAME}\\s*동\\s*)?(?:\\d+\\s*층\\s*)?\\d{1,4}\\s*호\\s*$`).exec(cleaned.trim());
  return m ? normalizeAddress(m[0]) : '';
}

/**
 * 정리한 글자 안에서 동·호수 조각을 모두 찾는다. (끝에 있지 않아도 된다)
 *  - "301호", "3동702호", "103동702호" → { dong, unit }
 *  - 동이 글자인 "가동101호", "A동101호"도 같은 규칙으로 읽는다. (영문은 대문자로 맞춘다)
 *  - "103-702" → 103동 702호로 맞춘다. (호수 쪽은 3~4자리일 때만. "246-8" 같은 지번 번지는 호수가 아니다)
 *  - 앞에 숫자·"-"가 붙어 있으면 다른 숫자의 일부이므로 찾지 않는다. (13동702호 안의 "3동702호")
 *  - "2호선"은 호수가 아니다.
 *  - 동·리·읍·면·가·로·길·산 바로 뒤의 "123-456"은 지번·도로 번호라서 호수로 보지 않는다.
 * 공백·쉼표를 지우면 "246-8, 301호"가 "246-8301호"로 붙어 버리므로, 공백은 남긴 채 "3동 702호" 같은
 * 동·층·호 사이의 공백만 줄여서 찾는다.
 * @param {string} loose  괄호와 "제"를 정리하고 공백·쉼표를 한 칸 공백으로 줄인 글자
 * @returns {{ dong: string | null, unit: string }[]}
 */
function findUnitTokens(loose) {
  // 전각 글자("Ａ동")는 반각으로 맞춘다. 같은 글자로 비교하기 위해서다.
  const text = loose
    .normalize('NFKC')
    .replace(/(\d)\s+(?=동|층|호)/g, '$1')
    .replace(/(동|층)\s+(?=\d)/g, '$1');
  const pattern = new RegExp(
    `(?<![0-9-])(?:(\\d{1,4})-(\\d{3,4})(?:호)?(?![0-9-])|(?:(${DONG_NAME})동)?(?:\\d{1,2}층)?(\\d{1,4})호(?!선))`,
    'g',
  );
  const tokens = [];
  for (const m of text.matchAll(pattern)) {
    if (m[2] !== undefined) {
      if (/[동리읍면가로길산]$/.test(text.slice(0, m.index).trimEnd())) continue;
      tokens.push({ dong: String(Number(m[1])), unit: String(Number(m[2])) });
    } else {
      tokens.push({ dong: m[3] === undefined ? null : normalizeDongName(m[3]), unit: String(Number(m[4])) });
    }
  }
  return tokens;
}

/**
 * 등기부 [도로명주소]에 호수를 붙여 계약서 도로명 주소와 비교한다. (#177)
 * 표제부 도로명주소는 건물 단위(호수 없음)이고, 계약서는 건물 이름이 앞뒤에 붙기도 해서
 * 글자 전체가 아니라 "도로명+번호가 같은지"와 "계약서에 같은 동·호수가 적혀 있는지"를 따로 본다.
 * 도로 번호와 호수가 붙어 보이지 않게(00 + 301호), 공백·쉼표를 지우기 전의 글자에서 도로 번호를 먼저 자른다.
 *  - 도로명+번호가 다르면 DIFFERENT. 도로 번호 뒤에 숫자나 "-숫자"가 이어져도 다른 번호다. (12 ↔ 123, 315 ↔ 315-2)
 *  - 같으면 계약서 나머지에서 동·호수 조각을 찾는다. 위치는 상관없다. ("301호 중 방 1칸", "301호 가상타운")
 *    · 등기부와 같은 동·호수가 있으면 MATCH
 *    · 호수가 다르거나 동이 서로 다르게 적혀 있으면 DIFFERENT (3동702호 ↔ 13동702호, 가동101호 ↔ 나동101호)
 *    · 호수가 없거나, 한쪽에만 동이 적혀 있어 판단할 수 없으면 UNKNOWN (가동101호 ↔ 101호)
 * @param {string} roadAddress  registry.roadAddress
 * @param {string} registryAddress  registry.address (호수를 가져온다)
 * @param {string} contractAddress  계약서 주소 원문
 *  * @returns {'MATCH' | 'DIFFERENT' | 'DIFFERENT_DIGITS' | 'UNKNOWN'}  DIFFERENT_DIGITS: 숫자(도로 번호, 호수)만 다르다 (#312)
 */
function compareRoadAddress(roadAddress, registryAddress, contractAddress) {
  if (!FORMAL_REGION_START.test(roadAddress.trim())) return 'UNKNOWN';
  const road = normalizeAddress(roadAddress);
  if (addressStyle(road) !== 'ROAD') return 'UNKNOWN';
  const unit = unitPart(registryAddress);

  // 공백·쉼표를 남긴 채 정리한 계약서 주소에서 "…로 00"까지를 자른다.
  const loose = removeFloorBeforeUnit(contractAddress.replace(/\([^)]*\)/g, '').replace(/제\s*(?=\d)/g, ''))
    .replace(/[\s,]+/g, ' ');
  const m = /^(.*?[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)(?![0-9-])/.exec(loose.trim());
  if (!m) return 'UNKNOWN';
  const contractRoad = normalizeAddress(m[1]);
  const rest = normalizeAddress(loose.trim().slice(m[1].length));

  // 호수를 모르면 건물 전체가 같을 때만 같다고 보고, 다르면 확인 불가로 둔다. (건물 이름 차이를 STOP으로 오해하지 않게)
  if (!unit) return contractRoad === road && rest === '' ? 'MATCH' : 'UNKNOWN';
    if (contractRoad !== road) return stripDigits(contractRoad) === stripDigits(road) ? 'DIFFERENT_DIGITS' : 'DIFFERENT';

  const registryUnit = findUnitTokens(unit)[0];
  if (!registryUnit) return 'UNKNOWN';
  const tokens = findUnitTokens(loose.trim().slice(m[1].length));
  if (tokens.length === 0) return 'UNKNOWN'; // 계약서에 호수가 없다

  let ambiguous = false;
  let onlyUnitDiffers = false; // 같은 동인데 호수 숫자만 다르다
  for (const t of tokens) {
    if (t.unit !== registryUnit.unit) {
      if (t.dong === registryUnit.dong) onlyUnitDiffers = true;
      continue; // 다른 호수
    }
    if (t.dong === registryUnit.dong) return 'MATCH'; // 호수도 동도 같다 (둘 다 동이 없는 경우 포함)
    if (t.dong !== null && registryUnit.dong !== null) continue; // 호수는 같지만 동이 다르다
    ambiguous = true; // 한쪽에만 동이 있어서 같은 집인지 알 수 없다
  }
  if (ambiguous) return 'UNKNOWN';
  return onlyUnitDiffers ? 'DIFFERENT_DIGITS' : 'DIFFERENT';
}

/** 숫자를 뺀 글자. 두 주소가 이 글자까지 같으면 숫자만 다른 것이다. (#312) */
const stripDigits = (/** @type {string} */ text) => text.replace(/[0-9]/g, '');

/**
 * 숫자·영문·기호를 모두 빼고 한글만 남긴다.
 * 제·층·호는 등기부와 계약서가 쓰는 방식이 달라서(제2층 제203호 ↔ 2층) 뺀다.
 */
const hangulSkeleton = (/** @type {string} */ address) =>
  normalizeAddress(address).replace(/[^가-힣]/g, '').replace(/[제층호]/g, '');

/** small의 글자가 big 안에 순서대로 모두 들어 있는가 */
function isSubsequence(/** @type {string} */ small, /** @type {string} */ big) {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i += 1;
  return i === small.length;
}

/**
 * 사진·스캔 쪽 주소가 잘못 읽힌 것 같은가. (#343)
 * 사진 쪽에서 읽힌 한글(시·구·동 이름, 건물 이름)이 반대편과 모두 맞으면, 숫자·영문이 어떻게 달라도 읽기 오류로 본다.
 * 한글이 하나라도 다르면 진짜 다른 집일 수 있어서 STOP을 유지한다. ("나상동" ↔ "가상동")
 * 사진에서 못 읽어 빠진 한글은 허용한다. (사진 쪽 한글이 반대편 안에 순서대로 들어 있으면 맞는 것으로 본다)
 */
const looksMisread = (/** @type {string} */ photoAddress, /** @type {string} */ otherAddress) =>
  isSubsequence(hangulSkeleton(photoAddress), hangulSkeleton(otherAddress));

/** 등기부·계약서 중 사진·스캔 서류의 주소가 잘못 읽힌 것 같은가. (#343) */
function photoAddressLooksMisread(/** @type {any} */ fields) {
  const registry = fields?.registry?.address;
  const contract = fields?.contract?.address;
  if (typeof registry !== 'string' || typeof contract !== 'string') return false;
  return (
    (isPhotoDocument(fields.registry) && looksMisread(registry, contract)) ||
    (isPhotoDocument(fields.contract) && looksMisread(contract, registry))
  );
}

/**
 * 등기부 소재지 ↔ 계약서 소재지
 *  - 한쪽이라도 읽지 못했으면 UNVERIFIABLE
 *  - 한쪽이라도 정식 시·도 이름으로 시작하지 않으면 UNVERIFIABLE (region_unclear)
 *    (OCR 오류나 줄임말이면 다른 주소가 아닌데도 달라 보일 수 있다)
 *  - 글자가 같으면 NO_FLAG
 *  - 글자가 다른데 도로명과 지번이 섞였거나 형식을 알 수 없으면 UNVERIFIABLE (format_differs)
 *  - 같은 형식인데 다르면 STOP
 *  *    단, 한쪽이라도 사진·스캔 서류이고 숫자(번지, 호수)만 다르면 CHECK (ocr_digits, #312)
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
  const roadAddress = fields?.registry?.roadAddress;
  const photo = isPhotoDocument(fields?.registry) || isPhotoDocument(fields?.contract);
  /** 숫자만 다르고 사진·스캔 서류이면 CHECK(OCR이 숫자를 잘못 읽었을 수 있다), 아니면 STOP */
  const differentAddress = (/** @type {boolean} */ digitsOnly) => {
    if (photo && digitsOnly) return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'ocr_digits', values });
    // #343: 사진 쪽 주소에 영문이 섞였거나 동·호수를 못 읽었으면 다른 집이라고 단정하지 않는다
    if (photo && photoAddressLooksMisread(fields)) {
      return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'ocr_unreadable', values });
    }
    return buildRiskResult(ruleId, RISK_STATUS.STOP, { values });
  };
  if (registryStyle === 'LOT' && contractStyle === 'ROAD' && roadAddress) {
    const same = compareRoadAddress(roadAddress, registryAddress, contractAddress);
    if (same === 'MATCH') return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { values });
    if (same === 'DIFFERENT' || same === 'DIFFERENT_DIGITS') return differentAddress(same === 'DIFFERENT_DIGITS');
  }
  if (registryStyle === null || registryStyle !== contractStyle) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'format_differs', values });
  }
  return differentAddress(stripDigits(registry) === stripDigits(contract));
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
