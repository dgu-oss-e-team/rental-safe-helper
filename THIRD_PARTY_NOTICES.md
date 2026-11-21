# Third-Party Notices

Rental Safety Helper is released under the [MIT License](LICENSE).
It uses the open-source software listed below. Each one keeps its own license.
The full license texts are included in each package (`node_modules/<package>/LICENSE`) and in the linked repositories.

We did not modify the source code of these libraries.

## Included in the website (bundled into `dist/`)

| Library | Version | License | Copyright / Project | Used for |
|---|---|---|---|---|
| [pdf.js (pdfjs-dist)](https://github.com/mozilla/pdf.js) | 6.5.438 | Apache-2.0 | Mozilla Foundation | Reading PDFs, rendering pages, checking the masked PDF |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 | Tesseract.js contributors | Reading text in photos and scans (OCR) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | Copyright (c) 2019 Andrew Dillon | Creating the masked PDF |
| [Fuse.js](https://github.com/krisk/Fuse) | 7.5.0 | Apache-2.0 | Kiro Risk | Name similarity |
| [js-yaml](https://github.com/nodeca/js-yaml) | 5.5.0 | MIT | Copyright (C) 2011-2015 Vitaly Puzrin | Reading YAML rule files |

These libraries also bring in smaller packages (for example pako, @pdf-lib/standard-fonts, @pdf-lib/upng, tslib).
They use MIT, Zlib, 0BSD, BSD-2-Clause or Apache-2.0 licenses. The full list is in `package-lock.json`.

## Downloaded by the browser when OCR is used

Tesseract.js downloads these files from the jsDelivr CDN the first time a photo or scan is read. Your documents are not sent anywhere; only these program and data files are downloaded.

| Files | License | Project |
|---|---|---|
| Tesseract.js worker (`tesseract.js` 7.0.0) | Apache-2.0 | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) |
| Tesseract.js core (`tesseract.js-core` 7.0.0, WebAssembly build of Tesseract OCR) | Apache-2.0 | [naptha/tesseract.js-core](https://github.com/naptha/tesseract.js-core), [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract) |
| Korean and English language data (`@tesseract.js-data/kor`, `@tesseract.js-data/eng`) | MIT (npm packages); the trained data comes from tesseract-ocr/tessdata, Apache-2.0 | [naptha/tessdata](https://github.com/naptha/tessdata), [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata) |

## Fonts in the sample documents

These fonts are embedded (as subsets) in the fake sample PDFs. The PDFs are made by `scripts/make-sample-pdfs.mjs`, which loads the fonts from Google Fonts. They stand in for the fonts used on real Korean property registers and lease contracts (Batang, Gulim, Dotum), which cannot be redistributed.

| Font | License | Where |
|---|---|---|
| [Nanum Myeongjo](https://fonts.google.com/specimen/Nanum+Myeongjo) | SIL Open Font License 1.1 | `public/samples/sample-registry.pdf` (text), `public/samples/sample-lease.pdf` (clauses), test-only `tests/fixtures/form-*.pdf` |
| [Courier Prime](https://fonts.google.com/specimen/Courier+Prime) | SIL Open Font License 1.1 | `public/samples/sample-registry.pdf` (numbers and Latin letters, fixed width like BatangChe), test-only `tests/fixtures/form-*-registry.pdf` |
| [Nanum Gothic](https://fonts.google.com/specimen/Nanum+Gothic) | SIL Open Font License 1.1 | `public/samples/sample-lease.pdf` (body text), test-only `tests/fixtures/form-private-lease.pdf`, `tests/fixtures/form-individual-lease*.pdf` |
| [Nanum Gothic Coding](https://fonts.google.com/specimen/Nanum+Gothic+Coding) | SIL Open Font License 1.1 | `public/samples/sample-lease.pdf` (amounts and numbers), test-only `tests/fixtures/form-private-lease.pdf` |
| [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) | SIL Open Font License 1.1 | `public/samples/sample-lease.pdf` (titles), the test-only `tests/fixtures/dense-*.pdf`, and titles in `tests/fixtures/form-private-lease.pdf`, `tests/fixtures/form-individual-lease*.pdf` |
| [Noto Sans Math](https://fonts.google.com/noto/specimen/Noto+Sans+Math) | SIL Open Font License 1.1 | test-only `tests/fixtures/form-individual-lease*.pdf` (symbols such as √ and ∼ that the Nanum fonts do not have) |

## Rules referenced in our code

| Project | License | Where |
|---|---|---|
| [ko-pii](https://github.com/Marker-Inc-Korea/ko-pii) | MIT, Copyright (c) 2026 Marker Inc. | Korean personal information patterns in `src/features/document-analysis/pii-patterns.js` (rules rewritten in JavaScript, source noted in the file) |

## Development only (not included in the website)

[Vite](https://github.com/vitejs/vite) (MIT), [Vitest](https://github.com/vitest-dev/vitest) (MIT), [happy-dom](https://github.com/capricorn86/happy-dom) (MIT).

[argparse](https://github.com/nodeca/argparse) (PSF-2.0) is installed together with js-yaml for its command-line tool. The website does not use it, and it is not in `dist/`.
