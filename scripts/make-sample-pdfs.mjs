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

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
const outDir = dense || forms || individual ? join(root, 'tests', 'fixtures') : join(root, 'public', 'samples');
const names = individual
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
  for (const name of names) {
    const url = pathToFileURL(join(root, 'scripts', 'sample-docs', `${name}.html`)).href;
    await send('Page.navigate', { url });
    await sleep(1000);
    // 글꼴을 다 받을 때까지 기다린다 (안 기다리면 한글이 빈칸으로 찍힘)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    writeFileSync(join(outDir, `${name}.pdf`), Buffer.from(pdf.result.data, 'base64'));
    console.log(`만듦: ${join(outDir, `${name}.pdf`)}`);
  }
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
