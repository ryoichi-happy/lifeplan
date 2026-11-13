// storage.test.js
// storage.js のうち、インポートするファイルの検査と、バージョン変換のテスト。
// （ブラウザへの保存そのものは、画面で操作して確かめる）

import { test, same, throwsWith } from "./testlib.js";
import {
  createEmptyData, exportText, parseImportText, migrate, hasAnyInput, daysSinceExport, CURRENT_VERSION,
} from "./storage.js";
import { simulate } from "./calc.js";

// 一通りの項目が入ったテスト用データ（金額は架空）
function sampleData() {
  const data = createEmptyData();
  data.basic = { birthYearMonth: "2000-01", cash: 100, investment: 50, annualReturnPct: 3, minCash: 20 };
  data.incomes.push({ id: "a", start: "2026-04", end: "", monthly: 20, bonuses: [{ month: 6, amount: 30 }], memo: "" });
  data.expenses.push({ id: "b", start: "2026-04", end: "2028-03", monthly: 12, memo: "一人暮らし" });
  data.savings.push({ id: "c", start: "2026-04", end: "", frequency: "monthly", month: null, amount: 3, source: "cash" });
  data.savings.push({ id: "f", start: "2026-04", end: "", frequency: "yearly", month: 1, amount: 30, source: "gift" });
  data.events.push({ id: "d", name: "テスト", yearMonth: "2028-04", estimate: 80, target: 30, actual: null, memo: "" });
  data.records.push({ id: "e", yearMonth: "2026-10", cash: 101.5, investment: 52, memo: "" });
  data.lastExportedAt = "2026-11-01T00:00:00.000Z";
  return data;
}

// テスト用データの一部を書き換えてから、ファイルの中身（文字列）にする
function textWith(change) {
  const data = sampleData();
  change(data);
  return JSON.stringify(data);
}

test("エクスポートした中身を、そのままインポートできる", () => {
  const data = sampleData();
  same(JSON.stringify(parseImportText(exportText(data))), JSON.stringify(data), "中身");
});

test("インポート：JSON でないファイルは断る", () => {
  throwsWith(() => parseImportText("これはJSONではありません"), "JSON として読めませんでした", "文章のファイル");
  throwsWith(() => parseImportText(""), "JSON として読めませんでした", "空のファイル");
});

test("インポート：バージョン番号がない・新しすぎるファイルは断る", () => {
  throwsWith(() => parseImportText('{"basic":{}}'), "バージョン番号がありません", "番号なし");
  throwsWith(() => parseImportText("[1,2,3]"), "バージョン番号がありません", "一覧だけ");
  throwsWith(() => parseImportText("null"), "バージョン番号がありません", "null");
  throwsWith(() => parseImportText(textWith((d) => { d.version = CURRENT_VERSION + 1; })), "新しい版のアプリ", "新しすぎる");
});

test("インポート：項目の形がおかしければ、場所を示して断る", () => {
  throwsWith(() => parseImportText(textWith((d) => { d.basic.cash = "100"; })), "基本情報：「現金残高」", "金額が文字");
  throwsWith(() => parseImportText(textWith((d) => { d.basic.birthYearMonth = "2000/01"; })), "基本情報：「生まれ年月」", "年月の形");
  throwsWith(() => parseImportText(textWith((d) => { d.incomes[0].start = "2026-13"; })), "収入の1件目：「開始年月」", "13月");
  throwsWith(() => parseImportText(textWith((d) => { d.incomes[0].bonuses[0].month = 0; })), "収入の1件目：「臨時収入」", "0月のボーナス");
  throwsWith(() => parseImportText(textWith((d) => { d.events[0].name = ""; })), "イベントの1件目：「名前」", "名前が空");
  throwsWith(() => parseImportText(textWith((d) => { d.events[0].actual = "未定"; })), "イベントの1件目：「実際に自分で払った額」", "実際の額が文字");
  throwsWith(() => parseImportText(textWith((d) => { d.records.push({ yearMonth: "2026-11", cash: null, investment: 1 }); })), "実績の2件目：「現金残高」", "残高が空");
  throwsWith(() => parseImportText(textWith((d) => { d.records = "なし"; })), "実績の一覧の形", "一覧でない");
});

