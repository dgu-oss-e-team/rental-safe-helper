// @ts-check
/** PART 5. ⑤ 완료 화면: 마스킹 PDF 다운로드 + AI 상담 연결 */

import { el, button, card, actions } from '../ui.js';
import { DOCUMENT_TEXT } from '../slots.js';
import { errorHelp } from '../error-help.js';
import { CHECK_STATUS, PII_TYPE_TEXT } from '../double-check.js';

/**
 * 웹서비스가 AI를 직접 부르지 않는다. 프롬프트를 복사해 두고 사용자가 직접 붙여넣는다 (제안서 ⑨).
 * 링크를 누르면 복사를 시작하고, 링크 기본 동작으로 새 탭이 열린다.
 */
const AI_SERVICES = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

/** 다운로드 주소. 화면을 다시 그릴 때 이전 주소를 풀어 메모리를 돌려준다 */
let downloadUrls = [];

/**
 * @param {any[]} pdfs  exportMaskedPdfs() 결과
 */
function downloads(pdfs) {
  downloadUrls.forEach((u) => URL.revokeObjectURL(u));
  downloadUrls = [];
  return pdfs.map((p) => {
    if (!p.result.ok) {
      const { title, help } = errorHelp({ step: 'export', code: p.result.error.code });
      return el('p', { class: 'warning' }, [`${DOCUMENT_TEXT[p.documentType] ?? 'Document'}: ${title} ${help}`]);
    }
    const url = URL.createObjectURL(p.result.data.blob);
    downloadUrls.push(url);
    const pages = p.result.data.pageCount;
    return el('a', { class: 'download', href: url, download: p.result.data.fileName }, [
      `Download ${p.result.data.fileName} (${pages} page${pages > 1 ? 's' : ''})`,
    ]);
  });
}

/**
 * @param {string} text
 * @param {HTMLTextAreaElement} box
 * @param {HTMLElement} status
 */
function copyPrompt(text, box, status) {
  navigator.clipboard.writeText(text).then(
    () => {
      status.textContent = 'Prompt copied. Paste it into the AI chat.';
    },
    () => {
      box.select();
      status.textContent = 'Could not copy automatically. Press Ctrl+C (or Copy) to copy the selected text.';
    },
  );
}

/**
 * "Double-check the PDF": 마스킹 PDF를 OCR로 다시 읽어 탐지했던 개인정보가 보이는지 확인한다. (노션 10장)
 * OCR은 시간이 걸리고(페이지당 몇 초) 처음에 읽기 도구를 받아야 해서, 원할 때만 누르게 한다.
 * 결과는 "안전하다"고 말하지 않는다. 값은 보여 주지 않고 종류와 페이지만 알려 준다.
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
function doubleCheckSection(state, act) {
  const { doubleCheck } = state;
  if (doubleCheck === 'running') {
    return el('p', { class: 'busy', role: 'status' }, [
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      'Reading the masked pages again… (a few seconds per page)',
    ]);
  }
  if (!doubleCheck) {
    return el('div', { class: 'double-check' }, [
      el('p', { class: 'hint' }, [
        'Want to be sure? We can read the masked pages again with text recognition (OCR) and look for the personal information we detected.',
      ]),
      actions([button('Double-check the PDF', () => act.doubleCheckPdfs(), { id: 'double-check', variant: 'secondary' })]),
    ]);
  }
  return el(
    'ul',
    { class: 'double-check-results', role: 'status' },
    doubleCheck.map((r) => {
      const name = DOCUMENT_TEXT[r.documentType] ?? 'Document';
      if (r.status === CHECK_STATUS.NOT_FOUND) {
        return el('li', { class: 'check-ok' }, [
          `${name}: none of the personal information we detected was found in the page images. `,
          el('span', { class: 'hint' }, ['This covers only what we detected, so please look through the PDF once yourself.']),
        ]);
      }
      if (r.status === CHECK_STATUS.MAYBE_VISIBLE) {
        const where = r.hits.map((h) => `${PII_TYPE_TEXT[h.type] ?? h.type} (page ${h.pageIndex + 1})`).join(', ');
        return el('li', { class: 'warning' }, [
          `${name}: this may still be visible: ${where}. Check the PDF before you share it, or go back and hide it.`,
        ]);
      }
      return el('li', { class: 'warning' }, [
        `${name}: could not check, because the text in the page images could not be read clearly. Please look through the PDF yourself.`,
      ]);
    }),
  );
}

/**
 * @param {ReturnType<typeof import('../app-state.js').initialState>} state
 * @param {import('../main.js').Actions} act
 */
export function doneScreen(state, act) {
  const prepared = /** @type {import('../pipeline.js').Prepared} */ (state.prepared);
  const box = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'prompt', rows: '12', readonly: true }));
  box.value = prepared.prompt;
  const status = el('p', { class: 'hint', role: 'status' }, []);

  return el('div', {}, [
    card('Masked documents', [
      el('p', {}, ['These PDFs are rebuilt from page images, so the hidden text cannot be copied or searched.']),
      el('div', { class: 'downloads' }, downloads(state.pdfs ?? [])),
      doubleCheckSection(state, act),
    ]),
    card('Ask AI', [
      el('p', {}, ['Copy the prompt and paste it into the AI chat. This website does not send anything to AI by itself.']),
      el('label', { for: 'prompt' }, ['Prompt']),
      box,
      actions([button('Copy prompt', () => copyPrompt(prepared.prompt, box, status), { id: 'copy' })]),
      el(
        'div',
        { class: 'ai-links' },
        AI_SERVICES.map((s) => {
          const link = el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'ai-link' }, [
            `Copy and open ${s.name}`,
          ]);
          link.addEventListener('click', () => copyPrompt(prepared.prompt, box, status));
          return link;
        }),
      ),
      status,
    ]),
    actions([button('Check other documents', () => act.restart(), { variant: 'secondary' })]),
  ]);
}
