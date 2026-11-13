// @ts-check
/**
 * PART 1. OCR 결과 수정 화면 (ocr-editor)
 *
 * 사진(image) 또는 스캔 PDF(image_pdf)에서 추출한 텍스트 블록을 사용자가 직접 확인·수정할 수 있게 한다.
 * 보안 규칙: 서류 텍스트는 innerHTML에 넣지 않고 textContent / input.value만 사용한다(XSS 방지).
 *            개인정보를 콘솔 로그나 오류 메시지에 남기지 않는다.
 */

import { el, button, card, actions } from '../../app/ui.js';
import { DOCUMENT_TYPE } from '../../shared/document-model.js';

/** 숫자 포함 줄의 주의 기준 신뢰도 (PART 1 기준과 동일) */
export const OCR_REVIEW_DIGIT_THRESHOLD = 0.8;
/** 일반 줄의 주의 기준 신뢰도 */
export const OCR_REVIEW_TEXT_THRESHOLD = 0.75;

const DOC_LABELS = {
  [DOCUMENT_TYPE.REGISTRY]: 'Property register (등기부등본)',
  [DOCUMENT_TYPE.LEASE_CONTRACT]: 'Lease contract (임대차계약서)',
  [DOCUMENT_TYPE.UNKNOWN]: 'Scanned document',
};

/**
 * 블록이 사용자 확인이 필요한 낮은 신뢰도인지 판정한다.
 * @param {{ text: string, confidence?: number | null }} block
 * @returns {boolean}
 */
export function isLowConfidenceBlock(block) {
  if (typeof block.confidence !== 'number') return false;
  const threshold = /\d/.test(block.text)
    ? OCR_REVIEW_DIGIT_THRESHOLD
    : OCR_REVIEW_TEXT_THRESHOLD;
  return block.confidence < threshold;
}

/**
 * OCR 결과 확인 및 수정 UI를 렌더링한다. (PART 5 slots.js의 ocrEditor 자리)
 *
 * @param {{
 *   documents?: import('../../shared/document-model.js').DocumentModel[],
 *   document?: import('../../shared/document-model.js').DocumentModel,
 *   onConfirm?: (updated: any) => void,
 *   onCancel?: () => void,
 * }} params
 * @returns {HTMLElement}
 */
export function renderOcrEditor({ documents, document: singleDoc, onConfirm, onCancel } = {}) {
  const isSingleMode = !Array.isArray(documents) && Boolean(singleDoc);
  const sourceDocs = Array.isArray(documents)
    ? documents
    : singleDoc
      ? [singleDoc]
      : [];

  /** @type {import('../../shared/document-model.js').DocumentModel[]} */
  const draftDocs = structuredClone(sourceDocs);
  /** @type {import('../../shared/document-model.js').DocumentModel[]} */
  const originalDocs = structuredClone(sourceDocs);

  let flaggedCount = 0;
  let totalBlocks = 0;
  for (const doc of draftDocs) {
    for (const page of doc.pages ?? []) {
      for (const block of page.blocks ?? []) {
        totalBlocks += 1;
        if (isLowConfidenceBlock(block)) flaggedCount += 1;
      }
    }
  }

  const root = el('div', { class: 'ocr-editor' });

  if (draftDocs.length === 0 || totalBlocks === 0) {
    root.append(
      card('Review recognized text', [
        el('p', { class: 'hint' }, ['No OCR text blocks are available to review.']),
        onCancel
          ? actions([button('Back', () => onCancel(), { variant: 'secondary' })])
          : null,
      ])
    );
    return root;
  }

  const summaryChips = el('div', { class: 'summary' }, [
    el('span', { class: 'chip chip-unverifiable' }, [`${totalBlocks} lines recognized`]),
    flaggedCount > 0
      ? el('span', { class: 'chip chip-check' }, [
          `${flaggedCount} ${flaggedCount === 1 ? 'line needs' : 'lines need'} careful check`,
        ])
      : el('span', { class: 'chip' }, ['All lines high confidence']),
  ]);

  const introCard = card('Check and fix recognized text', [
    el('p', {}, [
      'Compare the text below with your photo or scan and fix any misread numbers, names, or addresses before risk analysis.',
    ]),
    summaryChips,
  ]);
  root.append(introCard);

  draftDocs.forEach((doc, docIdx) => {
    const docTitle = DOC_LABELS[doc.documentType] ?? `Document ${docIdx + 1}`;
    /** @type {HTMLElement[]} */
    const pageSections = [];

    (doc.pages ?? []).forEach((page, pageIdx) => {
      const blocksList = el('div', { class: 'ocr-block-list' });

      (page.blocks ?? []).forEach((block, blockIdx) => {
        const origText = originalDocs[docIdx]?.pages?.[pageIdx]?.blocks?.[blockIdx]?.text ?? block.text;
        const needsCheck = isLowConfidenceBlock(block);
        const inputId = `ocr-${doc.documentId}-p${page.pageIndex}-${block.blockId}`;

        const confPercent =
          typeof block.confidence === 'number'
            ? `${Math.round(block.confidence * 100)}%`
            : 'PDF text';

        const statusBadge = el(
          'span',
          { class: needsCheck ? 'ocr-badge ocr-badge-warn' : 'ocr-badge' },
          [needsCheck ? `Check carefully (${confPercent})` : `Confidence ${confPercent}`]
        );

        const input = /** @type {HTMLInputElement} */ (
          el('input', {
            type: 'text',
            id: inputId,
            class: needsCheck ? 'ocr-input ocr-input-warn' : 'ocr-input',
            'aria-label': `Page ${page.pageIndex + 1} line ${blockIdx + 1}`,
          })
        );
        input.value = block.text;

        const resetBtn = button(
          'Reset',
          () => {
            input.value = origText;
            block.text = origText;
            resetBtn.hidden = true;
          },
          { variant: 'secondary' }
        );
        resetBtn.classList.add('ocr-reset-btn');
        resetBtn.hidden = true;

        input.addEventListener('input', () => {
          block.text = input.value;
          resetBtn.hidden = input.value === origText;
        });

        const rowHeader = el('div', { class: 'ocr-block-header' }, [
          el('label', { for: inputId }, [`Line ${blockIdx + 1}`]),
          statusBadge,
        ]);

        const rowControls = el('div', { class: 'ocr-block-controls' }, [input, resetBtn]);

        blocksList.append(
          el('div', { class: needsCheck ? 'ocr-block ocr-block-warn' : 'ocr-block' }, [
            rowHeader,
            rowControls,
          ])
        );
      });

      pageSections.push(
        el('div', { class: 'ocr-page' }, [
          (doc.pages ?? []).length > 1 ? el('h3', {}, [`Page ${page.pageIndex + 1}`]) : null,
          blocksList,
        ])
      );
    });

    root.append(card(docTitle, pageSections));
  });

  const confirmBtn = button('Confirm recognized text', () => {
    const cleanedDocs = draftDocs.map((doc) => ({
      ...doc,
      pages: (doc.pages ?? []).map((page) => ({
        ...page,
        blocks: (page.blocks ?? [])
          .map((b) => ({ ...b, text: b.text.trim() }))
          .filter((b) => b.text.length > 0),
      })),
    }));

    if (typeof onConfirm === 'function') {
      onConfirm(isSingleMode ? cleanedDocs[0] : cleanedDocs);
    }
  });

  const backBtn = onCancel
    ? button('Back', () => onCancel(), { variant: 'secondary' })
    : null;

  root.append(actions([confirmBtn, backBtn]));
  return root;
}