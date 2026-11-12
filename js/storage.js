// storage.js
// データの保存・読み込みを担当するファイル。
// 保存先は localStorage（ブラウザの中に文字列を保存できる仕組み）。
// データ全体を1つの JSON 文字列にして、1つのキー（保存場所の名前）に入れる。

// localStorage のキー名。
// GitHub Pages では「ユーザー名.github.io」の下にある他のアプリと
// 保存場所を共有するので、このアプリ固有の名前を先頭に付けて混ざらないようにする。
export const STORAGE_KEY = "lifeplan-app:data";
// 読み込めなかった（壊れていた）データを退避しておくキー
export const BROKEN_BACKUP_KEY = "lifeplan-app:broken-backup";
// インポートで置き換える直前のデータを、1世代だけ控えておくキー
export const BEFORE_IMPORT_KEY = "lifeplan-app:before-import";

// 今のデータ形式のバージョン番号。データの形を変えたら 1 ずつ増やす。
export const CURRENT_VERSION = 1;

// 空のデータを作る。金額はすべて万円単位の数値、年月は "2026-04" のような文字列。
export function createEmptyData() {
  return {
    version: CURRENT_VERSION,
    // 基本情報
    basic: {
      birthYearMonth: "", // 生まれ年月
      cash: 0, // 現在の現金残高
      investment: 0, // 現在の投資評価額
      annualReturnPct: 0, // 想定利回り（年率%）
      minCash: 0, // 最低限残しておきたい額
    },
    incomes: [], // 収入:   { id, start, end, monthly, bonuses: [{ month, amount }], memo }
    expenses: [], // 生活費: { id, start, end, monthly, memo }
    savings: [], // 積立:   { id, start, end, monthly }
    events: [], // イベント: { id, name, yearMonth, estimate, target, actual, memo }
    records: [], // 実績:   { id, yearMonth, cash, investment, memo }
    lastExportedAt: null, // 最後にエクスポートした日時（まだなら null）
  };
}

// 一覧の1件ごとに付ける識別用の文字列（id）を作る。編集・削除の対象を特定するのに使う。
export function newId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// 古いバージョンのデータを新しい形に変換する関数の一覧。
// 「バージョン n のデータを n+1 の形にする関数」を n 番に登録する。
// 例）バージョン2を作るとき:
//   MIGRATIONS[1] = (data) => { data.newField = 0; return data; };
const MIGRATIONS = {};

// データを今のバージョンまで順番に変換する（マイグレーション）。
export function migrate(data) {
  if (data === null || typeof data !== "object" || !Number.isInteger(data.version)) {
    throw new Error("データの形式が正しくありません（バージョン番号がありません）");
  }
  if (data.version > CURRENT_VERSION) {
    throw new Error(
      "このデータは新しい版のアプリで作られています（データ: v" +
        data.version + " / アプリ: v" + CURRENT_VERSION + "）"
    );
  }
  while (data.version < CURRENT_VERSION) {
    const step = MIGRATIONS[data.version];
    if (!step) {
      throw new Error("v" + data.version + " からの変換方法が登録されていません");
    }
    data = step(data);
    data.version += 1;
  }
  // 項目が欠けていても動くように、空データを土台にして上書きする
  const empty = createEmptyData();
  return { ...empty, ...data, basic: { ...empty.basic, ...data.basic } };
}

// 保存されているデータを読み込む。
// ・まだ何も保存されていなければ、空のデータを返す
// ・壊れていて読めないときは、中身を別のキーに退避してからエラーを投げる
//   （勝手に空データで上書きして、元のデータを失わないようにするため）
export function loadData() {
  const text = localStorage.getItem(STORAGE_KEY);
  if (text === null) {
    return createEmptyData();
  }
  try {
    return migrate(JSON.parse(text));
  } catch (error) {
    localStorage.setItem(BROKEN_BACKUP_KEY, text);
    throw new Error("保存データを読み込めませんでした: " + error.message);
  }
}

// データを保存する。
export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // 容量オーバーや、ブラウザの設定で保存が禁止されている場合など
    throw new Error("保存できませんでした: " + error.message);
  }
}

// このアプリの保存データを全部消す（壊れたデータの退避や、インポート前の控えも消す）。
export function clearData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BROKEN_BACKUP_KEY);
  localStorage.removeItem(BEFORE_IMPORT_KEY);
}

// ---- エクスポート／インポート -------------------------------------------

// エクスポートするファイルの中身（文字列）を作る。保存データそのままを、読みやすく字下げして出す。
export function exportText(data) {
  return JSON.stringify(data, null, 2);
}

// インポートするファイルの中身（文字列）を読み取り、検査してからデータとして返す。
// 問題があれば、理由を書いたエラーを投げる（この時点では何も保存しない）。
export function parseImportText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("JSON として読めませんでした。このアプリでエクスポートしたファイルか確認してください");
  }
  return validateData(migrate(parsed));
}

// 今のデータを控えに残してから、新しいデータで置き換える（インポート用）。
export function replaceData(newData) {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current !== null) localStorage.setItem(BEFORE_IMPORT_KEY, current);
  saveData(newData);
}

// インポート前の控えがあるか
export function hasImportBackup() {
  return localStorage.getItem(BEFORE_IMPORT_KEY) !== null;
}

