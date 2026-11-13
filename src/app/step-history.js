// @ts-check
/**
 * PART 5. 단계와 브라우저 기록(뒤로 가기·앞으로 가기) 연결 규칙 (#90)
 *
 * 단계가 바뀔 때 주소 끝에 단계 이름만 남긴다 (#upload, #results …).
 * 그래서 휴대폰 뒤로 가기(안드로이드 버튼, 아이폰 스와이프)가 사이트를 나가지 않고 이전 단계로 간다.
 *
 * 개인정보: 주소와 브라우저 기록에는 단계 이름만 넣는다. 서류 정보·파일 이름·결과는 넣지 않는다
 *          (브라우저 기록·동기화로 퍼지지 않게). history.state도 쓰지 않는다.
 *
 * 이 파일은 화면·브라우저를 건드리지 않는 계산만 한다 (단위 테스트용). 실제 연결은 main.js.
 */

/** 단계 순서 ("Confirm text"는 ① 다음, 사진·스캔이 있을 때만) */
export const STEP_ORDER = /** @type {const} */ (['upload', 'confirm', 'results', 'purpose', 'review', 'done']);

/** @typedef {typeof STEP_ORDER[number]} Step */

/**
 * 주소 끝(#…)에서 단계를 읽는다. 모르는 값이나 빈 값이면 ① upload.
 * @param {string} hash  location.hash (예: '#results')
 * @returns {Step}
 */
export function stepFromHash(hash) {
  const name = String(hash ?? '').replace(/^#/, '');
  return /** @type {readonly string[]} */ (STEP_ORDER).includes(name) ? /** @type {Step} */ (name) : 'upload';
}

/**
 * 단계 → 주소 끝
 * @param {string} step
 */
export function hashFor(step) {
  return `#${step}`;
}

/**
 * 그 단계에 보여 줄 결과가 이미 있는지
 * @param {{ ocrReview?: unknown, analysis?: unknown, prepared?: unknown, pdfs?: unknown }} state
 * @param {Step} step
 */
function hasResultFor(state, step) {
  switch (step) {
    case 'upload':
      return true;
    case 'confirm':
      return Boolean(state.ocrReview);
    case 'results':
    case 'purpose':
      return Boolean(state.analysis);
    case 'review':
      return Boolean(state.analysis && state.prepared);
    case 'done':
      return Boolean(state.analysis && state.prepared && state.pdfs);
    default:
      return false;
  }
}

/**
 * 뒤로·앞으로 가기로 가려는 단계에 결과가 없으면(예: 분석 전 ②, 처음부터 다시 한 뒤의 ⑤),
 * 그보다 앞에서 결과가 있는 가장 가까운 단계로 보낸다. 마지막에는 ① upload.
 * @param {{ ocrReview?: unknown, analysis?: unknown, prepared?: unknown, pdfs?: unknown }} state
 * @param {Step} wanted
 * @returns {Step}
 */
export function reachableStep(state, wanted) {
  for (let i = STEP_ORDER.indexOf(wanted); i > 0; i -= 1) {
    if (hasResultFor(state, STEP_ORDER[i])) return STEP_ORDER[i];
  }
  return 'upload';
}

/**
 * 앱 안에서 단계가 바뀌었을 때 브라우저 기록을 어떻게 할지
 * - 'none': 그대로 (같은 단계)
 * - 'replace': 지금 기록을 바꿔 쓴다. "Confirm text"에서 떠날 때 (결과로 갔다가 뒤로 가면 확인 화면이 아니라 ①로)
 * - 'push': 새 기록을 남긴다 (나머지 모두)
 * @param {string | undefined} fromStep  기록에 있는 지금 단계
 * @param {string} toStep
 * @returns {'none' | 'replace' | 'push'}
 */
export function historyAction(fromStep, toStep) {
  if (fromStep === toStep) return 'none';
  if (fromStep === 'confirm') return 'replace';
  return 'push';
}
