// app.js
// アプリ全体の入口。保存データを読み込み、画面（見通し／入力／データ）を切り替える。

import { loadData } from "./storage.js";
import { initInput, confirmLeaveInput } from "./input.js";

const navButtons = document.querySelectorAll(".bottom-nav button");
let currentScreen = "main";

// 指定した画面だけを表示し、下のボタンの選択状態も合わせる
function showScreen(name) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== "screen-" + name;
  }
  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.screen === name);
  }
  currentScreen = name;
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

// 保存データを読み込んで、入力画面を準備する
try {
  initInput(loadData());
} catch (error) {
  // 読み込めなかったときは、データを上書きしてしまわないよう入力画面を作らない
  const box = document.getElementById("load-error");
  box.textContent = error.message;
  box.hidden = false;
}
