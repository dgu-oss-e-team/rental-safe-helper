// @ts-check
/**
 * PART 5. 앱 시작점과 최소 화면 (스켈레톤)
 *
 * 화면 문구는 영어(제안서 기준). 서류 텍스트를 innerHTML에 넣지 않는다(textContent만 사용).
 * TODO(PART 5): 단계별 화면(업로드 → OCR 확인 → 결과 → 목적 선택 → 보내기 전 확인 → 상담)으로 나누고,
 *               각 파트가 만든 UI 요소(ocr-editor, risk-result-ui, masking-review-ui)를 연결한다.
 */

import './style.css';
import { runPipeline } from './pipeline.js';
import { appState } from './app-state.js';
import { MASKING_PURPOSE } from '../shared/document-model.js';

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

const app = /** @type {HTMLElement} */ (document.querySelector('#app'));

const registryInput = /** @type {HTMLInputElement} */ (
  el('input', { type: 'file', id: 'registry-file', accept: '.pdf,.jpg,.jpeg,.png' })
);
const leaseInput = /** @type {HTMLInputElement} */ (
  el('input', { type: 'file', id: 'lease-file', accept: '.pdf,.jpg,.jpeg,.png' })
);
const purposeSelect = /** @type {HTMLSelectElement} */ (el('select', { id: 'purpose' }));
for (const [value, label] of [
  [MASKING_PURPOSE.FRAUD_CHECK, 'Check fraud risks'],
  [MASKING_PURPOSE.CLAUSE_EXPLANATION, 'Explain clauses and terms'],
  [MASKING_PURPOSE.CONTRACT_EXPLANATION, 'Explain contract conditions'],
]) {
  purposeSelect.append(el('option', { value }, [label]));
}

const runButton = el('button', { type: 'button', id: 'run' }, ['Check my documents']);
const sampleButton = el('button', { type: 'button', id: 'run-sample', class: 'secondary' }, ['Try with sample data']);
const output = el('div', { id: 'output' });

app.append(
  el('header', {}, [
    el('h1', {}, ['Rental Safety Helper']),
    el('p', { class: 'notice' }, [
      'Your documents stay in this browser. This is not legal advice. (Skeleton version: results are sample data.)',
    ]),
  ]),
  el('section', { class: 'card' }, [
    el('label', { for: 'registry-file' }, ['Property register (등기부등본)']),
    registryInput,
    el('label', { for: 'lease-file' }, ['Lease contract (임대차계약서)']),
    leaseInput,
    el('label', { for: 'purpose' }, ['What do you want to ask AI?']),
    purposeSelect,
    el('div', { class: 'actions' }, [runButton, sampleButton]),
  ]),
  output,
);

/**
 * @param {string} title
 * @param {unknown} data
 */
function jsonSection(title, data) {
  return el('section', { class: 'card' }, [el('h2', {}, [title]), el('pre', {}, [JSON.stringify(data, null, 2)])]);
}

function render() {
  const { status, result, error } = appState.getState();
  output.replaceChildren();
  if (status === 'running') output.append(el('p', {}, ['Working…']));
  if (status === 'error' && error) {
    output.append(el('p', { class: 'error' }, [`Stopped at ${error.step ?? 'unknown step'}: ${error.message}`]));
  }
  if (status !== 'done' || !result) return;

  const promptBox = /** @type {HTMLTextAreaElement} */ (el('textarea', { rows: '14', readonly: '' }));
  promptBox.value = result.prompt;
  const copyButton = el('button', { type: 'button' }, ['Copy prompt']);
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.prompt);
      copyButton.textContent = 'Copied';
    } catch {
      promptBox.select();
      copyButton.textContent = 'Press Ctrl+C to copy';
    }
  });

  output.append(
    jsonSection('1. Documents (PART 1·2)', result.documents.map((d) => ({ id: d.documentId, type: d.documentType }))),
    jsonSection('2. Personal information found (PART 2)', result.findings.map((f) => ({ id: f.id, type: f.type }))),
    jsonSection('3. Risk check (PART 3)', result.riskResults),
    jsonSection('4. Masking plan (PART 4)', result.maskingPlan),
    jsonSection('5. Masked text (PART 4)', result.maskedText),
    el('section', { class: 'card' }, [el('h2', {}, ['6. Prompt for AI (PART 3)']), promptBox, copyButton]),
    jsonSection(
      '7. Masked PDF (PART 5)',
      result.pdfs.map((p) => ({ documentId: p.documentId, ok: p.result.ok, error: p.result.ok ? null : p.result.error })),
    ),
  );
}

appState.subscribe(render);

/** @param {File[]} files */
async function run(files) {
  appState.setState({ status: 'running', result: null, error: null });
  const r = await runPipeline({ files, purpose: purposeSelect.value });
  if (r.ok) appState.setState({ status: 'done', result: r.data });
  else appState.setState({ status: 'error', error: { step: r.step, ...r.error } });
}

runButton.addEventListener('click', () => {
  const files = [registryInput.files?.[0], leaseInput.files?.[0]].filter((f) => f !== undefined);
  run(/** @type {File[]} */ (files));
});

sampleButton.addEventListener('click', () => {
  run([
    new File([''], 'sample-registry.pdf', { type: 'application/pdf' }),
    new File([''], 'sample-lease.pdf', { type: 'application/pdf' }),
  ]);
});

render();
