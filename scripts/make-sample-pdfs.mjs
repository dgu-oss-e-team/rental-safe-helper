// PART 5. 가상 등기부·계약서 HTML을 글자가 들어 있는 PDF(text_pdf)로 만든다. (테스트·시연용, 가짜 데이터만)
//
// 사용법: node scripts/make-sample-pdfs.mjs "<Chrome 또는 Edge 실행 파일 경로>" [--dense | --forms | --individual]
//   예) node scripts/make-sample-pdfs.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe"
// 결과: public/samples/sample-registry.pdf, public/samples/sample-lease.pdf (시연용)
// --dense: tests/fixtures/dense-registry.pdf, tests/fixtures/dense-lease.pdf (테스트용, #139)
//   공개 양식 구조를 따른 빽빽한 가짜 서류. 마스킹 상자가 옆 글자를 덮지 않는지 확인한다. 사이트에는 들어가지 않는다.
// --forms: tests/fixtures/form-private-lease.pdf, form-coowner-registry.pdf, form-trust-registry.pdf (테스트용, #165)
//   실제 양식(민간임대 계약서, 개인 공유 등기부, 법인·신탁 등기부) 모양의 가짜 서류. 실제 서류 점검에서 나온 문제를 각 파트가 재현한다.
// --individual: tests/fixtures/form-individual-registry.pdf, form-individual-lease.pdf, form-individual-lease-risky.pdf (평가 세트, #251)
//   실제 열람본(3쪽)·민간임대 표준계약서(6쪽)의 쪽 구성 그대로인 가짜 한 쌍 + 같은 집의 위험 판정용 계약서.
// 한글 글꼴(Noto Sans KR, OFL)을 Google Fonts에서 받으므로 인터넷 연결이 필요하다.
// --eval: tests/eval/docs/set1~4-*.pdf (평가 세트, #300). 원본은 scripts/sample-docs/eval/
//   실제 서식(인터넷등기소 열람본 3쪽, 민간임대 표준계약서 HWP 6쪽)과 쪽 구성·줄 바꿈·글꼴이 같은 가짜 서류 4세트.
//   글꼴은 실제 서류처럼 Windows 글꼴(등기부 바탕체, 계약서 돋움체·맑은 고딕)을 쓴다 → Windows에서 만든다.
//   (세 글꼴 모두 임베딩 허용 "Editable"이라 PDF에 넣어 공개해도 된다)
//   특약 별지(*-terms.html)는 계약서 6쪽 뒤에 붙여 계약서 PDF 하나(7쪽)로 만든다.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browserPath = process.argv[2];
if (!browserPath) {
  console.error('Chrome 또는 Edge 실행 파일 경로를 넣어 주세요.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const dense = process.argv.includes('--dense');
const forms = process.argv.includes('--forms');
const individual = process.argv.includes('--individual');
const evalSet = process.argv.includes('--eval');
/** --eval: 만들 PDF → 이어 붙일 HTML 원본(순서대로) */
const EVAL_DOCS = {
  'set1-registry': ['set1-registry'],
  'set1-lease': ['set1-lease'],
  'set1-lease-risky': ['set1-lease-risky', 'set1-lease-risky-terms'],
  'set2-registry': ['set2-registry'],
  'set2-lease': ['set2-lease', 'set2-lease-terms'],
  'set3-registry': ['set3-registry'],
  'set3-lease': ['set3-lease', 'set3-lease-terms'],
  'set4-registry': ['set4-registry'],
  'set4-lease': ['set4-lease', 'set4-lease-terms'],
};
const outDir = evalSet
  ? join(root, 'tests', 'eval', 'docs')
  : dense || forms || individual
    ? join(root, 'tests', 'fixtures')
    : join(root, 'public', 'samples');
const htmlDir = evalSet ? join(root, 'scripts', 'sample-docs', 'eval') : join(root, 'scripts', 'sample-docs');
const names = evalSet
  ? [...new Set(Object.values(EVAL_DOCS).flat())]
  : individual
  ? ['form-individual-registry', 'form-individual-lease', 'form-individual-lease-risky']
  : forms
  ? ['form-private-lease', 'form-coowner-registry', 'form-trust-registry']
  : dense
    ? ['dense-registry', 'dense-lease']
    : ['sample-registry', 'sample-lease'];
const port = 9335;
const profile = mkdtempSync(join(tmpdir(), 'sample-pdf-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(
  browserPath,
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);

try {
  let targets = [];
  for (let i = 0; i < 50 && targets.length === 0; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
    } catch {
      await sleep(200);
    }
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      waiting.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  mkdirSync(outDir, { recursive: true });
  // --eval은 HTML마다 임시 폴더에 찍고, 아래에서 별지를 붙여 최종 PDF를 만든다
  const printDir = evalSet ? join(profile, 'printed') : outDir;
  mkdirSync(printDir, { recursive: true });
  for (const name of names) {
    const url = pathToFileURL(join(htmlDir, `${name}.html`)).href;
    await send('Page.navigate', { url });
    await sleep(1000);
    // 글꼴을 다 받을 때까지 기다린다 (안 기다리면 한글이 빈칸으로 찍힘)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    writeFileSync(join(printDir, `${name}.pdf`), Buffer.from(pdf.result.data, 'base64'));
    if (!evalSet) console.log(`만듦: ${join(outDir, `${name}.pdf`)}`);
  }
  ws.close();
  if (evalSet) {
    // pdf-lib로 쪽을 이어 붙인다. 문서 정보(만든 프로그램·날짜)는 넣지 않는다.
    const { PDFDocument } = await import('pdf-lib');
    for (const [out, parts] of Object.entries(EVAL_DOCS)) {
      const doc = await PDFDocument.create({ updateMetadata: false });
      for (const part of parts) {
        const src = await PDFDocument.load(readFileSync(join(printDir, `${part}.pdf`)), { updateMetadata: false });
        for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
      }
      writeFileSync(join(outDir, `${out}.pdf`), await doc.save());
      console.log(`만듦: ${join(outDir, `${out}.pdf`)} (${doc.getPageCount()}쪽)`);
    }
  }
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
