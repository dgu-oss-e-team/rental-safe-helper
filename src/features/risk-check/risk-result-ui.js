// @ts-check
/**
 * PART 3. ② 위험 점검 결과 카드 (risk-result-ui)
 *
 * PART 5 slots.js의 riskResults 자리에 들어간다. 입력·출력은 slots.js JSDoc 그대로:
 *   (riskResults: RiskResult[]) => HTMLElement
 *
 * 화면 구성
 *  - 위쪽 요약(Stop / Check / Could not check / No warning found 개수): 눌러서 그 상태만 보기, 다시 누르면 전체 보기
 *  - STOP → CHECK 카드는 바로 보여 준다.
 *  - 확인 불가·문제 없음은 기본으로 접는다 (휴대폰에서 길이를 줄이려고).
 *  - 근거 칸(evidence)에는 실제 이름·주소가 들어갈 수 있다. 화면에만 보여 주고 AI 프롬프트에는 넣지 않는다.
 *  - AI 추천 질문을 접어서 보여 준다.
 *
 * "문제 없음"은 "안전하다"가 아니다. 읽을 수 있었던 범위에서 경고를 못 찾았다는 뜻이므로 그렇게 안내한다.
 * 서류에서 나온 글자는 el()로만 넣는다 (textContent, innerHTML 사용 안 함).
 */

import './risk-result.css';
import { el } from '../../app/ui.js';
import { MASKING_PURPOSE, RISK_STATUS } from '../../shared/document-model.js';
// index.js가 아니라 이 파일을 직접 불러와 첫 화면을 가볍게 둔다 (index.js는 YAML 규칙 파일까지 불러온다)
import { getRecommendedQuestions } from './recommended-questions.js';
import { STATUS_ORDER, STATUS_TEXT, COLLAPSED_STATUSES, normalizeStatus, groupRiskResults, validFilter } from './risk-result-model.js';

/** @typedef {import('../../shared/document-model.js').RiskResult} RiskResult */

/** 접힌 상태에서 안내할 말. "문제 없음"이 "안전"으로 읽히지 않게 한다. */
const GROUP_NOTE = {
  [RISK_STATUS.UNVERIFIABLE]:
    'We could not read enough to check these. This is not a good or a bad sign. Please check them yourself.',
  [RISK_STATUS.NO_FLAG]:
    'We found no warning in the parts we could read. This does not mean the contract is safe.',
};

/** STOP·CHECK이 하나도 없을 때 (그래도 "안전"이라고 쓰지 않는다) */
const NO_ALERT_NOTE = 'We found no Stop or Check items in the parts we could read. This does not mean the contract is safe.';

/**
 * 화면을 다시 그려도(예: "같은 사람인가요?" 답) 고른 필터와 펼친 칸을 기억한다.
 * PART 5가 결과 화면을 통째로 다시 그리기 때문이다. (개인정보 없음: 상태 이름만 저장)
 */
const view = {
  /** @type {string | null} */
  filter: null,
  /** @type {Set<string>} */
  open: new Set(),
};

/**
 * 새 서류를 분석했을 때 고른 필터와 펼친 칸을 처음 상태(전체 보기, 모두 접힘)로 되돌린다.
 * 이전에 고른 필터가 남아 새 결과의 STOP 카드를 가리지 않게 하려는 것이다.
 * PART 5 main.js의 finishAnalysis()에서 새 분석 결과가 나올 때 부른다. (#63 리뷰)
 */
export function resetRiskResultsView() {
  view.filter = null;
  view.open.clear();
}

/**
 * 결과 카드 한 장
 * @param {RiskResult} r
 */
function riskCard(r) {
  const status = normalizeStatus(r.status);
  const evidence = r.evidence?.left && r.evidence?.right ? r.evidence : null;
  return el('li', { class: `risk risk-${status.toLowerCase()}` }, [
    el('span', { class: 'badge' }, [STATUS_TEXT[status]]),
    el('h3', {}, [r.title]),
    el('p', {}, [r.explanation]),
    el('p', { class: 'action' }, [el('strong', {}, ['What to do: ']), r.action]),
    // 근거 칸: 실제 이름·주소가 들어갈 수 있으므로 화면에만 보여 준다 (프롬프트에는 없음)
    evidence
      ? el('div', { class: 'evidence-box' }, [
          el('dl', { class: 'evidence' }, [
            el('dt', {}, [evidence.left.label]),
            el('dd', {}, [String(evidence.left.value)]),
            el('dt', {}, [evidence.right.label]),
            el('dd', {}, [String(evidence.right.value)]),
          ]),
          el('p', { class: 'evidence-note' }, ['Shown only on this screen. It is not included in the AI prompt.']),
        ])
      : null,
  ]);
}

