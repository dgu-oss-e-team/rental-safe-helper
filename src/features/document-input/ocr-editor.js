// @ts-check
/**
 * PART 1. OCR 결과 수정 화면 (ocr-editor)
 *
 * 인터페이스 (docs/INTERFACES.md / #54):
 *   renderOcrEditor({ documents, files, onChange }) -> HTMLElement
 *   - documents: DocumentModel[] (사진/스캔 서류)
 *   - files: 원본 File[] (있으면 텍스트 옆에 원본 이미지를 함께 표시)
 *   - onChange(editedDocuments): 사용자가 수정하거나 줄을 확인할 때마다 전체 DocumentModel[] 복사본으로 호출
 *   - blockId와 bbox는 절대 변경하지 않는다(PDF 마스킹 위치가 의존).
 *   - 사용자가 확인(Confirm)한 줄은 confidence를 1로 설정한다.
 *
 * 보안 규칙: 서류 텍스트는 innerHTML에 넣지 않고 textContent / input.value만 사용한다(XSS 방지).
 *            개인정보를 콘솔 로그나 오류 메시지에 남기지 않는다.
 */

import { el, button, card } from '../../app/ui.js';
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
 * OCR 결과 확인 및 수정 UI를 렌더링한다.
 *
 * @param {{
 *   documents?: import('../../shared/document-model.js').DocumentModel[],
 *   files?: File[],
 *   onChange?: (editedDocuments: import('../../shared/document-model.js').DocumentModel[]) => void,
 * }} params
 * @returns {HTMLElement}
 */
