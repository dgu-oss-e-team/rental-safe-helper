// @ts-check
/**
 * PART 1. OCR 결과 수정 화면 (ocr-editor)
 *
 * 인터페이스 (docs/INTERFACES.md / #93 / #54):
 *   renderOcrEditor({ documents, files, onChange }) -> HTMLElement
 *   - documents: DocumentModel[] (사진/스캔 서류)
 *   - files: 원본 File[] (이미지 또는 스캔 PDF면 텍스트 옆에 원본 페이지 이미지를 함께 표시)
 *   - onChange(editedDocuments): 사용자가 수정하거나 줄을 확인할 때마다 전체 DocumentModel[] 복사본으로 호출
 *   - blockId와 bbox는 절대 변경하지 않는다(PDF 마스킹 위치가 의존).
 *   - 사용자가 확인(Confirm)한 줄은 confidence를 1로 설정한다.
 *
 * 보안 규칙: 서류 텍스트는 innerHTML에 넣지 않고 textContent / textarea.value만 사용한다(XSS 방지).
 *            개인정보를 콘솔 로그나 오류 메시지에 남기지 않는다.
 */

import './ocr-editor.css';
import { el, button, card } from '../../app/ui.js';
import { DOCUMENT_TYPE } from '../../shared/document-model.js';
import { renderPdfToImages } from './pdf-reader.js';

/** 숫자 포함 줄의 주의 기준 신뢰도 (PART 1 기준과 동일) */
export const OCR_REVIEW_DIGIT_THRESHOLD = 0.8;
/** 일반 줄의 주의 기준 신뢰도 */
export const OCR_REVIEW_TEXT_THRESHOLD = 0.75;

const DOC_LABELS = {
  [DOCUMENT_TYPE.REGISTRY]: "Property register (등기부등본)",
  [DOCUMENT_TYPE.LEASE_CONTRACT]: "Lease contract (임대차계약서)",
  [DOCUMENT_TYPE.UNKNOWN]: 'Scanned document',
};

const RE_PARTY_LINE = new RegExp("(임대사업자|임차인|개업공인|소속공인중개사|대표자|성명|예금주)");
const RE_SECTION_START = new RegExp("1\\.\\s*계약\\s*당사자|계약\\s*당사자");
const RE_SECTION_END = new RegExp("^[◈◆◇]|해당\\s*주택은");
const RE_ADDR_KEYWORD = new RegExp("(\\[집합건물\\]|고유번호|주택\\s*소재지|소재지번|도로명주소|건물번호)");
const RE_ADDR_UNIT_NUM = new RegExp("\\d+\\s*-\\s*\\d+|\\d+\\s*호|제\\s*\\d+\\s*층");
const RE_ADDR_SUFFIX = new RegExp("(시|구|동|로|길|호|층|번지)");

/**
 * Returns true if the line represents a critical party/role row that must not be skipped via batch confirmation.
 * @param {string} text
 * @returns {boolean}
 */
function isCriticalPartyOrNameLine(text) {
  return RE_PARTY_LINE.test(text);
}

/**
 * Collects critical blocks on photo/scan documents that always require user review regardless of confidence:
 * - All lines on Page 1 of a lease contract between "1. 계약 당사자" and the "◈" notice box
 * - Property location, lot/road address, and floor/unit number lines
 * @param {import('../../shared/document-model.js').DocumentModel[]} docs
 * @returns {WeakSet<object>}
 */
export function collectCriticalBlocks(docs) {
  const criticalSet = new WeakSet();
  if (!Array.isArray(docs)) return criticalSet;

  for (const doc of docs) {
    if (!doc || doc.sourceType === 'text_pdf') continue;

    for (const page of doc.pages ?? []) {
      let inLeasePartySection = false;

      for (const block of page.blocks ?? []) {
        const text = String(block.text || '').trim();
        if (!text) continue;

        if (RE_SECTION_START.test(text)) {
          inLeasePartySection = true;
        } else if (RE_SECTION_END.test(text)) {
          inLeasePartySection = false;
        }

        const isKeyAddressOrPropertyLine =
          RE_ADDR_KEYWORD.test(text) ||
          (RE_ADDR_UNIT_NUM.test(text) && RE_ADDR_SUFFIX.test(text));

        if (inLeasePartySection || isKeyAddressOrPropertyLine) {
          criticalSet.add(block);
        }
      }
    }
  }

  return criticalSet;
}

/**
 * Returns true if the block requires user verification due to low confidence or critical-field review.
 * @param {{ text: string, confidence?: number | null, confirmed?: boolean }} block
 * @param {{ forceReview?: boolean }} [options]
 * @returns {boolean}
 */
export function isLowConfidenceBlock(block, options = {}) {
  if (block?.confirmed === true) return false;
  if (typeof block.confidence !== 'number') return false;
  if (block.confidence === 1) return false;
  if (options.forceReview) return true;
  const threshold = /\d/.test(block.text)
    ? OCR_REVIEW_DIGIT_THRESHOLD
    : OCR_REVIEW_TEXT_THRESHOLD;
  return block.confidence < threshold;
}

