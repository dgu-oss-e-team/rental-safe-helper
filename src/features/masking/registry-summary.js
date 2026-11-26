// @ts-check
/**
 * PART 4. 등기부 요약: 원문 대신 뽑은 항목만 AI로 보낸다 (지도 교수님 피드백 11/24, 1단계는 사기 점검만)
 *
 * 왜: 보내기 전 검사는 번호 모양·탐지한 값만 잡는다. 표 칸이 섞여 놓친 이름·주소는 원문에 남을 수 있다.
 *     등기부는 칸과 등기목적이 법으로 정해져 있어서, 뽑은 항목만 보내도 사기 점검 질문에 답하는 데 잃는 게 거의 없다.
 *
 * 규칙 (팀 단톡 합의)
 *  - 개인 이름은 가명. 소유자·이전 소유자는 matchPeople() 가명, 개인 권리자는 [Holder_1]부터.
 *    권리자 이름이 소유자·이전 소유자와 같으면 그 사람의 가명을 쓴다.
 *  - 회사 이름(holderIsCompany === true)은 그대로. 애매하면(null) 가명.
 *  - 지금 소유자가 회사인 경우 회사 이름(ownerCompanies)은 넣지 않는다 (INTERFACES.md 5번: 화면 전용).
 *  - 주소는 시·구까지만 (coarsenAddress, 사기 점검 목적의 주소 규칙과 같음).
 *  - 사건번호·접수번호는 넣지 않는다. 등기원인은 아래 목록에 있는 낱말만 넣는다.
 *  - 못 읽은 값(null)은 "Could not read". 말없이 빼지 않는다.
 *  - 알아보지 못한 유효한 등기 줄이 있으면 개수와 "원본 확인 필요"를 적는다.
 *  - 줄마다 검사한다. 걸리면 그 줄의 값을 [hidden]으로 바꿔 다시 검사하고, 그래도 걸리면 그 줄을 뺀다.
 *    가리거나 뺀 줄 수는 hiddenCount로 돌려주고 요약 끝에도 적는다. 원문으로는 돌아가지 않는다.
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { coarsenAddress, unconfirmedAlias } from './create-masking-plan.js';
import { findLeftoverNumber, findLookalikeNumber, findPhotoLeftover } from './masking-validator.js';

/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */
/** @typedef {{ findingId?: string | null, name?: string | null }} RegistryPerson */
/**
 * @typedef {{ kind: string, maxClaimAmount?: number | null, cancelled?: boolean | null, receivedAt?: string | null,
 *   holder?: string | null, holderIsCompany?: boolean | null, cause?: string | null }} RegistryRight
 */

const COULD_NOT_READ = 'Could not read';
const HIDDEN = '[hidden]';

/** 권리 종류 → 영어 이름 (괄호 안 한국어는 AI가 등기부 용어를 설명할 수 있게 넣는다) */
const RIGHT_LABEL = {
  MORTGAGE: 'Mortgage (근저당권)',
  PROVISIONAL_SEIZURE: 'Provisional seizure (가압류)',
  SEIZURE: 'Seizure (압류)',
  TRUST: 'Trust (신탁)',
  JEONSE: 'Jeonse right (전세권)',
  LEASEHOLD: 'Leasehold right (임차권)',
  PROVISIONAL_DISPOSITION: 'Provisional disposition (가처분)',
  PROVISIONAL_REGISTRATION: 'Provisional registration (가등기)',
  AUCTION: 'Auction started (경매개시결정)',
};

/**
 * 넣어도 되는 등기원인 낱말. 긴 것부터 맞춰 본다 ("근저당권설정계약" → "설정계약", "임의경매개시결정" → "경매개시결정").
 * 목록에 없는 등기원인은 넣지 않는다 (사건번호·기관 이름이 섞여 있을 수 있다).
 */
const CAUSE_WORDS = [
  '경매개시결정',
  '가압류결정',
  '가처분결정',
  '임대차계약',
  '설정계약',
  '매매예약',
  '매매',
  '증여',
  '상속',
  '신탁',
  '해지',
  '압류',
  '결정',
];

/**
 * 등기원인에서 목록에 있는 낱말만 남긴다. 괄호(사건번호)와 띄어쓰기는 뺀다. 목록에 없으면 null.
 * @param {string | null | undefined} cause
 */
export function cleanCause(cause) {
  if (typeof cause !== 'string') return null;
  const text = cause.replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '');
  return CAUSE_WORDS.find((word) => text.endsWith(word)) ?? null;
}

