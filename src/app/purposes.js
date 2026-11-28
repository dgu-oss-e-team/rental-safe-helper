// @ts-check
/**
 * PART 5. 목적(무엇을 AI에 물어볼지)마다 화면에 보여 줄 글과 필요한 서류 (기능 개선 목록 1번, #380)
 *
 * ① 화면에서 목적을 먼저 고르면, 그 목적에 맞게 서류 칸에 Required / Optional / Recommended를 붙인다.
 * 필요한 서류가 없어도 막지 않는다. 없는 서류로 하는 점검은 "Could not check"로 나온다.
 * 목적별로 AI에 무엇을 보내는지는 masking 설정(send-mode.json, #361)이 정한다. 여기서는 글만 맞춘다.
 */

import { MASKING_PURPOSE, DOCUMENT_TYPE } from '../shared/document-model.js';
// send-mode.json만 읽는 가벼운 함수 (masking/index.js는 무거워서 이 파일을 직접 불러온다)
import { getSendMode, SEND_MODE } from '../features/masking/send-mode.js';

/** @typedef {'required' | 'optional' | 'recommended'} DocNeed */
/** @typedef {'registry' | 'lease'} DocSlot */

/**
 * @typedef {{
 *   value: string,
 *   title: string,
 *   recommended: boolean,
 *   questions: string[],
 *   needsText: string,
 *   needs: Record<DocSlot, DocNeed>,
 *   sendsText: string,
 * }} PurposeInfo
 *   sendsText: AI에 무엇을 보내는지 한 줄 (② 결과 화면 "You chose · Change", #381). 옛 목적 화면 설명을 옮겼다.
 *     등기부를 보내지 않는다는 말은 여기 쓰지 않고 sendsTextOf()가 send-mode.json을 보고 붙인다 (#380 리뷰).
 */

/** @type {PurposeInfo[]} 화면에 보이는 순서 (첫 번째가 기본 선택) */
export const PURPOSES = [
  {
    value: MASKING_PURPOSE.FRAUD_CHECK,
    title: 'Check fraud risks',
    recommended: true,
    questions: ['Is the landlord the same person as the owner?', 'Is the mortgage too large for my deposit?'],
    needsText: 'Needs: property register + lease contract',
    needs: { registry: 'required', lease: 'required' },
    // send-mode.json: 등기부 SUMMARY, 계약서 인적사항 칸 PARTY_SUMMARY
    sendsText: 'Sends a short summary of the property register and the contract. Names become role names like [Owner_A], and only the city and district of the address are kept.',
  },
  {
    value: MASKING_PURPOSE.CLAUSE_EXPLANATION,
    title: 'Explain clauses and terms',
    recommended: false,
    questions: ['What does 근저당권 (mortgage) mean?', 'What is 확정일자 and why do I need it?'],
    needsText: 'Needs: the document you want explained',
    needs: { registry: 'optional', lease: 'optional' },
    sendsText: 'Sends the text of your documents so the AI can explain each part and the legal terms. All names, numbers and addresses are hidden.',
  },
  {
    value: MASKING_PURPOSE.CONTRACT_EXPLANATION,
    title: 'Explain contract conditions',
    recommended: false,
    questions: ['When do I get my deposit back?', 'Can the landlord raise the rent during the contract?'],
    needsText: 'Needs: lease contract',
    // 등기부는 이 목적에서 AI로 보내지 않는다 (send-mode.json: CONTRACT_EXPLANATION → 등기부 OMIT). 점검에만 쓴다.
    needs: { registry: 'recommended', lease: 'required' },
    sendsText: 'Sends the contract, to ask about the deposit, rent, period and special terms. All names, numbers and addresses are hidden.',
  },
];

/**
 * AI에 무엇을 보내는지 한 줄. 등기부를 보내지 않는 목적(send-mode.json이 OMIT)이면 그 말을 덧붙인다.
 * @param {PurposeInfo} p
 */
export function sendsTextOf(p) {
  const omitRegistry = getSendMode(p.value, DOCUMENT_TYPE.REGISTRY) === SEND_MODE.OMIT;
  return omitRegistry ? `${p.sendsText} The property register is not sent.` : p.sendsText;
}

/** 칸 옆 표시 글 */
export const NEED_LABEL = /** @type {const} */ ({ required: 'Required', optional: 'Optional', recommended: 'Recommended' });

/** 서류 이름 (안내 문장용) */
const DOC_NAME = /** @type {const} */ ({ registry: 'property register', lease: 'lease contract' });

/**
 * @param {string} purpose
 * @returns {PurposeInfo}
 */
export function purposeInfo(purpose) {
  return PURPOSES.find((p) => p.value === purpose) ?? PURPOSES[0];
}

/**
 * 고른 목적에 필요한 서류가 빠졌을 때 칸 아래에 보여 줄 안내 (막지 않음).
 * 아무 서류도 없으면 null (그때는 "Check my documents" 버튼이 꺼져 있다).
 * 서류 내용·파일 이름은 넣지 않는다.
 * @param {string} purpose
 * @param {{ registry: unknown, lease: unknown }} files
 * @returns {string[]}
 */
export function missingDocNotices(purpose, files) {
  const has = { registry: Boolean(files.registry), lease: Boolean(files.lease) };
  if (!has.registry && !has.lease) return [];
  const info = purposeInfo(purpose);
  /** @type {string[]} */
  const out = [];
  for (const slot of /** @type {DocSlot[]} */ (['registry', 'lease'])) {
    if (has[slot]) continue;
    const need = info.needs[slot];
    // Recommended(계약 조건 설명의 등기부)는 칸 자리의 "Also check for fraud warning signs?" 상자가 대신 알려 준다
    if (need === 'required') {
      out.push(`${info.title} works best with the ${DOC_NAME[slot]}. Without it, some checks will show "Could not check". You can add it now, or continue anyway.`);
    }
  }
  return out;
}
