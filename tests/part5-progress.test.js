// PART 5. 사진·서류 처리 중 진행 표시 (가상 데이터만)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readDocuments } from '../src/app/pipeline.js';
import { slotToSource } from '../src/app/photo-pages.js';
import { readingText, preparingText } from '../src/app/progress-text.js';

const samplePdf = (name) =>
  new File([readFileSync(new URL(`../public/samples/${name}.pdf`, import.meta.url))], `${name}.pdf`, { type: 'application/pdf' });
const photo = (name) => new File([new Uint8Array([1])], name, { type: 'image/jpeg' });

describe('진행 문구', () => {
  it('어느 칸의 몇 번째 서류인지, 쪽을 알면 몇 쪽인지 보여 준다', () => {
    const slots = ['registry', 'lease'];
    expect(readingText({ docIndex: 0, docCount: 2, partIndex: 0, partCount: 1 }, slots)).toBe('Reading the registry (1 of 2)…');
    expect(readingText({ docIndex: 1, docCount: 2, partIndex: 0, partCount: 1, pageIndex: 2, pageCount: 7 }, slots)).toBe(
      'Reading the lease (2 of 2) · page 3 of 7…',
    );
    expect(readingText({ docIndex: 1, docCount: 2, partIndex: 1, partCount: 2 }, slots)).toBe('Reading the lease (2 of 2) · file 2 of 2…');
  });

  it('칸을 모르거나 서류·쪽이 하나면 짧게 쓴다', () => {
    expect(readingText({ docIndex: 0, docCount: 1, partIndex: 0, partCount: 1, pageIndex: 0, pageCount: 1 })).toBe('Reading document…');
  });

  it('사진 준비 문구', () => {
    expect(preparingText(2, 10)).toBe('Preparing photo 3 of 10…');
    expect(preparingText(0, 1)).toBe('Preparing your files…');
  });
});

describe('readDocuments 진행 알림', () => {
  it('서류마다 읽기 전에 알린다', async () => {
    const seen = [];
    const r = await readDocuments(
      { files: [samplePdf('sample-registry'), samplePdf('sample-lease')] },
      { onProgress: (p) => seen.push(p) },
    );
    expect(r.ok).toBe(true);
    expect(seen).toEqual([
      { docIndex: 0, docCount: 2, partIndex: 0, partCount: 1 },
      { docIndex: 1, docCount: 2, partIndex: 0, partCount: 1 },
    ]);
  });

  it('한 칸에 여러 파일이면 조각마다 알린다', async () => {
    const lease = samplePdf('sample-lease');
    const seen = [];
    const r = await readDocuments({ files: [lease], parts: [[lease, samplePdf('sample-lease')]] }, { onProgress: (p) => seen.push(p) });
    expect(r.ok).toBe(true);
    expect(seen.map((p) => `${p.partIndex}/${p.partCount}`)).toEqual(['0/2', '1/2']);
  });

  it('진행 표시가 오류를 내도 읽기는 계속된다', async () => {
    const r = await readDocuments(
      { files: [samplePdf('sample-registry')] },
      {
        onProgress: () => {
          throw new Error('render failed');
        },
      },
    );
    expect(r.ok).toBe(true);
  });
});

describe('slotToSource 사진 준비 알림', () => {
  it('사진 PDF를 만드는 함수에 onPhoto를 넘긴다', async () => {
    let count = 0;
    const toPdf = async (photos, name, onPhoto) => {
      for (const _ of photos) onPhoto?.();
      return new File([new Uint8Array([1])], name, { type: 'application/pdf' });
    };
    await slotToSource([photo('p1.jpg'), photo('p2.jpg'), photo('p3.jpg')], 'lease.pdf', { toPdf, onPhoto: () => count++ });
    expect(count).toBe(3);
  });
});
