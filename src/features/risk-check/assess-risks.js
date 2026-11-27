/**
 * 등기부 권리와 소유권 이전을 점검하는 규칙 7개.
 *   1) 신탁 등기                  (TRUST_REGISTERED)
 *   2) 압류·가압류                (SEIZURE_ACTIVE)
 *   3) 가처분                     (PROVISIONAL_DISPOSITION_ACTIVE)
 *   4) 경매개시결정               (AUCTION_ACTIVE)
 *   5) 가등기                     (PROVISIONAL_REGISTRATION_ACTIVE)
 *   6) 근저당 + 보증금 비교 표시   (MORTGAGE_EXISTS)
 *   7) 최근 소유권 이전           (RECENT_OWNERSHIP_CHANGE)
 *
 * 규칙 (docs/INTERFACES.md 5번 null 규칙)
 *  - rights가 null(못 읽음)이면 "없음"이 아니라 UNVERIFIABLE
 *  - rights가 [](읽었는데 없음)이면 NO_FLAG
 *  - cancelled === true(말소됨)인 권리는 점검에서 뺀다
 *  - cancelled === null(말소 여부를 모름)인 권리는 CHECK ("말소됐는지 확인 필요")
 *    (가처분·경매개시결정·가등기는 CHECK가 아니라 UNVERIFIABLE)
 *  - 가처분·경매개시결정·가등기: unknownActiveCount가 0이 아니면(1 이상, 없음, null, NaN, 음수)
 *    NO_FLAG 대신 UNVERIFIABLE. 못 읽은 줄 안에 숨어 있을 수 있기 때문이다. (#345)
 *  - 보증금 또는 채권최고액을 못 읽으면 두 금액을 비교하지 않고, 이유를 설명에 적는다
 *  - 날짜가 없거나 'YYYY-MM-DD' 형식이 아니면 UNVERIFIABLE
 * 문구는 src/config/rules/risk-rules.yaml 에 있다.
 */

import { ok, RISK_STATUS } from '../../shared/document-model.js';
import { buildRiskResult } from './risk-explanations.js';
import { getRuleParam } from './risk-rules.js';
import { normalizeTerm } from './special-terms.js';

/** PART 2 findRegistryRights()가 주는 권리 종류 이름 */
const KIND = Object.freeze({
  MORTGAGE: 'MORTGAGE',
  SEIZURE: 'SEIZURE',
  PROVISIONAL_SEIZURE: 'PROVISIONAL_SEIZURE',
  TRUST: 'TRUST',
  PROVISIONAL_DISPOSITION: 'PROVISIONAL_DISPOSITION',
  AUCTION: 'AUCTION',
  PROVISIONAL_REGISTRATION: 'PROVISIONAL_REGISTRATION',
});

const KIND_LABEL = {
  [KIND.MORTGAGE]: 'mortgage',
  [KIND.SEIZURE]: 'seizure',
  [KIND.PROVISIONAL_SEIZURE]: 'provisional seizure',
  [KIND.TRUST]: 'trust',
  [KIND.PROVISIONAL_DISPOSITION]: 'provisional disposition',
  [KIND.AUCTION]: 'auction',
  [KIND.PROVISIONAL_REGISTRATION]: 'provisional registration',
};

/** 최근 소유권 이전으로 보는 기간의 기본값 (규칙 파일의 params.withinMonths가 우선) */
const DEFAULT_WITHIN_MONTHS = 6;

/** 읽지 못한 값을 화면 근거 칸에 보여 줄 때 쓴다 */
const NO_VALUE = { left: null, right: null };

/**
 * 등기부 권리 목록. 못 읽었거나 형식이 이상하면 null.
 * @param {any} fields
 * @returns {any[] | null}
 */
function readRights(fields) {
  const rights = fields?.registry?.rights;
  return Array.isArray(rights) ? rights : null;
}

/**
 * 등기부에서 알아보지 못한 유효 줄 수. 0 이상의 정수가 아니면(없음·null·NaN·음수·소수) null = 확인 못 함.
 * @param {any} fields
 * @returns {number | null}
 */
