// @ts-check
/**
 * PART 4. 계약서 인적사항 칸 요약: 가린 원문에서 인적사항 칸 줄만 요약으로 바꾼다 (지도 교수님 피드백 11/24, 단톡 합의)
 *
 * 왜: 계약서 본문·특약은 자유 문장이라 원문이 있어야 AI가 예상 못 한 위험 문구를 본다. 대신 개인정보는 인적사항 칸에 모여 있고,
 *     표 칸이 섞여 놓친 이름·주소가 새는 곳도 주로 그 칸이다. 그래서 그 칸만 요약으로 바꾸고 나머지는 가린 원문 그대로 둔다.
 *
 * 규칙 (#357 리뷰 반영)
 *  - 사기 점검: 역할마다 가명과 관계("등기부 소유자와 같은 사람", "임대인과 다른 사람")를 적는다.
 *    같은 사람인지 확인 안 된 그룹(AMBIGUOUS)은 역할이 합쳐져 있어도 "확인 안 됨"으로 적는다.
 *    못 읽은 역할(예금주 포함)은 말없이 빼지 않고 "Could not read" / "none found"로 적는다.
 *  - 임대인·소유자가 회사면 회사 이름은 넣지 않는다 (INTERFACES.md 5번: 화면 전용).
 *    대신 등기부 데이터(registryFields)를 주면 회사 이름끼리 비교해 "소유자와 같은 회사 / 다른 회사"를 적는다.
 *  - 조항·계약 설명: 이름을 어차피 다 가리므로 어떤 역할 칸이 있는지만 적는다.
 *  - 범위는 PART 2 extractFields()의 contract.personalInfoRanges(여러 칸) 또는 personalInfoRange(한 칸).
 *    둘 다 없거나, 범위가 줄 수를 넘거나, document를 주었는데 가린 글의 줄 수가 서류 줄 수(PART 2 linesOf)와 다르면
 *    (쪽 표시가 먼저 들어간 글 등) 바꾸지 않고 가린 원문 그대로 돌려준다 (replaced: false). 보내기 전 검사는 그대로 거친다.
 *  - 첫 칸은 요약으로, 나머지 칸(아래쪽 서명 칸 등)은 "내용 가림" 한 줄로 바꾼다.
 *  - 한계: 사용자가 ④에서 칸 안의 값을 보이게(KEEP) 풀어도 그 칸은 요약으로 바뀐다 (요약에는 가명·역할만 들어간다).
 */

import { ok, fail, ERROR_CODE, MASKING_PURPOSE } from '../../shared/document-model.js';
import { aliasOf, companyNames, sameCompany } from './alias-utils.js';

/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */
/** @typedef {{ startLine: number, endLine: number }} LineRange */

const COULD_NOT_READ = 'Could not read';
const HEADER = 'Personal information section of the contract: extracted items (the original lines are not sent).';
const OTHER_SECTION = 'Personal information section of the contract (for example signatures): contents hidden.';
const AMBIGUOUS = 'AMBIGUOUS';

/**
 * PART 2가 준 범위를 정리한다: 배열·한 칸 모두 받고, 서류 줄 수 안에 있는 것만, 겹치면 합쳐서 줄 순서대로.
 * @param {any} contractFields
 * @param {number} lineCount
 * @returns {LineRange[]}
 */
export function normalizeRanges(contractFields, lineCount) {
  const raw = Array.isArray(contractFields?.personalInfoRanges)
    ? contractFields.personalInfoRanges
    : contractFields?.personalInfoRange
      ? [contractFields.personalInfoRange]
      : [];
  const valid = raw
    .filter(
      (/** @type {any} */ r) =>
        Number.isInteger(r?.startLine) && Number.isInteger(r?.endLine) && r.startLine >= 0 && r.startLine <= r.endLine && r.endLine < lineCount,
    )
    .map((/** @type {LineRange} */ r) => ({ startLine: r.startLine, endLine: r.endLine }))
    .sort((/** @type {LineRange} */ a, /** @type {LineRange} */ b) => a.startLine - b.startLine);
  /** @type {LineRange[]} */
  const merged = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, r.endLine);
    else merged.push(r);
  }
  return merged;
}

/**
 * 서류의 줄 수 (PART 2 linesOf와 같은 기준: 쪽 → 블록 → 줄바꿈)
 * @param {any} document
 */
