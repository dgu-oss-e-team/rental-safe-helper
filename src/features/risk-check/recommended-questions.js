// @ts-check
/**
 * 목적별 AI 추천 질문 (영어). 프롬프트의 "Questions"에 들어가고, 화면에서도 추천 질문으로 보여 준다.
 *
 * 규칙
 *  - 질문에는 개인정보를 넣지 않는다 (역할 가명도 쓰지 않는다)
 *  - 질문은 사실을 단정하지 않고 AI에게 묻는 형태로 쓴다
 *
 * 대조한 자료 (이슈 #77, #106). 주택도시보증공사(HUG) 안심전세포털 > 전세사기 피해 예방 (www.khug.or.kr/jeonse)
 *  - 계약 체결_유의사항 > 계약내용 확인, 특약사항 작성 (/web/s03/s030205.jsp, s030206.jsp), 2026-11-14 확인
 *      · 특약사항 작성 페이지는 2026-11-16에 다시 확인: 구두 약속(곰팡이 제거·도배)은 특약으로 적기,
 *        선순위 근저당 말소 특약(+ 이행하지 않으면 계약 무효), 보증 가입 불가 시 계약 취소·보증금 반환 특약,
 *        계약 후 입주 직후에도 등기부등본 다시 확인 → 아래 FRAUD_CHECK 질문 4·5·6·7번의 근거
 *  - 계약 체결 후_유의사항 > 대항력과 우선변제권 (/web/s03/s030301.jsp), 2026-11-16 확인
 *      · 대항력은 전입신고 다음 날 0시부터, 그 전에 근저당이 생길 수 있어 등기부를 다시 봐야 함 → FRAUD_CHECK 6번
 *      · 확정일자는 계약서를 쓴 날 바로 받기를 권함
 *  - 계약 종료 및 갱신 시_유의사항 > 계약 종료 시 (/web/s03/s030401.jsp), 2026-11-16 확인
 *      · 묵시적 갱신, 만기 6개월~2개월 전 해지 의사 통지(기록 남기기) → CONTRACT_EXPLANATION 마지막 질문
 *  - 계약 체결_유의사항 > 주택 소유자 확인 (/web/s03/s030202.jsp), 2026-11-16 확인
 *      · 소유자가 여러 명이면 전원과 계약 → 아래 FRAUD_CHECK 3번 질문(권리 확인 서류)과 겹치므로 질문은 더하지 않음
 *  - 확인하지 못한 곳: 경매·근저당 별도 설명, 신탁원부·수탁자 동의서 설명 페이지. 해당 질문(2·3번)은 팀이 이미 쓰던 문구를 유지했다.
 */

import { MASKING_PURPOSE, RISK_STATUS } from '../../shared/document-model.js';

/**
 * @typedef {{ text: string, ruleId?: string }} QuestionEntry
 *   ruleId: 이 질문이 연결된 위험 점검 규칙. 그 점검이 NO_FLAG면 질문을 뺀다. 없으면 항상 넣는다.
 */

/** 목적별 최소 질문 수. 점검 결과로 질문을 빼더라도 이 수보다 적게 남기지 않는다. */
const MIN_QUESTIONS = 3;

/** @type {(text: string, ruleId?: string) => QuestionEntry} */
const ask = (text, ruleId) => (ruleId ? { text, ruleId } : { text });

/** @type {Record<string, readonly QuestionEntry[]>} */
const RECOMMENDED_QUESTIONS = {
  [MASKING_PURPOSE.CLAUSE_EXPLANATION]: [
    ask('Explain each section of these documents in simple English.'),
    ask('Explain the Korean legal terms that appear in these documents (for example 근저당, 채권최고액, 확정일자, 전입신고).'),
    ask('Which clauses should I ask the landlord or the agent to explain before I sign?'),
  ],
  [MASKING_PURPOSE.FRAUD_CHECK]: [
    ask('Based on the check results, which risks should I resolve before signing, and in what order?'),
    ask('Is the mortgage (근저당) excessive compared to my deposit? What would it mean for getting my deposit back if the home is sold at auction?', 'MORTGAGE_EXISTS'),
    ask('What documents should I ask for to confirm that the landlord has the right to rent out this home (for example ID, trust register, written consent)?'),
    ask('If there is a mortgage (근저당) ahead of my deposit, should the contract include a special term that it will be cancelled (말소), and that the contract is void if this is not done?', 'MORTGAGE_EXISTS'),
    ask('Should the contract include a special term that cancels the contract and returns my deposit if I cannot get a deposit return guarantee (전세보증금반환보증) through no fault of mine?'),
    ask('What should I do after signing to protect my deposit (for example 전입신고 and 확정일자), should I check the property register (등기부등본) again around move-in day, and is deposit return insurance an option for me?'),
    ask('Are there any verbal promises from the landlord (for example repairs or new wallpaper) that I should write into the special terms?'),
  ],
  [MASKING_PURPOSE.CONTRACT_EXPLANATION]: [
    ask('Summarize the deposit, rent, contract period, and special terms.'),
    ask('Point out anything in this contract that is unfavorable to me as the tenant.'),
    ask('Does the contract clearly state the payment account and payment dates for the deposit and rent, who pays for repairs, and any included items (for example an air conditioner)?'),
    ask('What are my rights and duties when the contract ends (deposit return, restoring the home, renewal), including by when I must tell the landlord if I do not want to renew?'),
  ],
};

/**
 * 이 질문과 연결된 점검이 "문제 없음(NO_FLAG)"으로 확인됐는가.
 * 점검 결과에 그 규칙이 없거나, UNVERIFIABLE·CHECK·STOP이 하나라도 있으면 false (질문을 남긴다).
 * @param {QuestionEntry} entry
 * @param {{ ruleId?: string, status?: string }[]} riskResults
 */
function isCleared(entry, riskResults) {
  if (!entry.ruleId) return false;
  const matched = riskResults.filter((r) => r?.ruleId === entry.ruleId);
  return matched.length > 0 && matched.every((r) => r.status === RISK_STATUS.NO_FLAG);
}

/**
 * 목적에 맞는 추천 질문. 알 수 없는 목적이면 null.
 *
 * riskResults(선택)를 주면 "문제 없음"으로 확인된 점검의 질문은 뺀다 (예: 근저당 NO_FLAG → 근저당 질문 제외).
 *  - UNVERIFIABLE / CHECK / STOP → 남긴다
 *  - riskResults를 안 주면(배열이 아니면) 전체 목록
 *  - 질문이 MIN_QUESTIONS보다 적게 남으면, 뺀 질문을 원래 순서대로 다시 채운다
 * @param {string} purpose  MASKING_PURPOSE 값
 * @param {{ ruleId?: string, status?: string }[]} [riskResults]  assessRisks() 결과
 * @returns {string[] | null}
 */
export function getRecommendedQuestions(purpose, riskResults) {
  const entries = RECOMMENDED_QUESTIONS[purpose];
  if (!entries) return null;
  if (!Array.isArray(riskResults)) return entries.map((e) => e.text);

  const cleared = entries.map((e) => isCleared(e, riskResults));
  let missing = MIN_QUESTIONS - cleared.filter((c) => !c).length;
  return entries
    .filter((_, i) => {
      if (!cleared[i]) return true;
      if (missing > 0) {
        missing -= 1;
        return true;
      }
      return false;
    })
    .map((e) => e.text);
}
