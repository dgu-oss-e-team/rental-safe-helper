// PART 5. 가상 등기부·계약서 HTML을 글자가 들어 있는 PDF(text_pdf)로 만든다. (테스트·시연용, 가짜 데이터만)
//
// 사용법: node scripts/make-sample-pdfs.mjs "<Chrome 또는 Edge 실행 파일 경로>"
//   예) node scripts/make-sample-pdfs.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe"
// 결과: public/samples/sample-registry.pdf, public/samples/sample-lease.pdf
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
const outDir = join(root, 'public', 'samples');
const names = ['sample-registry', 'sample-lease'];
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
    console.log(`만듦: public/samples/${name}.pdf`);
  }
  ws.close();
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
