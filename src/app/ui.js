// @ts-check
/**
 * PART 5. 화면을 만드는 작은 도구들 (모든 화면이 함께 씀)
 *
 * 규칙: 서류에서 나온 글자는 innerHTML에 넣지 않는다. el()은 글자를 textContent로만 넣는다(XSS 방지).
 */

/**
 * HTML 요소를 만든다.
 * @param {string} tag
 * @param {Record<string, string | boolean | undefined>} [attrs]  false/undefined인 속성은 넣지 않음
 * @param {(Node | string | null | undefined | false)[]} [children]  null·false는 건너뜀
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/**
 * 버튼을 만든다.
 * @param {string} label
 * @param {() => void} onClick
 * @param {{ variant?: 'primary' | 'secondary', disabled?: boolean, id?: string }} [opts]
 */
export function button(label, onClick, opts = {}) {
  const b = el('button', { type: 'button', class: opts.variant === 'secondary' ? 'secondary' : undefined, id: opts.id, disabled: opts.disabled }, [
    label,
  ]);
  b.addEventListener('click', onClick);
  return b;
}

/** 화면 단계 (순서대로) */
export const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'results', label: 'Check' },
  { id: 'purpose', label: 'Purpose' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

/**
 * 맨 위 진행 표시 (1 Upload — 2 Check — …)
 * @param {string} current  지금 단계 id
 */
export function stepper(current) {
  // "Confirm text"(사진·스캔 글자 확인)는 ① 서류 올리기의 일부로 보여 준다 (휴대폰에서 단계 칸이 늘지 않게)
  const shown = current === 'confirm' ? 'upload' : current;
  const index = STEPS.findIndex((s) => s.id === shown);
  return el(
    'ol',
    { class: 'stepper', 'aria-label': 'Progress' },
    STEPS.map((s, i) =>
      el('li', { class: i < index ? 'done' : i === index ? 'current' : undefined, 'aria-current': i === index ? 'step' : undefined }, [
        el('span', { class: 'num' }, [String(i + 1)]),
        el('span', { class: 'label' }, [s.label]),
      ]),
    ),
  );
}

/** 모든 화면에 항상 보이는 안내 (제안서: 법률 자문 아님, "Safe" 표현 금지) */
export function disclaimer() {
  return el('p', { class: 'disclaimer' }, [
    'Your documents stay in this browser and are never uploaded. This is not legal advice: it only points out warning signs to check before you sign.',
  ]);
}

/**
 * 제목 + 설명이 있는 카드
 * @param {string} title
 * @param {(Node | string | null | undefined | false)[]} children
 * @param {string} [extraClass]
 */
export function card(title, children, extraClass) {
  return el('section', { class: `card${extraClass ? ` ${extraClass}` : ''}` }, [el('h2', {}, [title]), ...children]);
}

/**
 * 화면 아래쪽 버튼 줄
 * @param {(HTMLElement | null | false)[]} buttons
 */
export function actions(buttons) {
  return el('div', { class: 'actions' }, buttons);
}
