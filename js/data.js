// data.js
// データ管理画面の動き。エクスポート（ファイルに保存）、インポート（ファイルから読み込み）、
// 全データ削除を担当する。
// 保存データが壊れていて読み込めなかったときも、この画面だけは使えるようにしてある。

import {
  saveData, clearData, exportText, parseImportText, replaceData,
  hasImportBackup, restoreBeforeImport, loadBrokenText, daysSinceExport,
} from "./storage.js";
import { el, formatYearMonth } from "./util.js";

let data = null; // 保存データ全体（読み込めなかったときは null）
let loadError = null; // 読み込めなかったときのエラーの文（問題なければ null）

// 日付を「2026年11月12日」の形にする
function formatDate(date) {
  return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日";
}

// ファイル名に使う今日の日付（"2026-11-12" の形）
function todayForFileName() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + two(now.getMonth() + 1) + "-" + two(now.getDate());
}

// 文字列を、指定した名前のファイルとして保存する。
// 保存できたら true、利用者が取りやめたら false を返す。
async function downloadText(fileName, text, mimeType) {
  // iPhone でホーム画面から開いたとき（navigator.standalone が true）は、
  // ふつうのダウンロードが動かないことがあるので、共有メニューを開いて
  // 「"ファイル"に保存」を選んでもらう。
  if (navigator.standalone === true && navigator.canShare) {
    const file = new File([text], fileName, { type: mimeType });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (error) {
        // 共有メニューを閉じて取りやめた場合
        if (error.name === "AbortError") return false;
        // それ以外の失敗は、下のふつうのダウンロードを試す
      }
    }
  }

  // ふつうのダウンロード：一時的なリンクを作って、それをクリックしたことにする定番のやり方
  const blob = new Blob([text], { type: mimeType }); // Blob＝ファイルの中身にあたるデータ
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  // 保存が始まるのを少し待ってから、一時的な URL を片付ける
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// インポートするデータの内容を、確認用の短い文にする
function describeData(imported) {
  const counts = [
    "収入" + imported.incomes.length + "件",
    "生活費" + imported.expenses.length + "件",
    "積立" + imported.savings.length + "件",
    "イベント" + imported.events.length + "件",
    "実績" + imported.records.length + "件",
  ].join("・");
  const lines = [counts];
  const latest = imported.records.map((record) => record.yearMonth).sort().pop();
  if (latest) lines.push("最新の実績：" + formatYearMonth(latest));
  lines.push(imported.lastExportedAt
    ? "エクスポートした日：" + formatDate(new Date(imported.lastExportedAt))
    : "エクスポートした日：記録なし");
  return lines;
}

// ---- 画面を作る ----------------------------------------------------------

function render() {
  const root = document.getElementById("data-content");
  const sections = [];

  // 保存データを読み込めなかったときの案内
  if (loadError) {
    sections.push(el("section", { class: "panel" }, [
      el("h2", { text: "保存データを読み込めません" }),
      el("p", { class: "note", text: "下の「インポート」でバックアップから戻すか、「全データ削除」で最初からやり直せます。その前に、今の中身をファイルに残しておくことをおすすめします。" }),
      loadBrokenText() === null ? null : el("button", {
        type: "button", text: "読み込めなかった中身をファイルに保存",
        onclick: () => downloadText("lifeplan-broken-" + todayForFileName() + ".txt", loadBrokenText(), "text/plain"),
      }),
    ]));
  }

  sections.push(buildExport(), buildImport(), buildDelete());
  root.replaceChildren(...sections);
}

// ---- エクスポート ----
function buildExport() {
  const message = el("p", { class: "message" });
  let status = "保存データを読み込めないため、エクスポートできません。";
  if (data) {
    const days = daysSinceExport(data);
    status = days === null
      ? "まだエクスポートしていません。"
      : "最後のエクスポート：" + formatDate(new Date(data.lastExportedAt)) + "（" + (days <= 0 ? "今日" : days + "日前") + "）";
  }
  const statusNode = el("p", { text: status });

  return el("section", { class: "panel" }, [
    el("h2", { text: "エクスポート（バックアップ）" }),
    el("p", { class: "note", text: "すべてのデータを1つのファイルに保存します。ブラウザのデータは消えることがあるので、ときどき保存してください。" }),
    statusNode,
    el("button", {
      type: "button", class: "primary", text: "ファイルに保存する", disabled: data ? null : "",
      onclick: async () => {
        // 先に「エクスポートした日時」を記録してから、その内容をファイルにする
        const before = data.lastExportedAt;
        data.lastExportedAt = new Date().toISOString();
        try {
          saveData(data);
        } catch (error) {
          data.lastExportedAt = before;
          message.className = "message error-box";
          message.textContent = error.message;
          return;
        }
        const saved = await downloadText("lifeplan-backup-" + todayForFileName() + ".json", exportText(data), "application/json");
        if (!saved) {
          // 取りやめたときは、エクスポートした記録を元に戻す
          data.lastExportedAt = before;
          saveData(data);
          message.className = "message";
          message.textContent = "保存を取りやめました。";
          return;
        }
        statusNode.textContent = "最後のエクスポート：" + formatDate(new Date(data.lastExportedAt)) + "（今日）";
        message.className = "message";
        message.textContent = "ファイルを保存しました。個人の金額が入っているので、置き場所に注意してください。";
      },
    }),
    message,
  ]);
}

