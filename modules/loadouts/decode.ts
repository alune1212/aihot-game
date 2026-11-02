// 改枪码形如「枪名-模式-码尾」。码尾是官方改枪台生成的一串字母数字。
// 2026-11-02 对照官方方案列表：两条 MDR 的码尾分别是
// 6L7K3JG04C9NGO2DGDCB8 和 6LHIFE804C9NGO2DGDCB8，后 14 位相同，
// 枪口、导轨和握把的 objectID 却对不上。相同的一段并不代表同一组配件，
// 所以不能把码尾拆成物品编号，也不能拿官方物品表去猜。
// 对得上官方方案列表的，仍用那份列表里的配件、价格和属性。

export interface DecodeFailure {
  ok: false;
  reason: "opaque";
  detail: string;
}

export const OPAQUE_DETAIL = "这条码不在官方方案里。码尾不是配件编号的公开编码，解不出配件、价格和改装属性。";

/** 只在能确定配件编号时返回配件。目前的码尾解不出来，调用方应原样告诉读者，不要补一组配件。 */
export function decodeLoadoutCode(_code: string): DecodeFailure {
  return { ok: false, reason: "opaque", detail: OPAQUE_DETAIL };
}
