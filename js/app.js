// app.js
// 画面を動かすコード。
// 今はステップ1の動作確認用の仮の画面で、ステップ3で入力画面に置き換える。

import { STORAGE_KEY, loadData, saveData, clearData, createEmptyData, newId } from "./storage.js";

const output = document.getElementById("output");
const message = document.getElementById("message");

// 保存されているデータを読み込んで、画面にそのまま表示する
function show() {
  try {
    const data = loadData();
    output.textContent = JSON.stringify(data, null, 2);
    message.textContent = "キー「" + STORAGE_KEY + "」から読み込みました";
  } catch (error) {
    output.textContent = "";
    message.textContent = error.message;
  }
}

// 「テスト保存」: ダミーの値（個人のデータではない）を入れて保存する
document.getElementById("save-test").addEventListener("click", () => {
  const data = createEmptyData();
  data.basic.birthYearMonth = "2000-01";
  data.basic.cash = 12.3;
  data.events.push({
    id: newId(),
    name: "テストイベント",
    yearMonth: "2028-04",
    estimate: 50,
    target: 50,
    actual: null,
    memo: "",
  });
  try {
    saveData(data);
    show();
  } catch (error) {
    message.textContent = error.message;
  }
});

// 「削除」: 保存データを消して空の状態に戻す
document.getElementById("clear").addEventListener("click", () => {
  clearData();
  show();
});

show();
