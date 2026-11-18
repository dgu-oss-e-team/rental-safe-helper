import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfjsDistDir = path.resolve(__dirname, 'node_modules/pdfjs-dist');

function pdfjsStaticAssetsPlugin() {
  const assetDirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

  const serveMiddleware = (base) => (req, res, next) => {
    const urlPath = (req.url || '').split('?')[0];
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const relPath = urlPath.startsWith(normalizedBase)
      ? urlPath.slice(normalizedBase.length)
      : urlPath.replace(/^\//, '');

    const matchedDir = assetDirs.find((dir) => relPath.startsWith(`${dir}/`));
    if (!matchedDir) return next();

    const filePath = path.resolve(pdfjsDistDir, relPath);
    if (!filePath.startsWith(path.resolve(pdfjsDistDir, matchedDir))) {
      return next();
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const contentType = filePath.endsWith('.wasm')
        ? 'application/wasm'
        : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    next();
  };

  return {
    name: 'pdfjs-static-assets',
    configureServer(server) {
      server.middlewares.use(serveMiddleware(server.config.base || '/'));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveMiddleware(server.config.base || '/'));
    },
    writeBundle(options) {
      const outDir = options.dir || path.resolve(__dirname, 'dist');
      for (const dir of assetDirs) {
        const src = path.join(pdfjsDistDir, dir);
        const dest = path.join(outDir, dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  base: '/rental-safe-helper/',
  plugins: [pdfjsStaticAssetsPlugin()],
});