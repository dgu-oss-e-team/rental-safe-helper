// @ts-check
/**
 * PART 5. PDF 문서 정보(메타데이터) 비우기
 *
 * 원본 PDF의 제목·작성자 등에는 이름이 들어 있을 수 있다. 새 PDF는 처음부터 비어 있지만,
 * 혹시 다른 경로로 값이 들어가도 마지막에 한 번 더 비운다.
 */

/**
 * @param {import('pdf-lib').PDFDocument} pdf
 */
export function cleanMetadata(pdf) {
  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setCreator('');
  pdf.setProducer('');
  // 만든 날짜도 사용 시점을 드러낼 수 있어 고정값으로 둔다
  const epoch = new Date(0);
  pdf.setCreationDate(epoch);
  pdf.setModificationDate(epoch);
}
