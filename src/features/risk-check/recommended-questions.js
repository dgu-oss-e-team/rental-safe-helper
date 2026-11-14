// @ts-check
/**
 * 목적별 AI 추천 질문 (영어). 프롬프트의 "Questions"에 들어가고, 화면에서도 추천 질문으로 보여 준다.
 *
 * 규칙
 *  - 질문에는 개인정보를 넣지 않는다 (역할 가명도 쓰지 않는다)
 *  - 질문은 사실을 단정하지 않고 AI에게 묻는 형태로 쓴다
 *
 * 대조한 자료 (이슈 #77)
 *  - 주택도시보증공사(HUG) 안심전세포털 > 전세사기 피해 예방 > 계약 체결_유의사항
 *    "계약내용 확인", "특약사항 작성" (www.khug.or.kr/jeonse/web/s03/s030205.jsp, s030206.jsp), 2026-11-14 확인
 */

import { MASKING_PURPOSE } from '../../shared/document-model.js';

/** @type {Record<string, readonly string[]>} */
const RECOMMENDED_QUESTIONS = {
  [MASKING_PURPOSE.CLAUSE_EXPLANATION]: [
    'Explain each section of these documents in simple English.',
    'Explain the Korean legal terms that appear in these documents (for example 근저당, 채권최고액, 확정일자, 전입신고).',
    'Which clauses should I ask the landlord or the agent to explain before I sign?',
  ],
  [MASKING_PURPOSE.FRAUD_CHECK]: [
    'Based on the check results, which risks should I resolve before signing, and in what order?',
    'Is the mortgage (근저당) excessive compared to my deposit? What would it mean for getting my deposit back if the home is sold at auction?',
    'What documents should I ask for to confirm that the landlord has the right to rent out this home (for example ID, trust register, written consent)?',
    'If there is a mortgage (근저당) ahead of my deposit, should the contract include a special term that it will be cancelled (말소), and that the contract is void if this is not done?',
    'Should the contract include a special term that cancels the contract and returns my deposit if I cannot get a deposit return guarantee (전세보증금반환보증) through no fault of mine?',
    'What should I do after signing to protect my deposit (for example 전입신고 and 확정일자), and is deposit return insurance an option for me?',
  ],
  [MASKING_PURPOSE.CONTRACT_EXPLANATION]: [
    'Summarize the deposit, rent, contract period, and special terms.',
    'Point out anything in this contract that is unfavorable to me as the tenant.',
    'Does the contract clearly state the payment account and payment dates for the deposit and rent, who pays for repairs, and any included items (for example an air conditioner)?',
    'What are my rights and duties when the contract ends (deposit return, restoring the home, renewal)?',
  ],
};

/**
 * 목적에 맞는 추천 질문. 알 수 없는 목적이면 null.
 * @param {string} purpose  MASKING_PURPOSE 값
 * @returns {string[] | null}
 */
export function getRecommendedQuestions(purpose) {
  const questions = RECOMMENDED_QUESTIONS[purpose];
  return questions ? [...questions] : null;
}