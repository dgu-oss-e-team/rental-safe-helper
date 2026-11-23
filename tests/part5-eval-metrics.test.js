// PART 5. 평가 지표 계산 함수 (#251). 작은 가짜 정답표로 계산이 맞는지 본다.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  compact,
  secretsOf,
  isVisible,
  isFalsePositive,
  longestCommon,
  countByType,
  rate,
  percent,
  checkTruthDoc,
} from './eval/metrics.js';
import { PII_TYPE } from '../src/shared/document-model.js';

describe('PART 5 평가 지표: 정답 값이 글에 보이는지 (#251)', () => {
  it('띄어쓰기·줄바꿈을 무시하고 찾는다', () => {
    const item = { type: 'ADDRESS', value: '서울특별시 중구 가상로 12, 3동 702호', secret: '가상로 12, 3동 702호' };
    expect(isVisible(item, '주소 서울특별시 중구 가상로\n12,3동 702호')).toBe(true);
    expect(isVisible(item, '주소 서울특별시 중구 [REDACTED]')).toBe(false);
  });

  it('주소는 secret(시·구 뒤)만 보면 된다: 사기 위험 확인 목적의 "서울특별시 중구"는 새는 것이 아니다', () => {
    const item = { type: 'ADDRESS', value: '서울특별시 중구 가상로 12', secret: '가상로 12' };
    expect(isVisible(item, '소재지 서울특별시 중구')).toBe(false);
  });

  it('*로 가린 뒷자리는 빼고 앞자리만 본다', () => {
    const item = { type: 'RESIDENT_ID', value: '700101-1******' };
    expect(secretsOf(item)).toEqual(['700101-1']);
    expect(isVisible(item, '주민등록번호 700101-1******')).toBe(true);
    expect(isVisible(item, '주민등록번호 [REDACTED]')).toBe(false);
  });

  it('secret이 여러 개면 하나라도 보이면 보인다', () => {
    const item = { type: 'ADDRESS', value: '서울특별시 중구 가상동2가 47-12 가상하우스', secret: ['47-12', '가상하우스'] };
    expect(isVisible(item, '[REDACTED] 가상하우스')).toBe(true);
    expect(isVisible(item, '[REDACTED]')).toBe(false);
  });
});

describe('PART 5 평가 지표: 과잉 마스킹 (#251)', () => {
  const truth = [
    { type: 'ADDRESS', value: '서울특별시 중구 가상로3길 21' },
    { type: 'PERSON_NAME', value: '김가상' },
  ];

  it('정답 값과 같거나, 두 줄 주소의 조각이면 과잉이 아니다', () => {
    expect(isFalsePositive({ value: '김가상' }, truth)).toBe(false);
    expect(isFalsePositive({ value: '서울특별시 중구 가상로3길' }, truth)).toBe(false);
  });

  it('옆 칸 글자가 조금 붙었어도 대부분이 정답이면 과잉이 아니다', () => {
    expect(isFalsePositive({ value: '서울특별시 중구 가상로3길 2층' }, truth)).toBe(false);
  });

  it('시·구 말고는 개인정보가 아닌 글자면 과잉이다', () => {
    expect(isFalsePositive({ value: '서울특별시 중구 22층 공동주택(아파트)' }, truth)).toBe(true);
    expect(isFalsePositive({ value: '주식회사가상은행' }, truth)).toBe(true);
  });

  it('longestCommon(): 가장 긴 연속 공통 글자 수', () => {
    expect(longestCommon('가상로3길2층', '서울가상로3길21')).toBe(6); // "가상로3길2"
    expect(longestCommon('abc', 'xyz')).toBe(0);
  });
});

describe('PART 5 평가 지표: 집계·정답표 검사 (#251)', () => {
  it('유형별로 정답 수와 놓친 수를 센다', () => {
    const rows = [
      { item: { type: 'PERSON_NAME', value: 'a' }, missed: false },
      { item: { type: 'PERSON_NAME', value: 'b' }, missed: true },
      { item: { type: 'ADDRESS', value: 'c' }, missed: false },
    ];
    expect(countByType(rows)).toEqual({ PERSON_NAME: { total: 2, missed: 1 }, ADDRESS: { total: 1, missed: 0 } });
  });

  it('비율: 분모가 0이면 null, 퍼센트는 소수 한 자리', () => {
    expect(rate(1, 0)).toBeNull();
    expect(percent(rate(1, 3))).toBe('33.3%');
    expect(percent(null)).toBe('-');
  });

  it('정답표 형식 검사: 모르는 종류·빈 값·중복을 알려 준다', () => {
    const bad = {
      document: 'x',
      file: 'x.pdf',
      documentType: 'REGISTRY',
      form: 'x',
      pii: [
        { type: 'NAME', value: '김가상' },
        { type: 'PERSON_NAME', value: '김가상' },
        { type: 'PERSON_NAME', value: '김 가상' },
      ],
    };
    expect(checkTruthDoc(bad, Object.values(PII_TYPE))).toEqual(['모르는 종류: NAME', '같은 항목이 두 번: PERSON_NAME']);
  });

  it('저장소의 정답표 7개(가짜세트 1·2·3, #300)는 모두 형식이 맞고, 서류 파일이 있다', () => {
    const dir = new URL('./eval/truth/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(7);
    for (const f of files) {
      const doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      expect(checkTruthDoc(doc, Object.values(PII_TYPE)), f).toEqual([]);
      expect(() => readFileSync(new URL(`../${doc.file}`, import.meta.url)), doc.file).not.toThrow();
      expect(compact(doc.document)).toBe(f.replace('.json', ''));
    }
  });
});