/**
 * Returns all blocks in the documents that require user confirmation (low confidence + critical lease party/address lines).
 * Shared by PART 5 countLinesToCheck() and ocr-editor so both show the exact same count.
 * @param {import('../../shared/document-model.js').DocumentModel[]} documents
 * @returns {import('../../shared/document-model.js').Block[]}
 */
export function getFlaggedBlocks(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  const criticalBlocks = collectCriticalBlocks(docs);
  /** @type {import('../../shared/document-model.js').Block[]} */
  const flagged = [];

  for (const doc of docs) {
    for (const page of doc.pages ?? []) {
      for (const block of page.blocks ?? []) {
        if (isLowConfidenceBlock(block, { forceReview: criticalBlocks.has(block) })) {
          flagged.push(block);
        }
      }
    }
  }

  return flagged;
}

/**
 * Automatically adjusts textarea height to fit its wrapped content.
 * @param {HTMLTextAreaElement} textarea
 */
function autoResizeTextarea(textarea) {
  if (!textarea || !textarea.style) return;
  textarea.style.height = 'auto';
  if (typeof textarea.scrollHeight === 'number' && textarea.scrollHeight > 0) {
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}

/**
 * Renders the OCR text review and editing UI.
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
  const criticalBlocks = collectCriticalBlocks(draftDocs);

  const isBlockFlagged = (block) =>
    isLowConfidenceBlock(block, { forceReview: criticalBlocks.has(block) });

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
        if (isBlockFlagged(block)) flaggedCount += 1;
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
    const remaining = getFlaggedBlocks(draftDocs).length;
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

    const isImageFile =
      Boolean(matchingFile) &&
      typeof matchingFile?.type === 'string' &&
      matchingFile.type.startsWith('image/');
    const isPdfFile =
      Boolean(matchingFile) &&
      ((typeof matchingFile?.type === 'string' && matchingFile.type === 'application/pdf') ||
        (typeof matchingFile?.name === 'string' &&
          matchingFile.name.toLowerCase().endsWith('.pdf')));

    /** @type {HTMLElement | null} */
    let previewPane = null;
    if (
      isImageFile &&
      matchingFile &&
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
    } else if (
      isPdfFile &&
      matchingFile &&
      typeof matchingFile.arrayBuffer === 'function' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const pdfPreviewContainer = el('div', { class: 'ocr-preview-pane' }, [
        el('p', { class: 'hint' }, ['Original PDF page']),
      ]);
      previewPane = pdfPreviewContainer;

      matchingFile
        .arrayBuffer()
        .then((buf) => renderPdfToImages(buf))
        .then((renderedPages) => {
          if (!Array.isArray(renderedPages) || renderedPages.length === 0) return;
          renderedPages.forEach((pageImg) => {
            const blob = new Blob([pageImg.buffer], { type: 'image/png' });
            const objectUrl = URL.createObjectURL(blob);
            const img = el('img', {
              src: objectUrl,
              alt: `PDF page ${pageImg.pageIndex + 1} preview for ${docTitle}`,
              class: 'ocr-preview-image',
            });
            img.addEventListener('load', () => {
              if (typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(objectUrl);
              }
            });
            pdfPreviewContainer.append(img);
          });
        })
        .catch(() => {
          pdfPreviewContainer.hidden = true;
        });
    }

    /** @type {HTMLElement[]} */
    const pageSections = [];

    (doc.pages ?? []).forEach((page, pageIdx) => {
      const blocksList = el('div', { class: 'ocr-block-list' });
      /** @type {Array<() => void>} */
      const rowRefreshers = [];

      const isBatchConfirmableBlock = (b) =>
        isBlockFlagged(b) &&
        !/\d/.test(b.text) &&
        !isCriticalPartyOrNameLine(b.text);

      const hasUnconfirmedTextBlocks = () =>
        (page.blocks ?? []).some(isBatchConfirmableBlock);

      const confirmPageBtn = button(
        'Confirm this page',
        () => {
          let changed = false;
          (page.blocks ?? []).forEach((b) => {
            if (isBatchConfirmableBlock(b)) {
              b.confirmed = true;
              changed = true;
            }
          });
          if (!changed) return;
          rowRefreshers.forEach((fn) => fn());
          refreshPageConfirmBtn();
          updateSummaryChip();
          emitChange();
        },
        { variant: 'secondary' }
      );
      confirmPageBtn.classList.add('ocr-confirm-page-btn');

      const refreshPageConfirmBtn = () => {
        confirmPageBtn.hidden = !hasUnconfirmedTextBlocks();
      };
      refreshPageConfirmBtn();

      (page.blocks ?? []).forEach((block, blockIdx) => {
        const origBlock = originalDocs[docIdx]?.pages?.[pageIdx]?.blocks?.[blockIdx];
        const origText = origBlock?.text ?? block.text;
        const origConfidence = origBlock?.confidence ?? block.confidence;
        const origConfirmed = Boolean(origBlock?.confirmed);
        const isCriticalField = criticalBlocks.has(block);
        const inputId = `ocr-${doc.documentId}-p${page.pageIndex}-${block.blockId}`;

        const rowContainer = el('div', { class: 'ocr-block' });
        const statusBadge = el('span', { class: 'ocr-badge' }, []);
        const digitHint = el('p', { class: 'ocr-digit-hint' }, [
          isCriticalField
            ? "Key field (address or party line) — verify carefully against the image."
            : 'Fix any wrong characters (like ^ or extra spaces) before confirming.',
        ]);

        const textarea = /**
 * Automatically adjusts textarea height to fit its wrapped content.
 * @param {HTMLTextAreaElement} textarea
 */ (
          el('textarea', {
            rows: '1',
            id: inputId,
            class: 'ocr-input',
            'aria-label': `Page ${page.pageIndex + 1} line ${blockIdx + 1}`,
          })
        );
        textarea.value = block.text;

        const confirmLineBtn = button(
          'Confirm',
          () => {
            block.confidence = 1;
            refreshRowState();
            refreshPageConfirmBtn();
            updateSummaryChip();
            emitChange();
          },
          { variant: 'secondary' }
        );
        confirmLineBtn.classList.add('ocr-confirm-btn');

        const resetBtn = button(
          'Reset',
          () => {
            textarea.value = origText;
            block.text = origText;
            block.confidence = origConfidence;
            if (origConfirmed) {
              block.confirmed = true;
            } else {
              delete block.confirmed;
            }
            autoResizeTextarea(textarea);
            refreshRowState();
            refreshPageConfirmBtn();
            updateSummaryChip();
            emitChange();
          },
          { variant: 'secondary' }
        );
        resetBtn.classList.add('ocr-reset-btn');

        const refreshRowState = () => {
          const needsCheck = isBlockFlagged(block);
          const hasDigits = /\d/.test(block.text);
          const isConfirmed =
            (block.confidence === 1 && origConfidence !== 1) ||
            (block.confirmed === true && !origConfirmed);
          const confPercent =
            typeof block.confidence === 'number'
              ? `${Math.round(block.confidence * 100)}%`
              : 'PDF text';

          rowContainer.className = needsCheck ? 'ocr-block ocr-block-warn' : 'ocr-block';
          textarea.className = needsCheck ? 'ocr-input ocr-input-warn' : 'ocr-input';
          digitHint.hidden = !(needsCheck && (hasDigits || isCriticalField));

          if (needsCheck) {
            statusBadge.className = 'ocr-badge ocr-badge-warn';
            statusBadge.textContent = isCriticalField
              ? `Check key field (${confPercent})`
              : `Check carefully (${confPercent})`;
          } else if (isConfirmed) {
            statusBadge.className = 'ocr-badge ocr-badge-ok';
            statusBadge.textContent = 'Confirmed (100%)';
          } else {
            statusBadge.className = 'ocr-badge';
            statusBadge.textContent = `Confidence ${confPercent}`;
          }

          confirmLineBtn.hidden = !needsCheck;
          resetBtn.hidden =
            textarea.value === origText &&
            block.confidence === origConfidence &&
            Boolean(block.confirmed) === origConfirmed;
        };
        rowRefreshers.push(refreshRowState);

        textarea.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
          }
        });

        textarea.addEventListener('input', () => {
          const sanitized = textarea.value.replace(/[\r\n]+/g, ' ');
          if (sanitized !== textarea.value) {
            textarea.value = sanitized;
          }
          block.text = sanitized;
          // Mark line as confirmed (confidence = 1) once edited by the user
          block.confidence = 1;
          autoResizeTextarea(textarea);
          refreshRowState();
          refreshPageConfirmBtn();
          updateSummaryChip();
          emitChange();
        });

        refreshRowState();
        if (typeof queueMicrotask === 'function') {
          queueMicrotask(() => autoResizeTextarea(textarea));
        }

        const rowHeader = el('div', { class: 'ocr-block-header' }, [
          el('label', { for: inputId }, [`Line ${blockIdx + 1}`]),
          statusBadge,
        ]);

        const rowControls = el('div', { class: 'ocr-block-controls' }, [
          textarea,
          confirmLineBtn,
          resetBtn,
        ]);

        rowContainer.append(rowHeader, digitHint, rowControls);
        blocksList.append(rowContainer);
      });

      const pageTitle =
        (doc.pages ?? []).length > 1
          ? el('h3', {}, [`Page ${page.pageIndex + 1}`])
          : el('span', { class: 'ocr-page-label' }, ['Page 1']);
      const pageHeader = el('div', { class: 'ocr-page-header' }, [pageTitle, confirmPageBtn]);

      pageSections.push(
        el('div', { class: 'ocr-page' }, [
          pageHeader,
          blocksList,
        ])
      );
    });

    const body = previewPane
      ? [
          el('div', { class: 'ocr-split-layout' }, [
            previewPane,
            el('div', { class: 'ocr-editor-pane' }, pageSections),
          ]),
        ]
      : pageSections;

    root.append(card(docTitle, body));
  });

  return root;
}