test("インポート：害のない抜けは補う", () => {
  const data = parseImportText(textWith((d) => {
    delete d.incomes[0].id;
    delete d.incomes[0].bonuses;
    delete d.incomes[0].memo;
    delete d.events[0].target;
    delete d.events[0].actual;
    delete d.savings; // 一覧ごと抜けている
    d.lastExportedAt = "きのう";
  }));
  same(typeof data.incomes[0].id, "string", "id を付ける");
  same(data.incomes[0].bonuses.length, 0, "臨時収入は空の一覧");
  same(data.incomes[0].memo, "", "メモは空");
  same(data.events[0].target, 80, "自分で払う額は総額と同じ");
  same(data.events[0].actual, null, "実際の額は未記入");
  same(data.savings.length, 0, "抜けた一覧は空");
  same(data.lastExportedAt, null, "読めない日時は「まだ」に戻す");
});

test("バージョン変換：今の版のデータはそのまま通る", () => {
  const data = sampleData();
  same(JSON.stringify(migrate(sampleData())), JSON.stringify(data), "中身が変わらない");
});

// バージョン1の頃の形のデータ（積立が monthly だけを持っている）
function version1Text() {
  const data = sampleData();
  data.version = 1;
  data.savings = [
    { id: "c", start: "2026-04", end: "", monthly: 3 },
    { id: "g", start: "2028-04", end: "2029-03", monthly: 5.5 },
  ];
  return JSON.stringify(data);
}

test("バージョン変換：1 → 2 で、積立が「毎月・自分の現金から」になる", () => {
  const data = parseImportText(version1Text());
  same(data.version, 2, "バージョン番号");
  same(JSON.stringify(data.savings[0]),
    JSON.stringify({ id: "c", start: "2026-04", end: "", frequency: "monthly", month: null, amount: 3, source: "cash" }),
    "1件目");
  same(data.savings[1].amount, 5.5, "2件目の額");
  same(data.savings[1].end, "2029-03", "2件目の終了年月");
  same("monthly" in data.savings[1], false, "古い項目名は残さない");
});

test("バージョン変換：1 → 2 で、積立以外は変わらない", () => {
  const before = JSON.parse(version1Text());
  const after = parseImportText(version1Text());
  for (const key of ["basic", "incomes", "expenses", "events", "records", "lastExportedAt"]) {
    same(JSON.stringify(after[key]), JSON.stringify(before[key]), key);
  }
});

test("バージョン変換：1 → 2 の前後で、資産の計算結果が変わらない", () => {
  // バージョン1の計算（毎月・現金から）と同じ結果になるかを、手計算の値で確かめる
  const data = parseImportText(version1Text());
  const months = simulate(data, "2026-11");
  // 実績（2026-10: 現金101.5・投資52）の翌月から。収入20・生活費12・積立3、利回り3%
  same(months[0].yearMonth, "2026-11", "最初の月");
  same(Math.abs(months[0].cash - 106.5) < 1e-9, true, "現金（101.5＋20−12−3）");
  same(Math.abs(months[0].investment - (52 * Math.pow(1.03, 1 / 12) + 3)) < 1e-9, true, "投資");
});

test("インポート：積立の新しい項目の検査", () => {
  throwsWith(() => parseImportText(textWith((d) => { d.savings[0].frequency = "weekly"; })), "積立の1件目：「入れ方」", "知らない入れ方");
  throwsWith(() => parseImportText(textWith((d) => { d.savings[0].source = "loan"; })), "積立の1件目：「お金の出どころ」", "知らない出どころ");
  throwsWith(() => parseImportText(textWith((d) => { d.savings[1].month = 13; })), "積立の2件目：「入れる月」", "13月");
  throwsWith(() => parseImportText(textWith((d) => { d.savings[1].month = null; })), "積立の2件目：「入れる月」", "年1回なのに月がない");
  throwsWith(() => parseImportText(textWith((d) => { delete d.savings[0].amount; })), "積立の1件目：「1回の積立額」", "額がない");
});

test("データが入力されているかの判定", () => {
  same(hasAnyInput(createEmptyData()), false, "空のデータ");
  same(hasAnyInput(sampleData()), true, "入力済み");
  const onlyBirth = createEmptyData();
  onlyBirth.basic.birthYearMonth = "2000-01";
  same(hasAnyInput(onlyBirth), true, "生まれ年月だけ");
});

test("最後のエクスポートからの日数", () => {
  const data = createEmptyData();
  same(daysSinceExport(data, new Date("2026-11-12T00:00:00Z")), null, "まだしていない");
  data.lastExportedAt = "2026-10-13T00:00:00.000Z";
  same(daysSinceExport(data, new Date("2026-11-11T23:00:00Z")), 29, "29日と23時間");
  same(daysSinceExport(data, new Date("2026-11-12T00:00:00Z")), 30, "ちょうど30日");
});
