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
    'What should I do after signing to protect my deposit (for example 전입신고 and 확정일자), should I check the property register (등기부등본) again around move-in day, and is deposit return insurance an option for me?',
    'Are there any verbal promises from the landlord (for example repairs or new wallpaper) that I should write into the special terms?',
  ],
  [MASKING_PURPOSE.CONTRACT_EXPLANATION]: [
    'Summarize the deposit, rent, contract period, and special terms.',
    'Point out anything in this contract that is unfavorable to me as the tenant.',
    'Does the contract clearly state the payment account and payment dates for the deposit and rent, who pays for repairs, and any included items (for example an air conditioner)?',
    'What are my rights and duties when the contract ends (deposit return, restoring the home, renewal), including by when I must tell the landlord if I do not want to renew?',
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