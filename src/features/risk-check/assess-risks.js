// @ts-check
/**
 * 등기부 권리와 소유권 이전을 점검하는 규칙 4개.
 *   1) 신탁 등기                  (TRUST_REGISTERED)
 *   2) 압류·가압류                (SEIZURE_ACTIVE)
 *   3) 근저당 + 보증금 비교 표시   (MORTGAGE_EXISTS)
 *   4) 최근 소유권 이전           (RECENT_OWNERSHIP_CHANGE)
 *
 * 규칙 (docs/INTERFACES.md 5번 null 규칙)
 *  - rights가 null(못 읽음)이면 "없음"이 아니라 UNVERIFIABLE
 *  - rights가 [](읽었는데 없음)이면 NO_FLAG
 *  - cancelled === true(말소됨)인 권리는 점검에서 뺀다
 *  - cancelled === null(말소 여부를 모름)인 권리는 CHECK ("말소됐는지 확인 필요")
 *  - 보증금 또는 채권최고액을 못 읽으면 두 금액을 비교하지 않고, 이유를 설명에 적는다
 *  - 날짜가 없거나 'YYYY-MM-DD' 형식이 아니면 UNVERIFIABLE
 * 문구는 src/config/rules/risk-rules.yaml 에 있다.
 */

import { ok, RISK_STATUS } from '../../shared/document-model.js';
import { buildRiskResult } from './risk-explanations.js';
import { getRuleParam } from './risk-rules.js';

/** PART 2 findRegistryRights()가 주는 권리 종류 이름 */
const KIND = Object.freeze({
  MORTGAGE: 'MORTGAGE',
  SEIZURE: 'SEIZURE',
  PROVISIONAL_SEIZURE: 'PROVISIONAL_SEIZURE',
  TRUST: 'TRUST',
});

const KIND_LABEL = {
  [KIND.MORTGAGE]: 'mortgage',
  [KIND.SEIZURE]: 'seizure',
  [KIND.PROVISIONAL_SEIZURE]: 'provisional seizure',
  [KIND.TRUST]: 'trust',
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
 * @param {{ ruleId: string, kinds: string[], activeStatus: string }} rule
 */
function assessRightsRule(fields, { ruleId, kinds, activeStatus }) {
  const rights = readRights(fields);
  if (!rights) return buildRiskResult(ruleId, RISK_STATUS.UNVERIFIABLE, { values: NO_VALUE });

  const { active, unclear } = splitRights(rights, kinds);
  const values = { left: describeActive(active), right: String(unclear.length) };

  if (active.length > 0) return buildRiskResult(ruleId, activeStatus, { values });
  if (unclear.length > 0) {
    return buildRiskResult(ruleId, RISK_STATUS.CHECK, { variant: 'cancel_unknown', values });
  }
  return buildRiskResult(ruleId, RISK_STATUS.NO_FLAG, { values });
}

/** 신탁 등기: 있으면 STOP (수탁자 동의 없이 맺은 임대차는 효력이 없을 수 있다) */
export function assessTrust(fields) {
  return assessRightsRule(fields, {
    ruleId: 'TRUST_REGISTERED',
    kinds: [KIND.TRUST],
    activeStatus: RISK_STATUS.STOP,
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

  const recent = transfer.getTime() >= subtractMonths(contract, months).getTime();
  return buildRiskResult(ruleId, recent ? RISK_STATUS.CHECK : RISK_STATUS.NO_FLAG, {
    params: { months },
    values,
  });
}

/**
 * 등기부 관련 점검 4개를 모두 실행한다. 규칙 파일 오류로 하나라도 실패하면 그 오류를 그대로 돌려준다.
 * @param {any} fields  extractFields() 결과
 * @returns {import('../../shared/document-model.js').Result<import('../../shared/document-model.js').RiskResult[]>}
 */
export function assessRegistryRisks(fields) {
  const results = [];
  for (const run of [assessTrust, assessSeizure, assessMortgage, assessOwnershipTransfer]) {
    const r = run(fields);
    if (!r.ok) return r;
    results.push(r.data);
  }
  return ok(results);
}