// @ts-check
import { SOURCE_TYPE } from '../../shared/document-model.js';

/** 사람 목록이 들어 있는 칸. 이름이 있는 줄의 OCR 신뢰도(confidence)가 여기 들어 있다. */
const PERSON_LISTS = ['owners', 'previousOwners', 'landlords', 'tenants', 'accountHolders'];

/**
 * 이 서류가 사진·스캔(OCR)으로 읽은 서류인지. (#312, #341)
 *  - 서류에 sourceType이 있으면 그것을 따른다. (image, image_pdf만 사진·스캔)
 *  - 없으면 사람 정보의 confidence가 숫자인지로 본다. (글자 PDF는 항상 null이다)
 * 판단할 근거가 없으면 false라서, 기존처럼 STOP이 나온다.
 * @param {any} doc  fields.registry 또는 fields.contract
 */
export function isPhotoDocument(doc) {
  if (!doc) return false;
  if (typeof doc.sourceType === 'string') {
    return doc.sourceType === SOURCE_TYPE.IMAGE || doc.sourceType === SOURCE_TYPE.IMAGE_PDF;
  }
  return PERSON_LISTS.some((key) => Array.isArray(doc[key]) && doc[key].some((p) => typeof p?.confidence === 'number'));
}