function readUnknownActiveCount(fields) {
  const n = fields?.registry?.unknownActiveCount;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 종류별로 "유효한 권리"와 "말소 여부를 모르는 권리"를 나눈다. 말소된 권리는 뺀다.
 * @param {any[]} rights
 * @param {string[]} kinds
 */
function splitRights(rights, kinds) {
  const mine = rights.filter((r) => kinds.includes(r?.kind));
  return {
    active: mine.filter((r) => r.cancelled === false),
    unclear: mine.filter((r) => r.cancelled !== false && r.cancelled !== true),
  };
}

/** @param {any[]} active */
function describeActive(active) {
  if (active.length === 0) return '0 active';
  const kinds = [...new Set(active.map((r) => KIND_LABEL[r.kind] ?? r.kind))].join(', ');
  return `${active.length} active (${kinds})`;
}

/**
 * 0보다 큰 유한한 숫자만 금액으로 인정한다. 아니면 null.
 * @param {unknown} value
 * @returns {number | null}
 */
function validAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** @param {number | null} amount */
const formatKRW = (amount) => (amount === null ? null : `KRW ${amount.toLocaleString('en-US')}`);

/**
 * 신탁·압류처럼 "있으면 위험"인 권리 규칙의 공통 판정.
 * @param {any} fields
 * @param {{ ruleId: string, kinds: string[], activeStatus: string, activeVariant?: string, strict?: boolean }} rule
 *   activeVariant: 유효한 권리가 있을 때 쓸 문구 변형 (예: 'trust_notice')
 *   strict: true면 (가처분·경매개시결정·가등기, #345)
 *     - 말소 여부를 모르는 기록만 있을 때 CHECK가 아니라 UNVERIFIABLE
 *     - 기록이 없어도 unknownActiveCount가 0이 아니면 NO_FLAG 대신 UNVERIFIABLE
 *     유효한 기록이 있으면 STOP/CHECK 그대로 둔다.
 */
function assessRightsRule(fields, { ruleId, kinds, activeStatus, activeVariant, strict = false }) {
  const rights = readRights(fields);
  if (!rights) return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values: NO_VALUE });

  const { active, unclear } = splitRights(rights, kinds);
  const values = { left: describeActive(active), right: String(unclear.length) };

  if (active.length > 0) return buildRiskResult(ruleId, activeStatus, { variant: activeVariant, values });
  if (unclear.length > 0) {
    const status = strict ? RISK_STATUS.UNVERIFIABLE : RISK_STATUS.CHECK;
    return buildRiskResult(ruleId, status, { variant: 'cancel_unknown', values });
  }
  // 못 읽은 줄 안에 숨어 있을 수 있으니 말없이 NO_FLAG로 보내지 않는다.
  // (1 이상일 때 CHECK로 올릴지는 팀 확인 후 결정. 지금은 UNVERIFIABLE)
  if (strict && readUnknownActiveCount(fields) !== 0) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { variant: 'unread_rows', values });
  }
  return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { values });
}

/** 특약의 신탁 안내를 찾는 기본 설정 (규칙 파일의 TRUST_REGISTERED.params가 우선) */
const DEFAULT_NOTICE_WORDS = ['수탁자', '신탁회사', '동의서'];
const DEFAULT_EXCLUDE_WORDS = ['말소', '아닌', '아니', '않', '없이', '받지'];
const DEFAULT_NOTICE_WINDOW_LINES = 2;

/** 새 조항이 시작하는 줄. 줄 묶음은 여기서 끊는다. ("제18조", "특) 제18조", "1.", "2)", "①") */
const CLAUSE_START = /^\s*(?:특\)\s*)?제\s*\d+\s*조|^\s*\d+\s*[.)]|^\s*[①-⑳]/;

/**
 * 유효한(말소되지 않은) 신탁 등기가 있는지. 못 읽었거나 말소 여부를 모르면 false.
 * @param {any} fields
 */
export function hasActiveTrust(fields) {
  const rights = readRights(fields);
  return !!rights && rights.some((r) => r?.kind === KIND.TRUST && r.cancelled === false);
}

/**
 * 계약서 특약에 신탁 안내가 있는지.
 * "신탁"이라는 낱말 하나만으로는 안내로 보지 않는다. 안내 낱말(수탁자 / 신탁회사 / 동의서)이 있고,
 * 그 낱말 자리를 빼고도 "신탁"이 따로 있어야 한다. ("신탁회사" 안의 "신탁" 하나로 두 조건을 채우지 못하게)
 * 특약은 줄 단위로 넘어오고 한 조항이 여러 줄이라서 가까운 줄(기본 2줄)을 한 묶음으로 보되,
 * 새 조항이 시작되는 줄("제N조", "N.", "①")에서는 묶음을 끊는다. (서로 다른 조항이 합쳐지지 않게)
 * 같은 묶음에 excludeWords(말소, 아닌, 않, 없이 등)가 있으면 안내로 보지 않는다.
 * ("잔금 전까지 신탁등기를 말소한다", "신탁회사가 아닌 임대인 계좌", "수탁자의 동의는 받지 않았다"는 안내가 아니라 위험 신호다)
 * 신탁 안내가 있다고 안전하다는 뜻은 아니다. (위조 계약서에도 이 문구는 쓸 수 있다)
 * @param {unknown} specialTerms  fields.contract.specialTerms (못 읽으면 null)
 */
