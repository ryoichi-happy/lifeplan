// app.js
// アプリ全体の入口。保存データを読み込み、画面（見通し／入力／データ）を切り替える。

import { loadData } from "./storage.js";
import { currentYearMonth } from "./calc.js";
import { initInput, confirmLeaveInput } from "./input.js";
import { renderMain } from "./main.js";
import { initData, refreshData } from "./data.js";

const navButtons = document.querySelectorAll(".bottom-nav button");
let currentScreen = "main";
let data = null; // 保存データ全体（入力画面と見通し画面で同じものを使う）

// 指定した画面だけを表示し、下のボタンの選択状態も合わせる
function showScreen(name) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== "screen-" + name;
  }
  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.screen === name);
  }
  currentScreen = name;
  // 見通し画面は、開くたびに最新のデータで描き直す
  if (name === "main" && data) renderMain(data, currentYearMonth());
  if (name === "data") refreshData();
  window.scrollTo(0, 0);
}

for (const button of navButtons) {
  button.addEventListener("click", () => {
    const name = button.dataset.screen;
    if (name === currentScreen) return;
    // 入力画面から離れるとき、保存していない変更があれば確認する
    if (currentScreen === "input" && !confirmLeaveInput()) return;
    showScreen(name);
  });
}

// 保存データを読み込んで、各画面を準備する
try {
  data = loadData();
  initInput(data);
  initData(data);
  showScreen("main");
} catch (error) {
  // 読み込めなかったときは、データを上書きしてしまわないよう入力画面を作らない。
  // データ管理画面だけは使えるようにして、バックアップから戻せるようにする
  const box = document.getElementById("load-error");
  box.textContent = error.message + "　「データ」画面から、バックアップの読み込みなどができます。";
  box.hidden = false;
  const note = "保存データを読み込めないため、表示できません。";
  document.getElementById("main-content").textContent = note;
  document.getElementById("tab-content").textContent = note;
  initData(null, error.message);
  showScreen("data");
}

// ---- PWA（ホーム画面に追加してアプリのように使う）のための準備 ----

// サービスワーカー（sw.js）を登録する。電波がないときでもアプリを開けるようになる。
// 対応していないブラウザや、登録に失敗したときは、何もせずふつうのページとして動く。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ブラウザに「このアプリの保存データを勝手に消さないで」と頼む。
// 必ず聞き入れられるとは限らないので、バックアップ（エクスポート）は引き続き必要。
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