function lineCountOf(document) {
  if (!Array.isArray(document?.pages)) return null;
  return document.pages.reduce(
    (/** @type {number} */ n, /** @type {any} */ p) =>
      n + (Array.isArray(p?.blocks) ? p.blocks.reduce((/** @type {number} */ m, /** @type {any} */ b) => m + String(b?.text ?? '').split('\n').length, 0) : 0),
    0,
  );
}

/**
 * 사람 목록의 그룹들 (findingId로 찾음, 같은 그룹은 한 번). 목록이 null이면 null(못 읽음).
 * @param {any[] | null | undefined} people
 * @param {PersonGroup[]} groups
 */
function groupsOf(people, groups) {
  if (!Array.isArray(people)) return null;
  /** @type {PersonGroup[]} */
  const found = [];
  for (const p of people) {
    const g = groups.find((x) => x.findingIds.includes(p?.findingId));
    if (g && !found.includes(g)) found.push(g);
  }
  return found;
}

/**
 * 사기 점검용 역할 줄: 가명 + 관계
 * @param {any} contractFields
 * @param {any} registryFields
 * @param {PersonGroup[]} groups
 * @param {Record<string, string>} legend
 * @param {boolean} hasBroker
 */
function fraudLines(contractFields, registryFields, groups, legend, hasBroker) {
  /** @param {PersonGroup} g */
  const alias = (g) => aliasOf(g.findingIds[0], groups, legend) ?? g.alias;
  const ownerCompanies = companyNames(registryFields?.ownerCompanies);
  const ownerIsPerson = groups.some((g) => g.roles.includes('OWNER'));
  const ownerIsCompany = ownerCompanies.length > 0;
  const lines = [];

  // 임대인 (사람)
  const landlords = groupsOf(contractFields.landlords, groups);
  const landlordCompanies = companyNames(contractFields.landlordCompanies);
  for (const g of landlords ?? []) {
    // 확인 안 된 그룹은 역할이 합쳐져 있어도 "같은 사람"이라고 하지 않는다
    const relation =
      g.status === AMBIGUOUS
        ? ownerIsPerson || ownerIsCompany
          ? ' (not confirmed whether this is the owner on the register)'
          : ''
        : g.roles.includes('OWNER')
          ? ' (same person as the owner on the register)'
          : ownerIsPerson
            ? ' (a different person from the owner on the register)'
            : ownerIsCompany
              ? ' (an individual, while the owner on the register is a company)'
              : '';
    lines.push(`Landlord: ${alias(g)}${relation}`);
  }
  // 임대인 (회사): 이름은 넣지 않고, 등기부 소유자 회사와 같은지만 적는다
  for (const company of landlordCompanies) {
    const relation = ownerCompanies.some((c) => sameCompany(c, company))
      ? 'the same company as the owner on the register'
      : ownerIsCompany
        ? 'a different company from the owner on the register'
        : ownerIsPerson
          ? 'while the owner on the register is an individual'
          : 'not confirmed whether this is the owner on the register';
    lines.push(`Landlord: a company (name not sent), ${relation}`);
  }
  if ((landlords ?? []).length === 0 && landlordCompanies.length === 0) lines.push(`Landlord: ${COULD_NOT_READ}`);

  // 임차인
  const tenants = groupsOf(contractFields.tenants, groups);
  lines.push(`Tenant: ${tenants === null || tenants.length === 0 ? COULD_NOT_READ : tenants.map(alias).join(', ')}`);

  // 예금주: 보통 인적사항 칸 밖(보증금 칸)에 있지만, 임대인과의 관계는 사기 점검의 핵심이라 함께 적는다.
  // 못 읽었으면(null) "Could not read", 읽었는데 없으면([]) "none found". 말없이 빼면 "문제 없음"으로 읽힌다 (#357 리뷰)
  const holders = groupsOf(contractFields.accountHolders, groups);
  if (holders === null) {
    lines.push(`Payment account holder: ${COULD_NOT_READ}`);
  } else if (holders.length === 0) {
    lines.push(`Payment account holder: ${Array.isArray(contractFields.accountHolders) && contractFields.accountHolders.length > 0 ? COULD_NOT_READ : 'none found'}`);
  } else {
    for (const g of holders) {
      const relation =
        g.status === AMBIGUOUS
          ? ' (not confirmed whether this is the landlord)'
          : g.roles.includes('LANDLORD')
            ? ' (same person as the landlord)'
            : landlordCompanies.length > 0 && (landlords ?? []).length === 0
              ? ' (an individual, while the landlord is a company)'
              : ' (a different person from the landlord)';
      lines.push(`Payment account holder: ${alias(g)}${relation}`);
    }
  }

  if (hasBroker) lines.push('Real estate agent: a section for the agent is present (details hidden)');
  return lines;
}

