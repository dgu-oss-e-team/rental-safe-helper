// 사진 평가 세트 OCR 만들기 (#251). 설명은 vite.config.mjs 맨 위에 있다.
import photoSet from '../../tests/eval/photo-set.json';
import { slotToSource } from '../../src/app/photo-pages.js';
import { readDocuments, countLinesToCheck } from '../../src/app/pipeline.js';

// 창이 가려져 있으면 requestAnimationFrame이 멈춰 pdf.js가 그리지 못한다
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);

const log = (s) => {
  document.getElementById('log').textContent += s + '\n';
};

async function photosOf(doc) {
  const files = [];
  for (const [i, name] of doc.files.entries()) {
    const res = await fetch(`/__ocr/photo/${doc.document}/${i}`);
    if (!res.ok) throw new Error(`photo ${doc.document} #${i}: HTTP ${res.status} (OCR_PHOTO_DIR?)`);
    files.push(new File([await res.blob()], name, { type: 'image/jpeg' }));
  }
  return files;
}

async function capture(doc) {
  const started = performance.now();
  const source = await slotToSource(await photosOf(doc), `${doc.document}.pdf`);
  const read = await readDocuments({ files: [source.file], parts: [source.parts] }, { allowLowConfidence: true });
  if (!read.ok) throw new Error(`${doc.document}: ${read.step} ${read.error.code}`);
  const model = read.data.documents[0];
  const res = await fetch(`/__ocr/save/${doc.document}`, {
    method: 'POST',
    body: JSON.stringify(model),
  });
  if (!res.ok) throw new Error(`save ${doc.document}: HTTP ${res.status}`);
  const blocks = model.pages.reduce((n, p) => n + p.blocks.length, 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  return `${doc.document}: ${model.pages.length} pages, ${blocks} lines, ${countLinesToCheck([model])} to check, ${seconds}s`;
}

async function run() {
  window.__ocrCapture = { done: false, results: [], error: null };
  try {
    for (const doc of photoSet.documents) {
      const line = await capture(doc);
      window.__ocrCapture.results.push(line);
      log(line);
    }
  } catch (e) {
    window.__ocrCapture.error = String(e?.message ?? e);
    log(`ERROR ${window.__ocrCapture.error}`);
  }
  window.__ocrCapture.done = true;
}

document.getElementById('run').addEventListener('click', run);
window.runOcrCapture = run;
