// @ts-check
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

        const textarea = /** @type {HTMLTextAreaElement} */ (
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