export function renderOcrEditor({ documents = [], files = [], onChange } = {}) {
  const sourceDocs = Array.isArray(documents) ? documents : [];
  /** @type {import('../../shared/document-model.js').DocumentModel[]} */
  const draftDocs = structuredClone(sourceDocs);
  /** @type {import('../../shared/document-model.js').DocumentModel[]} */
  const originalDocs = structuredClone(sourceDocs);

  const emitChange = () => {
    if (typeof onChange === 'function') {
      onChange(structuredClone(draftDocs));
    }
  };

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
      ])
    );
    return root;
  }

  const warnChip = el('span', { class: flaggedCount > 0 ? 'chip chip-check' : 'chip' }, [
    flaggedCount > 0
      ? `${flaggedCount} ${flaggedCount === 1 ? 'line needs' : 'lines need'} careful check`
      : 'All lines checked',
  ]);

  const updateSummaryChip = () => {
    let remaining = 0;
    for (const doc of draftDocs) {
      for (const page of doc.pages ?? []) {
        for (const block of page.blocks ?? []) {
          if (isLowConfidenceBlock(block)) remaining += 1;
        }
      }
    }
    warnChip.className = remaining > 0 ? 'chip chip-check' : 'chip';
    warnChip.textContent =
      remaining > 0
        ? `${remaining} ${remaining === 1 ? 'line needs' : 'lines need'} careful check`
        : 'All lines checked';
  };

  const summaryChips = el('div', { class: 'summary' }, [
    el('span', { class: 'chip chip-unverifiable' }, [`${totalBlocks} lines recognized`]),
    warnChip,
  ]);

  root.append(
    card('Check and fix recognized text', [
      el('p', {}, [
        'Compare the text below with your photo or scan, fix any misread numbers or names, and confirm each flagged line.',
      ]),
      summaryChips,
    ])
  );

  draftDocs.forEach((doc, docIdx) => {
    const docTitle = DOC_LABELS[doc.documentType] ?? `Document ${docIdx + 1}`;
    const matchingFile = Array.isArray(files) ? files[docIdx] : undefined;

    /** @type {HTMLElement | null} */
    let previewPane = null;
    if (
      matchingFile &&
      typeof matchingFile.type === 'string' &&
      matchingFile.type.startsWith('image/') &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const objectUrl = URL.createObjectURL(matchingFile);
      const img = el('img', {
        src: objectUrl,
        alt: `Uploaded page preview for ${docTitle}`,
        class: 'ocr-preview-image',
      });
      img.addEventListener('load', () => {
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(objectUrl);
        }
      });
      previewPane = el('div', { class: 'ocr-preview-pane' }, [
        el('p', { class: 'hint' }, ['Original image']),
        img,
      ]);
    }

    /** @type {HTMLElement[]} */
    const pageSections = [];

    (doc.pages ?? []).forEach((page, pageIdx) => {
      const blocksList = el('div', { class: 'ocr-block-list' });

      (page.blocks ?? []).forEach((block, blockIdx) => {
        const origBlock = originalDocs[docIdx]?.pages?.[pageIdx]?.blocks?.[blockIdx];
        const origText = origBlock?.text ?? block.text;
        const origConfidence = origBlock?.confidence ?? block.confidence;
        const inputId = `ocr-${doc.documentId}-p${page.pageIndex}-${block.blockId}`;

        const rowContainer = el('div', { class: 'ocr-block' });
        const statusBadge = el('span', { class: 'ocr-badge' }, []);
        const input = /** @type {HTMLInputElement} */ (
          el('input', {
            type: 'text',
            id: inputId,
            class: 'ocr-input',
            'aria-label': `Page ${page.pageIndex + 1} line ${blockIdx + 1}`,
          })
        );
        input.value = block.text;

        const confirmLineBtn = button(
          'Confirm',
          () => {
            block.confidence = 1;
            refreshRowState();
            updateSummaryChip();
            emitChange();
          },
          { variant: 'secondary' }
        );
        confirmLineBtn.classList.add('ocr-confirm-btn');

        const resetBtn = button(
          'Reset',
          () => {
            input.value = origText;
            block.text = origText;
            block.confidence = origConfidence;
            refreshRowState();
            updateSummaryChip();
            emitChange();
          },
          { variant: 'secondary' }
        );
        resetBtn.classList.add('ocr-reset-btn');

        const refreshRowState = () => {
          const needsCheck = isLowConfidenceBlock(block);
          const isConfirmed = block.confidence === 1 && origConfidence !== 1;
          const confPercent =
            typeof block.confidence === 'number'
              ? `${Math.round(block.confidence * 100)}%`
              : 'PDF text';

          rowContainer.className = needsCheck ? 'ocr-block ocr-block-warn' : 'ocr-block';
          input.className = needsCheck ? 'ocr-input ocr-input-warn' : 'ocr-input';

          if (needsCheck) {
            statusBadge.className = 'ocr-badge ocr-badge-warn';
            statusBadge.textContent = `Check carefully (${confPercent})`;
          } else if (isConfirmed) {
            statusBadge.className = 'ocr-badge ocr-badge-ok';
            statusBadge.textContent = 'Confirmed (100%)';
          } else {
            statusBadge.className = 'ocr-badge';
            statusBadge.textContent = `Confidence ${confPercent}`;
          }

          confirmLineBtn.hidden = !needsCheck;
          resetBtn.hidden = input.value === origText && block.confidence === origConfidence;
        };

        input.addEventListener('input', () => {
          block.text = input.value;
          // 사용자가 직접 텍스트를 고치면 확인 완료(confidence = 1)로 표시
          block.confidence = 1;
          refreshRowState();
          updateSummaryChip();
          emitChange();
        });

        refreshRowState();

        const rowHeader = el('div', { class: 'ocr-block-header' }, [
          el('label', { for: inputId }, [`Line ${blockIdx + 1}`]),
          statusBadge,
        ]);

        const rowControls = el('div', { class: 'ocr-block-controls' }, [
          input,
          confirmLineBtn,
          resetBtn,
        ]);

        rowContainer.append(rowHeader, rowControls);
        blocksList.append(rowContainer);
      });

      pageSections.push(
        el('div', { class: 'ocr-page' }, [
          (doc.pages ?? []).length > 1 ? el('h3', {}, [`Page ${page.pageIndex + 1}`]) : null,
          blocksList,
        ])
      );
    });

    const body = previewPane
      ? [el('div', { class: 'ocr-split-layout' }, [previewPane, el('div', { class: 'ocr-editor-pane' }, pageSections)])]
      : pageSections;

    root.append(card(docTitle, body));
  });

  return root;
}