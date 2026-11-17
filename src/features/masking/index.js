// @ts-check
/**
 * PART 4. 인물 판별 및 목적 기반 마스킹
 * 담당: docs/OWNERS.md 참고
 *
 * 공개 함수 (다른 파트는 이 파일에서만 가져다 쓴다)
 *   matchPeople(fields)                                  → Result<PersonGroup[]>
 *   createMaskingPlan(findings, personGroups, purpose, edits?)   → Result<MaskingPlan>          (create-masking-plan.js)
 *   applyMaskingPlan(documents, plan, findings, personGroups, edits?) → Result<{ maskedText, legend }>   (apply-masking-plan.js, PART 3 프롬프트용)
 *   validateMaskedText(maskedText, findings, plan, edits?)       → Result<{ checked: number }>     (masking-validator.js, 외부 전달 전 검사)
 *   applyPersonAnswers(personGroups, personAnswers)              → Result<PersonGroup[]>  (person-answers.js)
 *   renderPersonQuestions({ analysis, personGroups, personAnswers, onChange }) → HTMLElement | null  (② "같은 사람인가요?")
 *   renderMaskingReview({ analysis, prepared, edits, onChange }) → HTMLElement  (④ 확인 화면)
 *   edits(사용자 수정) 규칙은 user-edits.js
 *
 * 규칙: 고유식별정보(주민·외국인등록번호, 여권번호)는 모든 목적에서 가린다.
 *       같은 사람 = 같은 가명, 동명이인 = 다른 가명. 생년월일은 판정에만 쓰고 AI로 보내지 않는다.
 *
 * 파일
 *   person-matcher.js, alias-manager.js   같은 사람 묶기(Fuse.js 비슷한 이름 포함)·역할 가명
 *   person-answers.js, person-questions-ui.js   "같은 사람인가요?" 답 반영·질문 화면
 *   create-masking-plan.js   목적별 마스킹 계획, 주소 줄이기(coarsenAddress)
 *   apply-masking-plan.js    계획을 글에 적용, 가명 범례
 *   masking-validator.js     외부 전달 전 검사
 *   user-edits.js, review-model.js, masking-review-ui.js   ④ 확인 화면과 사용자 수정
 */

import { ok, fail, ERROR_CODE } from '../../shared/document-model.js';
import { collectPeople, groupPeople } from './person-matcher.js';
import { assignAliases } from './alias-manager.js';

/** @typedef {{ personId: string, alias: string, roles: string[], findingIds: string[], status: string }} PersonGroup */

// 마스킹 계획 만들기·적용·검사
export { createMaskingPlan, coarsenAddress } from './create-masking-plan.js';
export { applyMaskingPlan } from './apply-masking-plan.js';
export { validateMaskedText } from './masking-validator.js';

// ④ 확인 화면 (PART 5 slots.js의 maskingReview 자리)
export { renderMaskingReview } from './masking-review-ui.js';

// "같은 사람인가요?" 답 반영과 ② 결과 화면 질문 (PART 5 slots.js의 personQuestions 자리, INTERFACES.md 6번)
export { applyPersonAnswers, buildPersonQuestions } from './person-answers.js';
export { renderPersonQuestions } from './person-questions-ui.js';

/**
 * 같은 사람끼리 묶고 역할 가명을 붙인다.
 * @param {object} fields  extractFields() 결과
 */
export function matchPeople(fields) {
  if (!fields) return fail(ERROR_CODE.INVALID_INPUT, 'Extracted fields are missing.');
  const people = collectPeople(fields);
  const groups = groupPeople(people);
  return ok(assignAliases(groups));
}