/**
 * @param {RiskResult[]} results
 */
const cardList = (results) => el('ul', { class: 'risk-list' }, results.map(riskCard));

/**
 * 위험 점검 결과 카드 목록
 * @param {RiskResult[]} riskResults
 * @param {{ purpose?: string }} [options]  추천 질문의 목적 (기본: 사기 위험 확인)
 * @returns {HTMLElement}
 */
export function renderRiskResults(riskResults, options = {}) {
  const groups = groupRiskResults(riskResults);
  const total = STATUS_ORDER.reduce((n, s) => n + groups[s].length, 0);
  const questions = getRecommendedQuestions(options.purpose ?? MASKING_PURPOSE.FRAUD_CHECK, riskResults, { monthlyRent: options.monthlyRent }) ?? [];
  const summary = el('div', { class: 'risk-filter', role: 'group', 'aria-label': 'Show results by status' });
  const body = el('div', { class: 'risk-body', 'aria-live': 'polite' });

  /** 상태 버튼 (눌러서 그 상태만 보기) */
  const chips = new Map(
    STATUS_ORDER.map((status) => {
      const chip = el('button', { type: 'button', class: `risk-chip chip-${status.toLowerCase()}` }, [
        `${STATUS_TEXT[status]} ${groups[status].length}`,
      ]);
      chip.addEventListener('click', () => {
        // 같은 버튼을 다시 누르면 전체 보기
        view.filter = validFilter(groups, view.filter) === status ? null : status;
        draw();
      });
      return [status, chip];
    }),
  );
  summary.append(...chips.values());

  /**
   * 접을 수 있는 칸 (확인 불가 / 문제 없음)
   * @param {string} status
   * @param {boolean} forceOpen  필터로 이 상태만 볼 때는 펼쳐서 보여 준다
   */
  function collapsedGroup(status, forceOpen) {
    const details = el('details', { class: `risk-group risk-group-${status.toLowerCase()}`, open: forceOpen || view.open.has(status) }, [
      el('summary', {}, [`${STATUS_TEXT[status]} (${groups[status].length})`]),
      el('div', { class: 'risk-group-body' }, [el('p', { class: 'risk-note' }, [GROUP_NOTE[status]]), cardList(groups[status])]),
    ]);
    details.addEventListener('toggle', () => {
      // 필터로 강제로 펼친 것은 기억하지 않는다
      if (view.filter) return;
      if (/** @type {HTMLDetailsElement} */ (details).open) view.open.add(status);
      else view.open.delete(status);
    });
    return details;
  }

  function draw() {
    const filter = validFilter(groups, view.filter);
    view.filter = filter;
    for (const [status, chip] of chips) {
      chip.setAttribute('aria-pressed', String(filter === status));
      // 결과가 없는 상태는 누를 수 없게 한다
      if (groups[status].length === 0) chip.setAttribute('disabled', '');
      else chip.removeAttribute('disabled');
    }

    if (total === 0) {
      body.replaceChildren(el('p', { class: 'risk-note' }, ['No results to show.']));
      return;
    }

    const shown = filter ? [filter] : STATUS_ORDER;
    const alerts = shown.filter((s) => !COLLAPSED_STATUSES.includes(s)).flatMap((s) => groups[s]);
    const parts = [];
    if (alerts.length > 0) parts.push(cardList(alerts));
    else if (!filter && groups[RISK_STATUS.STOP].length + groups[RISK_STATUS.CHECK].length === 0) {
      parts.push(el('p', { class: 'risk-note' }, [NO_ALERT_NOTE]));
    }
    for (const status of shown) {
      if (COLLAPSED_STATUSES.includes(status) && groups[status].length > 0) parts.push(collapsedGroup(status, filter === status));
    }
    body.replaceChildren(...parts);
  }
  draw();

  const root = el('div', { class: 'risk-results' }, [summary, body]);

  // AI 추천 질문 (접어서 보여 준다. 질문에는 개인정보가 없다)
  if (questions.length > 0) {
    root.append(
      el('details', { class: 'risk-questions' }, [
        el('summary', {}, [`Ideas to ask the AI (${questions.length})`]),
        el('ul', {}, questions.map((q) => el('li', {}, [q]))),
      ]),
    );
  }
  return root;
}