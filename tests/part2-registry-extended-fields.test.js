import { describe, it, expect } from 'vitest';
import { findRegistryRights, findUnknownActiveCount } from '../src/features/document-analysis/field-extractor.js';
import { extractFields } from '../src/features/document-analysis/index.js';
import { DOCUMENT_TYPE, SOURCE_TYPE } from '../src/shared/document-model.js';

const GAP = '【 갑 구 】 (소유권에 관한 사항)';
const EUL = '【 을 구 】 (소유권 이외의 권리에 관한 사항)';
const registry = (gap, eul = []) => ['등기사항전부증명서(말소사항 포함)', GAP, ...gap, EUL, ...eul];

describe('PART 2 등기부 확장 권리 종류 및 권리자·원인 (#348)', () => {
  it('가처분(PROVISIONAL_DISPOSITION), 가등기(PROVISIONAL_REGISTRATION), 경매개시결정(AUCTION)을 구분한다', () => {
    const r = findRegistryRights(
      registry([
        '2 처분금지가처분 2024년3월1일 서울중앙지방법원의 가처분결정(2024카합100) 채권자 박가상',
        '3 소유권이전청구권가등기 2024년5월10일 매매예약 가등기권리자 주식회사가상개발',
        '4 임의경매개시결정 2024년8월20일 서울중앙지방법원의 경매개시결정(2024타경555) 채권자 가상저축은행',
      ]),
    );
    expect(r).toEqual([
      {
        kind: 'PROVISIONAL_DISPOSITION',
        maxClaimAmount: null,
        cancelled: false,
        receivedAt: '2024-03-01',
        holder: '박가상',
        holderIsCompany: false,
        cause: '가처분결정(2024카합100)',
      },
      {
        kind: 'PROVISIONAL_REGISTRATION',
        maxClaimAmount: null,
        cancelled: false,
        receivedAt: '2024-05-10',
        holder: '주식회사가상개발',
        holderIsCompany: true,
        cause: '매매예약',
      },
      {
        kind: 'AUCTION',
        maxClaimAmount: null,
        cancelled: false,
        receivedAt: '2024-08-20',
        holder: '가상저축은행',
        holderIsCompany: true,
        cause: '경매개시결정(2024타경555)',
      },
    ]);
  });

  it('다음 줄로 넘어간 근저당권자·등기원인과 개인/법인 여부를 정확히 읽는다', () => {
    const r = findRegistryRights(
      registry(
        [],
        [
          '1 근저당권설정 2023년4월12일 2023년4월12일 설정계약',
          '채권최고액 금150,000,000원',
          '근저당권자 김개인 850101-1****** 서울특별시 강남구 가상로 10',
        ],
      ),
    );
    expect(r).toEqual([
      {
        kind: 'MORTGAGE',
        maxClaimAmount: 150000000,
        cancelled: false,
        receivedAt: '2023-04-12',
        holder: '김개인',
        holderIsCompany: false,
        cause: '설정계약',
      },
    ]);
  });

  it('권리자가 없으면 holder와 holderIsCompany 모두 null이다', () => {
    const r = findRegistryRights(registry([], ['1 전세권설정 2023년1월1일 전세금 금200,000,000원']));
    expect(r?.[0]).toMatchObject({
      kind: 'JEONSE',
      holder: null,
      holderIsCompany: null,
      cause: null,
    });
  });
});

describe('PART 2 등기부 미인식 유효 행 수 (unknownActiveCount, #348)', () => {
  it('알려진 권리·소유권·말소 행만 있으면 0을 반환한다', () => {
    const lines = registry(
      ['1 소유권보존 2020년1월1일 소유자 홍길동', '2 가압류 2021년2월2일'],
      ['1 근저당권설정 채권최고액 금100,000,000원'],
    );
    expect(findUnknownActiveCount(lines)).toBe(0);
  });

  it('갑구·을구의 미인식 유효 행을 세고, 말소된 미인식 행은 제외한다', () => {
    const lines = registry(
      [
        '1 소유권보존 2020년1월1일 소유자 홍길동',
        '2 환매특약 2021년3월3일',
        '3 2번환매특약등기말소 2021년6월1일',
        '4 예고등기 2022년4월4일',
      ],
      ['1 지상권설정 2023년5월5일'],
    );
    expect(findUnknownActiveCount(lines)).toBe(2);
  });

  it('갑구 또는 을구 제목이 누락되면 null을 반환한다', () => {
    expect(findUnknownActiveCount(['【 갑 구 】', '1 소유권보존'])).toBeNull();
  });

  it('extractFields() 결과의 registry.unknownActiveCount에 반영된다', () => {
    const doc = {
      documentId: 'DOC_REG_EXT',
      documentType: DOCUMENT_TYPE.UNKNOWN,
      sourceType: SOURCE_TYPE.TEXT_PDF,
      pages: [
        {
          pageIndex: 0,
          width: 1000,
          height: 1400,
          blocks: [
            {
              blockId: 'B1',
              text: [
                '등기사항전부증명서(말소사항 포함) - 집합건물',
                '고유번호 1111-2222-333333',
                '서울특별시 중구 필동로 10, 202호',
                GAP,
                '1 소유권보존 2021년1월1일 소유자 김철수 800101-1******',
                '2 예고등기 2023년2월2일',
                EUL,
                '1 근저당권설정 2023년3월3일 설정계약 채권최고액 금120,000,000원',
                '근저당권자 주식회사한국은행',
              ].join('\n'),
              bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
              confidence: null,
            },
          ],
        },
      ],
    };
    const res = extractFields([doc], []);
    expect(res.ok).toBe(true);
    expect(res.data.registry.unknownActiveCount).toBe(1);
    expect(res.data.registry.rights).toEqual([
      {
        kind: 'MORTGAGE',
        maxClaimAmount: 120000000,
        cancelled: false,
        receivedAt: '2023-03-03',
        holder: '주식회사한국은행',
        holderIsCompany: true,
        cause: '설정계약',
      },
    ]);
  });
});