export function hasTrustNotice(specialTerms) {
  if (!Array.isArray(specialTerms)) return false;
  const rawLines = specialTerms.filter((t) => typeof t === 'string');

  const readWords = (name, fallback) => {
    const configured = getRuleParam('TRUST_REGISTERED', name, fallback);
    return (Array.isArray(configured) ? configured : fallback)
      .filter((w) => typeof w === 'string' && w.trim() !== '')
      .map(normalizeTerm);
  };
  // 긴 낱말부터 지운다. (낱말끼리 겹칠 때 짧은 낱말이 먼저 지워지지 않게)
  const words = readWords('noticeWords', DEFAULT_NOTICE_WORDS).sort((a, b) => b.length - a.length);
  const excludeWords = readWords('excludeWords', DEFAULT_EXCLUDE_WORDS);
  const configuredWindow = getRuleParam('TRUST_REGISTERED', 'noticeWindowLines', DEFAULT_NOTICE_WINDOW_LINES);
  const windowLines = Number.isInteger(configuredWindow) && configuredWindow > 0 ? configuredWindow : DEFAULT_NOTICE_WINDOW_LINES;

  for (let i = 0; i < rawLines.length; i += 1) {
    let end = i + 1;
    while (end < rawLines.length && end < i + windowLines && !CLAUSE_START.test(rawLines[end])) end += 1;
    const text = normalizeTerm(rawLines.slice(i, end).join(' '));

    if (excludeWords.some((w) => text.includes(w))) continue;
    if (!words.some((w) => text.includes(w))) continue;
    const rest = words.reduce((acc, w) => acc.split(w).join(' '), text);
    if (rest.includes('신탁')) return true;
  }
  return false;
}

/**
 * 신탁 등기: 있으면 STOP (수탁자 동의 없이 맺은 임대차는 효력이 없을 수 있다)
 * 단, 계약서 특약에 신탁 안내가 있으면 CHECK로 낮추고 확인할 4가지를 알린다. (리츠·기업형 임대 등 정상적인 신탁도 있다)
 * 낮추더라도 NO_FLAG는 쓰지 않는다. 신탁 안내가 없거나 특약을 못 읽었으면 STOP 그대로다.
 */
export function assessTrust(fields) {
  const notice = hasActiveTrust(fields) && hasTrustNotice(fields?.contract?.specialTerms);
  return assessRightsRule(fields, {
    ruleId: 'TRUST_REGISTERED',
    kinds: [KIND.TRUST],
    activeStatus: notice ? RISK_STATUS.CHECK : RISK_STATUS.STOP,
    activeVariant: notice ? 'trust_notice' : undefined,
  });
}

/** 압류·가압류: 있으면 STOP */
export function assessSeizure(fields) {
  return assessRightsRule(fields, {
    ruleId: 'SEIZURE_ACTIVE',
    kinds: [KIND.SEIZURE, KIND.PROVISIONAL_SEIZURE],
    activeStatus: RISK_STATUS.STOP,
  });
}

/** 가처분: 말소되지 않은 기록이 있으면 STOP */
export function assessProvisionalDisposition(fields) {
  return assessRightsRule(fields, {
    ruleId: 'PROVISIONAL_DISPOSITION_ACTIVE',
    kinds: [KIND.PROVISIONAL_DISPOSITION],
    activeStatus: RISK_STATUS.STOP,
    strict: true,
  });
}

/** 경매개시결정: 말소되지 않은 기록이 있으면 STOP */
export function assessAuction(fields) {
  return assessRightsRule(fields, {
    ruleId: 'AUCTION_ACTIVE',
    kinds: [KIND.AUCTION],
    activeStatus: RISK_STATUS.STOP,
    strict: true,
  });
}

