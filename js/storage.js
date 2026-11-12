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

// 保存データを全部消す（退避しておいた壊れたデータは残す）。
export function clearData() {
  localStorage.removeItem(STORAGE_KEY);
}