// インポート前の状態に戻す。今のデータと控えを入れ替えるので、もう一度押せば元に戻せる。
export function restoreBeforeImport() {
  const backup = localStorage.getItem(BEFORE_IMPORT_KEY);
  if (backup === null) return;
  const current = localStorage.getItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, backup);
  if (current !== null) localStorage.setItem(BEFORE_IMPORT_KEY, current);
}

// 読み込めなかったデータの中身（文字列）を返す。なければ null。
export function loadBrokenText() {
  return localStorage.getItem(BROKEN_BACKUP_KEY);
}

// 何かデータが入力されているか（空のままなら false）
export function hasAnyInput(data) {
  return data.basic.birthYearMonth !== "" || data.basic.cash !== 0 || data.basic.investment !== 0 ||
    ["incomes", "expenses", "savings", "events", "records"].some((key) => data[key].length > 0);
}

// 最後のエクスポートから何日たったか。一度もしていなければ null。
export function daysSinceExport(data, now = new Date()) {
  if (!data.lastExportedAt) return null;
  return Math.floor((now - new Date(data.lastExportedAt)) / (24 * 60 * 60 * 1000));
}

// ---- データの中身の検査 -------------------------------------------------

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/; // "2027-04" の形

// 一覧ごとの、項目の決まり
//   ym = 年月 / ymOrBlank = 年月か空 / number = 数字 / numberOrNull = 数字か未記入
//   text = 空でない文字 / memo = 文字（なくてもよい）/ bonuses = 臨時収入の一覧
const LIST_RULES = {
  incomes: { label: "収入", fields: { start: "ym", end: "ymOrBlank", monthly: "number", bonuses: "bonuses", memo: "memo" } },
  expenses: { label: "生活費", fields: { start: "ym", end: "ymOrBlank", monthly: "number", memo: "memo" } },
  savings: { label: "積立", fields: { start: "ym", end: "ymOrBlank", monthly: "number" } },
  events: { label: "イベント", fields: { name: "text", yearMonth: "ym", estimate: "number", target: "number", actual: "numberOrNull", memo: "memo" } },
  records: { label: "実績", fields: { yearMonth: "ym", cash: "number", investment: "number", memo: "memo" } },
};

// エラーの文に使う、項目の日本語名
const FIELD_LABELS = {
  start: "開始年月", end: "終了年月", monthly: "毎月の額", bonuses: "臨時収入", memo: "メモ",
  name: "名前", yearMonth: "年月", estimate: "総額（予想）", target: "自分で払う額",
  actual: "実際に自分で払った額", cash: "現金残高", investment: "投資評価額",
  birthYearMonth: "生まれ年月", annualReturnPct: "想定利回り", minCash: "最低限残しておきたい額",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// 項目1つの値が、決まりに合っているか
function fieldIsValid(kind, value) {
  if (kind === "ym") return typeof value === "string" && YEAR_MONTH.test(value);
  if (kind === "ymOrBlank") return value === "" || (typeof value === "string" && YEAR_MONTH.test(value));
  if (kind === "number") return isNumber(value);
  if (kind === "numberOrNull") return value === null || isNumber(value);
  if (kind === "text") return typeof value === "string" && value !== "";
  if (kind === "memo") return typeof value === "string";
  if (kind === "bonuses") {
    return Array.isArray(value) && value.every((bonus) =>
      isObject(bonus) && Number.isInteger(bonus.month) && bonus.month >= 1 && bonus.month <= 12 && isNumber(bonus.amount));
  }
  return false;
}

// データの中身が正しい形かを検査する。問題があれば、場所と理由を書いたエラーを投げる。
// 害のない抜け（メモがない、id がない など）は、ここで補う。
export function validateData(data) {
  const fail = (where, key) => {
    throw new Error(where + "：「" + FIELD_LABELS[key] + "」の値が正しくありません");
  };

  if (!isObject(data.basic)) throw new Error("基本情報の形が正しくありません");
  if (!fieldIsValid("ymOrBlank", data.basic.birthYearMonth)) fail("基本情報", "birthYearMonth");
  for (const key of ["cash", "investment", "annualReturnPct", "minCash"]) {
    if (!isNumber(data.basic[key])) fail("基本情報", key);
  }

  for (const [listKey, rule] of Object.entries(LIST_RULES)) {
    if (!Array.isArray(data[listKey])) throw new Error(rule.label + "の一覧の形が正しくありません");
    data[listKey].forEach((item, n) => {
      const where = rule.label + "の" + (n + 1) + "件目";
      if (!isObject(item)) throw new Error(where + "の形が正しくありません");
      // 害のない抜けを補う
      if (typeof item.id !== "string" || item.id === "") item.id = newId();
      if ("memo" in rule.fields && item.memo === undefined) item.memo = "";
      if ("bonuses" in rule.fields && item.bonuses === undefined) item.bonuses = [];
      if ("end" in rule.fields && (item.end === undefined || item.end === null)) item.end = "";
      if ("actual" in rule.fields && item.actual === undefined) item.actual = null;
      if ("target" in rule.fields && (item.target === undefined || item.target === null)) item.target = item.estimate;

      for (const [key, kind] of Object.entries(rule.fields)) {
        if (!fieldIsValid(kind, item[key])) fail(where, key);
      }
    });
  }

  // 最後にエクスポートした日時が日付として読めなければ、「まだ」に戻す
  if (typeof data.lastExportedAt !== "string" || Number.isNaN(new Date(data.lastExportedAt).getTime())) {
    data.lastExportedAt = null;
  }
  return data;
}