// ---- インポート ----
function buildImport() {
  const message = el("p", { class: "message" });
  const preview = el("div", { class: "preview", hidden: "" });

  // ファイルを選ぶ欄。見た目は隠し、ラベルをボタンのように見せる（style.css）
  const fileInput = el("input", { type: "file", accept: ".json,application/json", class: "file-input" });

  // 選んだファイルを取りやめて、選ぶ前の状態に戻す
  function reset() {
    fileInput.value = ""; // 同じファイルをもう一度選べるようにする
    preview.hidden = true;
    preview.replaceChildren();
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    message.className = "message";
    message.textContent = "";
    reset();

    // ファイルを読み、中身を検査する。問題があれば何も変えずに理由を表示する
    let imported;
    try {
      imported = parseImportText(await file.text());
    } catch (error) {
      message.className = "message error-box";
      message.textContent = "取り込めませんでした。" + error.message;
      return;
    }

    // 内容を見せて、確認してもらう
    preview.replaceChildren(
      el("p", { class: "preview-title", text: "「" + file.name + "」の内容" }),
      ...describeData(imported).map((text) => el("p", { text })),
      el("p", { class: "preview-warning", text: "⚠ 今のデータをすべて、この内容で置き換えます。" }),
      el("div", { class: "form-buttons" }, [
        el("button", {
          type: "button", class: "primary", text: "この内容で置き換える",
          onclick: () => {
            try {
              replaceData(imported);
            } catch (error) {
              message.className = "message error-box";
              message.textContent = error.message;
              return;
            }
            location.reload(); // 画面に古いデータが残らないよう、ページを読み込み直す
          },
        }),
        el("button", { type: "button", text: "やめる", onclick: reset }),
      ]),
    );
    preview.hidden = false;
  });

  return el("section", { class: "panel" }, [
    el("h2", { text: "インポート（バックアップから戻す）" }),
    el("p", { class: "note", text: "エクスポートしたファイルを読み込みます。今のデータは置き換えられますが、直前の状態は1回分だけ控えを残します。" }),
    el("label", { class: "file-button" }, [el("span", { text: "ファイルを選ぶ" }), fileInput]),
    preview,
    message,
    !hasImportBackup() ? null : el("div", { class: "undo-import" }, [
      el("p", { class: "note", text: "前回のインポートの直前のデータが残っています。" }),
      el("button", {
        type: "button", text: "インポート前に戻す",
        onclick: () => {
          if (!confirm("インポート前のデータに戻します。今のデータは控えと入れ替わるので、もう一度押せば元に戻せます。よろしいですか？")) return;
          restoreBeforeImport();
          location.reload();
        },
      }),
    ]),
  ]);
}

// ---- 全データ削除 ----
function buildDelete() {
  return el("section", { class: "panel" }, [
    el("h2", { text: "全データ削除" }),
    el("p", { class: "note", text: "このアプリがブラウザに保存しているデータを、インポート前の控えも含めてすべて消します。元に戻せないので、先にエクスポートしておいてください。" }),
    el("button", {
      type: "button", class: "danger", text: "すべてのデータを削除する",
      onclick: () => {
        if (!confirm("すべてのデータを削除します。元に戻せません。本当に削除しますか？")) return;
        clearData();
        location.reload();
      },
    }),
  ]);
}

// ---- 外から呼ぶ関数 ------------------------------------------------------

// データ管理画面を準備する（app.js から呼ぶ）。
//   loadedData : 読み込んだ保存データ（読み込めなかったときは null）
//   errorText  : 読み込めなかったときのエラーの文（問題なければ null）
export function initData(loadedData, errorText = null) {
  data = loadedData;
  loadError = errorText;
  render();
}

// データ管理画面を開くたびに呼ぶ（「最後のエクスポート」の日数などを新しくする）
export function refreshData() {
  render();
}
