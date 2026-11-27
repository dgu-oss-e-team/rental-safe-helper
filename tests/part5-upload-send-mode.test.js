// @vitest-environment happy-dom
// PART 5. ① 화면의 "AI로 보내지 않는다" 글은 PART 4 설정(send-mode.json)을 따른다 (#380, 정연님 리뷰)
// 설정을 바꾼 경우(등기부를 OMIT 대신 SUMMARY로)를 가짜 설정으로 확인한다. 가상 데이터만 사용한다.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/masking/send-mode.json', () => ({
  default: {
    FRAUD_CHECK: { REGISTRY: 'SUMMARY', LEASE_CONTRACT: 'PARTY_SUMMARY' },
    CLAUSE_EXPLANATION: { REGISTRY: 'MASKED_TEXT', LEASE_CONTRACT: 'PARTY_SUMMARY' },
    // 지금 설정은 OMIT. 나중에 SUMMARY로 바뀌었다고 가정한다
    CONTRACT_EXPLANATION: { REGISTRY: 'SUMMARY', LEASE_CONTRACT: 'PARTY_SUMMARY' },
  },
}));

const { uploadScreen } = await import('../src/app/screens/upload.js');
const { initialState } = await import('../src/app/app-state.js');
const { MASKING_PURPOSE } = await import('../src/shared/document-model.js');

const fakeAct = () => /** @type {any} */ ({ setFiles: vi.fn(), analyze: vi.fn(), analyzeSample: vi.fn(), goTo: vi.fn(), setPurpose: vi.fn() });

describe('PART 5 ① "not sent to AI" 글은 send-mode.json을 따른다', () => {
  it('계약 조건 설명인데 등기부를 보내는 설정이면 "not sent to AI"라고 쓰지 않는다', () => {
    const node = uploadScreen(/** @type {any} */ ({ ...initialState(), purpose: MASKING_PURPOSE.CONTRACT_EXPLANATION }), fakeAct());
    expect(node.querySelector('#registry-optin-text')?.textContent).not.toContain('not sent to AI');
    document.body.append(node);
    /** @type {HTMLButtonElement} */ (node.querySelector('#add-registry')).click();
    expect(node.querySelector('#registry-file-extra')).toBeNull();
    /** @type {HTMLButtonElement} */ (node.querySelector('#close-registry')).click();
    node.remove();
  });
});