/**
 * 조항·계약 설명용: 어떤 역할 칸이 있는지만
 * @param {any} contractFields
 * @param {boolean} hasBroker
 */
function roleOnlyLines(contractFields, hasBroker) {
  const has = (/** @type {any} */ list) => Array.isArray(list) && list.length > 0;
  const roles = [
    has(contractFields.landlords) || has(contractFields.landlordCompanies) ? 'landlord' : null,
    has(contractFields.tenants) ? 'tenant' : null,
    hasBroker ? 'real estate agent' : null,
  ].filter(Boolean);
  return [`Parties listed: ${roles.length > 0 ? roles.join(', ') : COULD_NOT_READ} (names, addresses and contact details hidden)`];
}

/**
 * 가린 계약서 글에서 인적사항 칸 줄을 요약으로 바꾼다.
 * @param {{ maskedText: string, contractFields: any, personGroups: PersonGroup[], purpose: string,
 *   legend?: Record<string, string>, lineBlocks?: string[], registryFields?: any, document?: any }} input
 *   maskedText: applyMaskingPlan()의 그 계약서 가린 글 (쪽 표시를 넣기 전)
 *   lineBlocks: applyMaskingPlan()의 그 계약서 lineBlocks. 주면 바꾼 글의 줄 순서에 맞춘 것을 돌려준다 (요약 줄은 null)
 *   registryFields: extractFields()의 registry. 주면 임대인 회사와 소유자 회사가 같은지 적는다
 *   document: 그 계약서 DocumentModel. 주면 가린 글의 줄 수가 서류 줄 수와 같은지 확인한다 (다르면 바꾸지 않음)
 * @returns {import('../../shared/document-model.js').Result<{ documentId: string, text: string, replaced: boolean,
 *   lineBlocks?: (string | null)[] }>}
 */
export function buildContractPartySummary({ maskedText, contractFields, personGroups, purpose, legend = {}, lineBlocks, registryFields, document }) {
  if (typeof maskedText !== 'string' || !contractFields || typeof contractFields.documentId !== 'string') {
    return fail(ERROR_CODE.MISSING_REQUIRED_FIELD, 'Masked contract text or contract fields are missing.');
  }
  const documentId = contractFields.documentId;
  const lines = maskedText.split('\n');
  const blocks = Array.isArray(lineBlocks) && lineBlocks.length === lines.length ? lineBlocks : null;
  const unchanged = () => ok({ documentId, text: maskedText, replaced: false, ...(blocks ? { lineBlocks: [...blocks] } : {}) });

  // 줄 순서가 PART 2 줄 번호와 다른 글(쪽 표시가 먼저 들어간 글 등)이면 엉뚱한 줄을 바꾸게 되므로 바꾸지 않는다 (#357 리뷰)
  const expected = document === undefined ? null : lineCountOf(document);
  if (document !== undefined && expected !== lines.length) return unchanged();

  const ranges = normalizeRanges(contractFields, lines.length);
  if (ranges.length === 0) return unchanged();

  const groups = Array.isArray(personGroups) ? personGroups : [];
  const inRange = (/** @type {number} */ i) => ranges.some((r) => r.startLine <= i && i <= r.endLine);
  // 중개사 칸이 있는지: 칸 이름 낱말("중개사", "중개보조원")은 개인정보가 아니다
  const hasBroker = lines.some((line, i) => inRange(i) && /중\s*개\s*(?:사|보\s*조\s*원)/.test(line));
  const summary = [
    HEADER,
    ...(purpose === MASKING_PURPOSE.FRAUD_CHECK
      ? fraudLines(contractFields, registryFields, groups, legend ?? {}, hasBroker)
      : roleOnlyLines(contractFields, hasBroker)),
  ];

  /** @type {string[]} */
  const out = [];
  /** @type {(string | null)[]} */
  const outBlocks = [];
  lines.forEach((line, i) => {
    const range = ranges.find((r) => r.startLine === i);
    if (range) {
      const replacement = range === ranges[0] ? summary : [OTHER_SECTION];
      out.push(...replacement);
      outBlocks.push(...replacement.map(() => null));
      return;
    }
    if (inRange(i)) return;
    out.push(line);
    outBlocks.push(blocks ? blocks[i] : null);
  });

  return ok({ documentId, text: out.join('\n'), replaced: true, ...(blocks ? { lineBlocks: outBlocks } : {}) });
}
