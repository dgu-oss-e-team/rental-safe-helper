// PART 5. 사진 평가 세트용 OCR 결과 만들기 (#251)
//
// 사진을 앱과 같은 코드(slotToSource → readDocuments)로 브라우저에서 읽고, 결과 DocumentModel을
// tests/eval/photo-set.json의 "ocr" 경로에 저장한다. 사진 원본은 저장소에 복사하지 않는다.
//
// 실행 (Git Bash):
//   OCR_PHOTO_DIR="<사진 폴더들이 있는 폴더>" npx vite --config scripts/ocr-capture/vite.config.mjs
//   (환경 변수 대신 scripts/ocr-capture/photo-dir.local 파일 첫 줄에 폴더 경로를 적어도 된다)
//   → 브라우저에서 http://localhost:5175/rental-safe-helper/scripts/ocr-capture/ 열기 → "Run" 누르기
// 사진·서류는 모두 가짜 서류를 찍은 것이어야 한다. 실제 서류 사진은 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from '../../vite.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const photoSet = JSON.parse(fs.readFileSync(path.join(root, 'tests/eval/photo-set.json'), 'utf8'));
/** 사진 폴더: 환경 변수 OCR_PHOTO_DIR, 없으면 scripts/ocr-capture/photo-dir.local 파일 첫 줄 (*.local은 gitignore) */
function findPhotoDir() {
  if (process.env.OCR_PHOTO_DIR) return path.resolve(process.env.OCR_PHOTO_DIR);
  const local = path.join(root, 'scripts/ocr-capture/photo-dir.local');
  if (!fs.existsSync(local)) return null;
  const first = fs.readFileSync(local, 'utf8').split(/\r?\n/)[0].trim();
  return first ? path.resolve(first) : null;
}
const photoDir = findPhotoDir();

/** photo-set.json에 적힌 사진과 저장 경로만 다룬다 (그 밖의 경로는 거절) */
function capturePlugin() {
  const docs = new Map(photoSet.documents.map((d) => [d.document, d]));
  return {
    name: 'ocr-capture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const m = url.pathname.match(/\/__ocr\/(photo|save)\/([\w-]+)(?:\/(\d+))?$/);
        if (!m) return next();
        const doc = docs.get(m[2]);
        if (!doc) return void res.writeHead(404).end();
        if (m[1] === 'photo' && req.method === 'GET') {
          const file = doc.files[Number(m[3])];
          if (!photoDir || !file) return void res.writeHead(404).end();
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'X-File-Name': encodeURIComponent(file),
          });
          fs.createReadStream(path.join(photoDir, doc.folder, file)).pipe(res);
          return;
        }
        if (m[1] === 'save' && req.method === 'POST') {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const model = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const out = path.join(root, doc.ocr);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, JSON.stringify(model, null, 1) + '\n');
            res.writeHead(200).end('saved');
          });
          return;
        }
        res.writeHead(405).end();
      });
    },
  };
}

export default mergeConfig(base, {
  root,
  server: { port: 5175, strictPort: true },
  plugins: [capturePlugin()],
});
