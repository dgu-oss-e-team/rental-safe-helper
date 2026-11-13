// @ts-check
/** PART 5. ⑤ 완료 화면: 마스킹 PDF 다운로드 + AI 상담 연결 */

import { el, button, card, actions } from '../ui.js';
import { DOCUMENT_TEXT } from '../slots.js';
import { errorHelp } from '../error-help.js';

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