/** @param {number} amount */
const won = (amount) => `${amount.toLocaleString('en-US')} KRW`;

/** @param {boolean | null | undefined} cancelled */
const cancelledText = (cancelled) =>
  cancelled === true ? 'cancelled (말소)' : cancelled === false ? 'active' : 'cancellation unclear, check the original';

/**
 * 가명 고르기: personGroups에서 findingId가 든 그룹의 가명.
 * 범례에 "확인 안 된 같은 이름" 가명만 있으면 그것을 쓴다 (가린 원문과 같은 글자가 되게).
 * @param {string | null | undefined} findingId
 * @param {PersonGroup[]} personGroups
 * @param {Record<string, string>} legend
 */
function aliasOf(findingId, personGroups, legend) {
  if (!findingId) return null;
  const group = personGroups.find((g) => g.findingIds.includes(findingId));
  if (!group) return null;
  const unconfirmed = unconfirmedAlias(group.alias);
  return !(group.alias in legend) && unconfirmed in legend ? unconfirmed : group.alias;
}

/**
 * 사람 목록 → 가명 목록 글자. null이면 못 읽음, []이면 없음.
 * @param {RegistryPerson[] | null | undefined} people
 * @param {PersonGroup[]} personGroups
 * @param {Record<string, string>} legend
 * @param {string} emptyText
 */
function peopleText(people, personGroups, legend, emptyText) {
  if (!Array.isArray(people)) return COULD_NOT_READ;
  if (people.length === 0) return emptyText;
  const aliases = people.map((p) => aliasOf(p.findingId, personGroups, legend) ?? '[Person]');
  return [...new Set(aliases)].join(', ');
}

/** 이름 비교용: 띄어쓰기를 뺀다 */
const squash = (/** @type {string} */ s) => s.replace(/\s+/g, '');

/**
 * 요약 한 줄이 보내도 되는지. 원래 이름이 남았거나, 보내기 전 검사가 멈추는 모양이면 false.
 * (보내기 전 검사 validateMaskedText와 같은 검사를 줄마다 미리 해서, 걸리는 값만 골라 가린다)
 * @param {string} line
 * @param {string[]} names  가명으로 바꾼 개인 이름 (띄어쓰기 뺀 것)
 */
function isSafeLine(line, names) {
  const flat = squash(line);
  if (names.some((name) => flat.includes(name))) return false;
  return findLeftoverNumber(line) === null && findLookalikeNumber(line) === null && findPhotoLeftover(line) === null;
}

/**
 * 등기부 추출 데이터로 AI에 보낼 요약을 만든다. 원문은 넣지 않는다.
 * @param {any} registryFields  extractFields()의 registry
 * @param {PersonGroup[]} personGroups  matchPeople() 결과
 * @param {Record<string, string>} [legend]  applyMaskingPlan()의 가명 범례 (가린 원문과 같은 가명을 쓰려고 본다)
 * @returns {import('../../shared/document-model.js').Result<{ documentId: string, text: string, hiddenCount: number }>}
 */
