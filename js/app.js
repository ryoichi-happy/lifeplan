// app.js
// アプリ全体の入口。保存データを読み込み、画面（見通し／入力／データ）を切り替える。

import { loadData } from "./storage.js";
import { currentYearMonth } from "./calc.js";
import { initInput, confirmLeaveInput } from "./input.js";
import { renderMain } from "./main.js";

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
  showScreen("main");
} catch (error) {
  // 読み込めなかったときは、データを上書きしてしまわないよう入力画面を作らない
  const box = document.getElementById("load-error");
  box.textContent = error.message;
  box.hidden = false;
}
