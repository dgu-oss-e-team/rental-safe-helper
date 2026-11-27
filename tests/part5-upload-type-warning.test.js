// @vitest-environment happy-dom
// PART 5. ① 업로드 화면: 칸에 다른 서류를 넣으면 분석 전에 그 칸 아래에 바로 안내 (#365, #363 리뷰)
// tests/fixtures/*.pdf는 공개 양식 구조를 따라 만든 가짜 서류다. 파일 이름도 가짜다.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uploadScreen } from '../src/app/screens/upload.js';
import { initialState } from '../src/app/app-state.js';
import { uploadTypeNotices } from '../src/app/upload-check.js';
import { quickDocumentType } from '../src/app/pipeline.js';
import { DOCUMENT_TYPE } from '../src/shared/document-model.js';

const { REGISTRY, LEASE_CONTRACT, UNKNOWN } = DOCUMENT_TYPE;
const fakeAct = () => /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn() });
const pdf = (/** @type {string} */ name) => new File(['x'], name, { type: 'application/pdf' });
const photo = (/** @type {string} */ name) => new File(['x'], name, { type: 'image/jpeg' });
const fixture = (/** @type {string} */ name) =>
  // happy-dom 환경에서는 URL이 브라우저 것이라 파일 경로로 읽는다
  new File([readFileSync(resolve('tests/fixtures', name))], name, { type: 'application/pdf' });

describe('PART 5 uploadTypeNotices: 칸과 다른 서류 안내 문구', () => {
  it('파일 하나가 칸에 맞으면 안내하지 않는다', () => {
    expect(uploadTypeNotices('registry', [REGISTRY])).toEqual([]);
    expect(uploadTypeNotices('lease', [LEASE_CONTRACT])).toEqual([]);
  });

  it('등기부 칸에 계약서를 넣으면 계약서 칸에 올리라고 안내한다', () => {
    const [text] = uploadTypeNotices('registry', [LEASE_CONTRACT]);
    expect(text).toContain('looks like a lease contract, not a property register');
    expect(text).toContain('upload it in the lease contract box');
  });

  it('계약서 칸에 등기부를 넣으면 등기부 칸에 올리라고 안내한다', () => {
    const [text] = uploadTypeNotices('lease', [REGISTRY]);
    expect(text).toContain('looks like a property register, not a lease contract');
    expect(text).toContain('upload it in the property register box');
  });

  it('종류를 모르는 파일 하나는 맞는 서류인지 확인하라고 한다', () => {
    expect(uploadTypeNotices('registry', [UNKNOWN])).toEqual([
      'We could not tell what this file is. Please check that it is the property register (등기부등본).',
    ]);
    expect(uploadTypeNotices('lease', [UNKNOWN])[0]).toContain('lease contract (임대차계약서)');
  });

  it('아직 보는 중(undefined)이거나 판별하지 않은 사진·스캔(null)은 안내하지 않는다', () => {
    expect(uploadTypeNotices('registry', [undefined])).toEqual([]);
    expect(uploadTypeNotices('registry', [null])).toEqual([]);
    expect(uploadTypeNotices('lease', [null, undefined])).toEqual([]);
  });

  it('여러 파일 중 다른 서류로 보이는 파일만 몇 번째인지 알려 준다', () => {
    const notices = uploadTypeNotices('lease', [LEASE_CONTRACT, REGISTRY, null]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^File 2 looks like a property register, not a lease contract\./);
  });

  it('여러 파일 중 종류를 모르는 파일(특약 별지 등)은 안내하지 않는다', () => {
    expect(uploadTypeNotices('lease', [LEASE_CONTRACT, UNKNOWN])).toEqual([]);
  });

  it('안내에 "safe" 같은 말을 쓰지 않는다', () => {
    const all = [
      ...uploadTypeNotices('registry', [LEASE_CONTRACT]),
      ...uploadTypeNotices('registry', [UNKNOWN]),
      ...uploadTypeNotices('lease', [LEASE_CONTRACT, REGISTRY]),
    ].join(' ');
    expect(all).not.toMatch(/\bsafe\b|no risk/i);
  });
});

describe('PART 5 ① 화면: 파일 이름 아래 안내', () => {
  /** @param {any} files @param {Map<File, string | null>} types */
  const render = (files, types) =>
    uploadScreen(/** @type {any} */ ({ ...initialState(), files: { registry: null, lease: null, ...files }, uploadTypes: types }), fakeAct());

  it('등기부 칸의 PDF가 계약서로 보이면 그 칸 아래에 안내가 보인다', () => {
    const f = pdf('a.pdf');
    const node = render({ registry: f }, new Map([[f, LEASE_CONTRACT]]));
    const warning = node.querySelector('#registry-file-type-warning');
    expect(warning?.textContent).toContain('looks like a lease contract');
    expect(warning?.getAttribute('role')).toBe('status');
    // 파일 칸 설명에 이어져서 화면 낭독기로도 들린다
    expect(node.querySelector('#registry-file')?.getAttribute('aria-describedby')).toContain('registry-file-type-warning');
    // 다른 칸에는 안내가 없다
    expect(node.querySelector('#lease-file-type-warning')).toBeNull();
  });

  it('두 파일이 서로의 칸에 있으면 두 칸 모두 안내한다', () => {
    const a = pdf('a.pdf');
    const b = pdf('b.pdf');
    const node = render({ registry: a, lease: b }, new Map([[a, LEASE_CONTRACT], [b, REGISTRY]]));
    expect(node.querySelector('#registry-file-type-warning')).not.toBeNull();
    expect(node.querySelector('#lease-file-type-warning')).not.toBeNull();
  });

  it('칸에 맞는 서류, 아직 보는 중인 파일, 사진은 안내하지 않는다', () => {
    const a = pdf('a.pdf');
    const b = pdf('b.pdf');
    const node = render({ registry: a, lease: [photo('p1.jpg'), b] }, new Map([[a, REGISTRY]]));
    expect(node.querySelector('.picker-type-warning')).toBeNull();
    expect(node.querySelector('#registry-file')?.getAttribute('aria-describedby')).not.toContain('type-warning');
  });

  it('안내가 있어도 "Check my documents"는 누를 수 있다 (막지 않고 안내만)', () => {
    const f = pdf('a.pdf');
    const node = render({ registry: f }, new Map([[f, LEASE_CONTRACT]]));
    expect(/** @type {HTMLButtonElement} */ (node.querySelector('#run')).disabled).toBe(false);
  });

  it('안내에 파일 이름을 넣지 않는다', () => {
    const f = pdf('홍가상_계약서.pdf');
    const node = render({ registry: f }, new Map([[f, LEASE_CONTRACT]]));
    expect(node.querySelector('#registry-file-type-warning')?.textContent).not.toContain('홍가상');
  });
});

describe('PART 5 quickDocumentType: 글자 PDF만 바로 판별', () => {
  it('가짜 등기부 PDF는 등기부, 가짜 계약서 PDF는 계약서로 본다', async () => {
    expect(await quickDocumentType(fixture('form-individual-registry.pdf'))).toBe(REGISTRY);
    expect(await quickDocumentType(fixture('form-individual-lease.pdf'))).toBe(LEASE_CONTRACT);
    // PDF 2개를 읽어서, 전체 테스트를 한꺼번에 돌리면 기본 5초를 넘길 때가 있다 (다른 PDF 테스트와 같게 20초)
  }, 20000);

  it('읽지 못하는 파일은 판별하지 않는다 (null, 오류를 내지 않음)', async () => {
    expect(await quickDocumentType(pdf('broken.pdf'))).toBeNull();
  });
});