export function buildRegistrySummary(registryFields, personGroups, legend = {}) {
  if (!registryFields || typeof registryFields.documentId !== 'string') {
    return fail(ERROR_CODE.MISSING_REQUIRED_FIELD, 'Registry fields are missing.');
  }
  const groups = Array.isArray(personGroups) ? personGroups : [];
  const known = legend ?? {};

  /** @type {RegistryPerson[]} */
  const registryPeople = [
    ...(Array.isArray(registryFields.owners) ? registryFields.owners : []),
    ...(Array.isArray(registryFields.previousOwners) ? registryFields.previousOwners : []),
  ];
  /** @type {RegistryRight[] | null} */
  const rights = Array.isArray(registryFields.rights) ? registryFields.rights : null;

  // 개인 권리자 가명: 소유자·이전 소유자와 이름이 같으면 그 가명, 아니면 [Holder_1]부터 (같은 이름은 같은 가명)
  /** @type {Map<string, string>} */
  const holderAlias = new Map();
  /** @param {string} holder */
  const aliasOfHolder = (holder) => {
    const key = squash(holder);
    const same = registryPeople.find((p) => typeof p.name === 'string' && squash(p.name) === key);
    const alias = same ? aliasOf(same.findingId, groups, known) : null;
    if (alias) return alias;
    if (!holderAlias.has(key)) holderAlias.set(key, `[Holder_${holderAlias.size + 1}]`);
    return /** @type {string} */ (holderAlias.get(key));
  };

  // 검사에 쓸 개인 이름: 소유자·이전 소유자, 회사가 아닌 권리자 (두 글자 이상만, 한 글자는 낱말과 부딪힌다)
  const names = [
    ...registryPeople.map((p) => p.name),
    ...(rights ?? []).filter((r) => r.holderIsCompany !== true).map((r) => r.holder),
  ]
    .filter((n) => typeof n === 'string')
    .map((n) => squash(/** @type {string} */ (n)))
    .filter((n) => n.length >= 2);

  /**
   * 요약 줄. render(true)는 바꿀 수 있는 값을 [hidden]으로 바꾼 줄이다.
   * @type {{ render: (hide: boolean) => string }[]}
   */
  const lines = [];
  /** @param {(hide: boolean) => string} render */
  const add = (render) => lines.push({ render });

  const address = typeof registryFields.address === 'string' ? coarsenAddress(registryFields.address) : '';
  add((hide) => `Address: ${hide ? HIDDEN : address || COULD_NOT_READ}`);

  // 지금 소유자가 회사면(신탁이면 수탁자) owners에는 사람이 없다. 회사 이름은 넣지 않고 회사라는 것만 적는다.
  const ownerCompany = Array.isArray(registryFields.ownerCompanies) && registryFields.ownerCompanies.length > 0;
  const ownerPeople = Array.isArray(registryFields.owners) && registryFields.owners.length > 0;
  const owners = ownerCompany
    ? ownerPeople
      ? `${peopleText(registryFields.owners, groups, known, '')} and a company (name not sent)`
      : 'a company (name not sent)'
    : peopleText(registryFields.owners, groups, known, 'none found');
  add((hide) => `Current owner: ${hide ? HIDDEN : owners}`);

  const previous = peopleText(registryFields.previousOwners, groups, known, 'none');
  add((hide) => `Previous owners: ${hide ? HIDDEN : previous}`);

  const lastTransfer = registryFields.lastTransferDate;
  // null은 "소유권보존만 있음"과 "못 읽음"이 섞여 있다 (INTERFACES.md 5번)
  add(() => `Last ownership transfer: ${typeof lastTransfer === 'string' ? lastTransfer : 'not found'}`);

  if (rights === null) {
    add(() => `Rights and restrictions: ${COULD_NOT_READ}`);
  } else if (rights.length === 0) {
    add(() => 'Rights and restrictions: none recorded');
  } else {
    add(() => 'Rights and restrictions:');
    for (const right of rights) {
      const label = RIGHT_LABEL[/** @type {keyof typeof RIGHT_LABEL} */ (right.kind)] ?? 'Other record';
      const received = typeof right.receivedAt === 'string' ? right.receivedAt : COULD_NOT_READ;
      const cause = cleanCause(right.cause);
      const amount =
        right.kind === 'MORTGAGE'
          ? `, max claim ${typeof right.maxClaimAmount === 'number' ? won(right.maxClaimAmount) : COULD_NOT_READ}`
          : '';
      const holder =
        typeof right.holder !== 'string' || right.holder.trim() === ''
          ? COULD_NOT_READ
          : right.holderIsCompany === true
            ? right.holder.trim()
            : `${aliasOfHolder(right.holder)} (an individual)`;
      add(
        (hide) =>
          `- ${label}: received ${received}${cause ? `, cause ${cause}` : ''}${amount}, holder ${hide ? HIDDEN : holder}, ${cancelledText(right.cancelled)}`,
      );
    }
  }

  const unknown = registryFields.unknownActiveCount;
  if (typeof unknown === 'number' && unknown > 0) {
    add(() => `Unconfirmed register records: ${unknown} (could not read what they are, check the original register)`);
  } else if (unknown === null) {
    add(() => 'Other register records: could not check, check the original register');
  }

  // 줄마다 검사: 값 가림 → 다시 검사 → 줄 빼기
  /** @type {string[]} */
  const out = ['Extracted items from the property register (the original register text is not sent).'];
  let hiddenCount = 0;
  for (const line of lines) {
    const full = line.render(false);
    if (isSafeLine(full, names)) {
      out.push(full);
      continue;
    }
    const hidden = line.render(true);
    hiddenCount += 1;
    if (hidden !== full && isSafeLine(hidden, names)) out.push(hidden);
  }
  if (hiddenCount > 0) out.push(`${hiddenCount} item${hiddenCount === 1 ? '' : 's'} hidden (check the original register)`);

  return ok({ documentId: registryFields.documentId, text: out.join('\n'), hiddenCount });
}