/** 가등기: 말소되지 않은 기록이 있으면 CHECK (정상적인 가등기도 있어서 STOP은 아니다) */
export function assessProvisionalRegistration(fields) {
  return assessRightsRule(fields, {
    ruleId: 'PROVISIONAL_REGISTRATION_ACTIVE',
    kinds: [KIND.PROVISIONAL_REGISTRATION],
    activeStatus: RISK_STATUS.CHECK,
    strict: true,
  });
}

/**
 * 근저당: 있으면 CHECK. 채권최고액(합계)과 보증금을 나란히 보여 준다.
 * 보증금이나 채권최고액을 못 읽으면 비교하지 않고, 근저당이 있다는 사실과 이유만 알린다.
 */
export function assessMortgage(fields) {
  const ruleId = 'MORTGAGE_EXISTS';
  const deposit = validAmount(fields?.contract?.deposit);
  const depositText = formatKRW(deposit);

  const rights = readRights(fields);
  if (!rights) {
    return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values: { left: null, right: depositText } });
  }

  const { active, unclear } = splitRights(rights, [KIND.MORTGAGE]);
  if (active.length === 0 && unclear.length === 0) {
    return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { values: { left: null, right: depositText } });
  }
  if (active.length === 0) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, {
      variant: 'cancel_unknown',
      values: { left: null, right: depositText },
    });
  }

  const amounts = active.map((r) => validAmount(r.maxClaimAmount));
  if (amounts.some((a) => a === null)) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, {
      variant: 'amount_unknown',
      values: { left: null, right: depositText },
    });
  }

  const maxClaimText = /** @type {string} */ (formatKRW(amounts.reduce((sum, a) => sum + /** @type {number} */ (a), 0)));
  if (deposit === null) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, {
      variant: 'deposit_unknown',
      params: { maxClaim: maxClaimText },
      values: { left: maxClaimText, right: null },
    });
  }
  return buildRiskResult(ruleId, RISK_STATUS.CHECK, {
    params: { maxClaim: maxClaimText, deposit: /** @type {string} */ (depositText) },
    values: { left: maxClaimText, right: depositText },
  });
}

/**
 * 'YYYY-MM-DD' 문자열을 날짜로 바꾼다. 형식이 틀리거나 없는 날짜(2025-02-30)면 null.
 * @param {unknown} text
 * @returns {Date | null}
 */
export function parseIsoDate(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const same = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return same ? date : null;
}

/**
 * 날짜에서 n개월을 뺀다. 그 달에 없는 날이면 그 달의 마지막 날로 맞춘다. (3월 31일 − 1개월 = 2월 28일)
 * @param {Date} date
 * @param {number} months
 */
export function subtractMonths(date, months) {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

/** 최근 소유권 이전: 마지막 소유권이전 접수일이 계약일 기준 N개월 안이면 CHECK */
export function assessOwnershipTransfer(fields) {
  const ruleId = 'RECENT_OWNERSHIP_CHANGE';
  const rawTransfer = fields?.registry?.lastTransferDate;
  const rawContract = fields?.contract?.contractDate;
  const values = {
    left: typeof rawTransfer === 'string' ? rawTransfer : null,
    right: typeof rawContract === 'string' ? rawContract : null,
  };

  const transfer = parseIsoDate(rawTransfer);
  const contract = parseIsoDate(rawContract);
  if (!transfer || !contract) return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values });

  const configured = getRuleParam(ruleId, 'withinMonths', DEFAULT_WITHIN_MONTHS);
  const months = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_WITHIN_MONTHS;

  // 접수일이 계약일보다 늦으면 "계약일 전 N개월 안"이 아니라 계약 뒤에 바뀐 것이다. 문구만 따로 쓴다.
  if (transfer.getTime() > contract.getTime()) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'after_contract', values });
  }

  const recent = transfer.getTime() >= subtractMonths(contract, months).getTime();
  return buildRiskResult(ruleId, recent ? RISK_STATUS.CHECK : RISK_STATUS.NO_FLAG, {
    params: { months },
    values,
  });
}

/**
 * 등기부 관련 점검 7개를 모두 실행한다. 규칙 파일 오류로 하나라도 실패하면 그 오류를 그대로 돌려준다.
 * @param {any} fields  extractFields() 결과
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').RiskResult[]>}
 */
export function assessRegistryRisks(fields) {
  const results = [];
  for (const run of [
    assessTrust,
    assessSeizure,
    assessProvisionalDisposition,
    assessAuction,
    assessProvisionalRegistration,
    assessMortgage,
    assessOwnershipTransfer,
  ]) {
    const r = run(fields);
    if (!r.ok) return r;
    results.push(r.data);
  }
  return ok(results);
}
