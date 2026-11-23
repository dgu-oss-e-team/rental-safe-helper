# PART 1 Technical Report — Document Input, Parsing, OCR & Review UI

> **Module:** `src/features/document-input/` (`index.js`, `pdf-reader.js`, `ocr.js`, `ocr-editor.js`, `ocr-editor.css`)  
> **Owner:** Garidmaa (`@Garid1016`)

---

## 1. Overview & Architecture

PART 1 implements client-side ingestion, text/coordinate extraction, OCR fallback, and interactive text verification inside the browser—ensuring raw PDFs and photos never leave the user's device.

1. **Embedded-Text PDF Parsing & Item-Level Span Tracking (`pdf-reader.js`):**
   - Uses `pdf.js` configured with locally bundled CMap, standard font, Wasm, and ICC assets so Korean CID fonts render and extract reliably offline and on GitHub Pages.
   - Applies `pdfjsLib.Util.transform` to normalize rotated/scaled PDF coordinates into top-left viewport space, groups text items into horizontal lines (`Y_THRESHOLD = 4px`), and emits normalized `0..1` line bounding boxes (`bbox`) alongside character-offset `spans` for each text item so downstream redaction masks sensitive fields without covering adjacent columns.
   - Includes single-glyph spacing and fake-bold deduplication rules so bold fonts that emit one character per text item (e.g., BatangChe Bold rendering `"47-12"`) stay intact rather than splitting into space-separated characters (`"4 7 - 1 2"`).
2. **Scanned PDF & Mobile Photo OCR (`pdf-reader.js`, `ocr.js`, `index.js`):**
   - Automatically falls back to offscreen canvas rendering (`scale = 2.0`) and `Tesseract.js` (`kor+eng`) when a PDF has no embedded text layer or an image file is uploaded, producing line-level bounding boxes and confidence scores with dynamic page dimensions, and returning normalized `DocumentModel` blocks (with `documentType: UNKNOWN`, leaving document type classification and field extraction to PART 2).
3. **Interactive OCR Verification Screen (`ocr-editor.js`, `ocr-editor.css`):**
   - Displays side-by-side page previews and XSS-safe line editors (`textContent` / `textarea.value`), highlighting low-confidence lines (`< 0.75` for general text, `< 0.80` for lines containing digits).
   - Provides a **`Confirm this page`** button to batch-confirm flagged text-only lines on a page by setting `confirmed: true` while preserving the original OCR `confidence` score (so downstream risk checks can still treat unedited low-confidence name lines cautiously), while preserving strict one-by-one confirmation (`confidence = 1`) for flagged lines containing digits (ID numbers, bank accounts, phone numbers, and amounts).

---

## 2. Known Limitations

- **Single-Span Table Cells in Chrome-Printed PDFs:** Chrome's print-to-PDF engine occasionally emits an entire table row or multi-column cell as a single `pdf.js` text item. Because `pdf.js` does not expose per-glyph advance widths inside a single item, span-level redaction masks the full item bounding box rather than sub-splitting at whitespace—prioritizing zero under-masking over narrower boxes.
- **OCR Character Substitutions on Phone Photos:** PART 5 crops the page and removes shadows before OCR (`photo-enhance.js`), but angled or shadowed phone photos can still produce visual look-alike substitutions (e.g., `"*******"` → `"#xwssnr"` and `"서울"` → `"서물"`). These are mitigated by the interactive review screen (including mandatory per-line confirmation on digit lines) and downstream PII/leak detection guards.
