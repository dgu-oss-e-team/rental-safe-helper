// @ts-check
/**
 * PART 5. 보내기 전 검사가 멈춘 줄을 직접 가리고 진행하기 (#316)
 *
 * 사진 서류에서 글자는 맞는데 탐지가 이름을 못 찾으면(칸 이름이 빠진 줄 등) 보내기 전 검사가 멈춘다.
 * 이때 "글자를 고치라"는 안내만으로는 고칠 것이 없어 진행할 수 없으므로, 멈춘 줄을 보여 주고
 * 사용자가 고른 줄을 줄 전체로 가린 뒤(maskingEdits.add, 항상 REDACT) 다시 검사를 거쳐 진행한다.
 * - 줄 위치는 PART 4 validateMaskedText()가 돌려준 where(documentId, blockId)로 찾는다 (pipeline.stopLinesOf).
 * - 줄 글자는 사용자 자신의 서류라서 이 화면에만 보여 준다 (textContent). 오류 메시지·콘솔·로그에는 넣지 않는다.
 * - 가린 줄은 AI 글과 마스킹 PDF(줄 위치 bbox) 모두에서 가려진다.
 */

import { el, button, actions } from './ui.js';

/**
 * @param {import('./pipeline.js').StopLine[] | undefined} lines
 * @param {(chosen: import('./pipeline.js').StopLine[]) => void} onHide  고른 줄을 가리고 다시 진행한다
 * @returns {HTMLElement | null}
 */
export function stopLinesPanel(lines, onHide) {
  if (!lines?.length) return null;
  const boxes = lines.map((line, i) => ({
    line,
    box: /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', id: `stop-line-${i}`, checked: true })),
  }));
  const hide = button(
    'Hide the checked lines and continue',
    () => {
      const chosen = boxes.filter((b) => b.box.checked).map((b) => b.line);
      if (chosen.length > 0) onHide(chosen);
    },
    { id: 'hide-stop-lines' },
  );
  // 하나도 고르지 않으면 누를 수 없다
  const refresh = () => {
    hide.disabled = !boxes.some((b) => b.box.checked);
  };
  for (const b of boxes) b.box.addEventListener('change', refresh);

  return el('div', { class: 'stop-lines', id: 'stop-lines' }, [
    el('p', {}, [
      'These lines may still show personal information. Compare them with your document. ' +
        'If a line has a name, number or address that should not be shared, you can hide the whole line: it will be blacked out in the AI text and in the PDF.',
    ]),
    el(
      'ul',
      { class: 'stop-line-list' },
      boxes.map(({ line, box }) =>
        el('li', {}, [
          el('label', { for: box.id }, [box, ` Page ${line.pageIndex + 1}: `, el('span', { class: 'stop-line-text' }, [line.text])]),
        ]),
      ),
    ),
    actions([hide]),
  ]);
}
