// input.js
// 入力画面の動き。タブの切り替え、一覧の表示、追加・編集・削除、保存を担当する。
//
// 各タブの入力欄は、下の「欄の定義」をもとに自動で作る。
// 入力欄を増やしたいときは、定義に1行足せばよい。

import { saveData, newId } from "./storage.js";
import { el, formatMoney } from "./util.js";

// ---- 欄の定義 ----------------------------------------------------------
// type の種類:  month = 年月 / money = 金額（万円）/ percent = % / text = 文字 / bonuses = 臨時収入
// required: true の欄は必須。それ以外は空欄でもよい。

const BASIC_FIELDS = [
  { key: "birthYearMonth", label: "生まれ年月", type: "month", required: true },
  { key: "cash", label: "現在の現金残高", type: "money", required: true },
  { key: "investment", label: "現在の投資評価額", type: "money", required: true },
  { key: "annualReturnPct", label: "想定利回り・年率", type: "percent", required: true },
  { key: "minCash", label: "最低限残しておきたい額", type: "money", required: true },
];

const START = { key: "start", label: "開始年月", type: "month", required: true };
const END = { key: "end", label: "終了年月", type: "month", hint: "空欄なら30歳まで続くものとして扱います" };
const MEMO = { key: "memo", label: "メモ", type: "text" };

// 一覧で管理する4種類（収入・生活費・積立・イベント）
// isPeriod: true のものは「開始〜終了」の期間で設定する項目
const LISTS = {
  incomes: {
    title: "収入",
    isPeriod: true,
    fields: [
      START, END,
      { key: "monthly", label: "月の手取り", type: "money", required: true },
      { key: "bonuses", label: "臨時収入（ボーナスなど）", type: "bonuses" },
      MEMO,
    ],
  },
  expenses: {
    title: "生活費",
    isPeriod: true,
    fields: [
      START, END,
      { key: "monthly", label: "毎月の支出", type: "money", required: true },
      MEMO,
    ],
  },
  savings: {
    title: "積立",
    isPeriod: true,
    fields: [
      START, END,
      { key: "monthly", label: "毎月の積立額", type: "money", required: true },
    ],
  },
  events: {
    title: "イベント",
    isPeriod: false,
    fields: [
      { key: "name", label: "名前", type: "text", required: true },
      { key: "yearMonth", label: "年月", type: "month", required: true },
      { key: "estimate", label: "総額（予想）", type: "money", required: true, hint: "援助してもらう分も含めた、かかる費用の全体です" },
      { key: "target", label: "自分で払う額", type: "money", hint: "総額から援助の見込みを引いた額です。この額が資産の計算で引かれ、準備の目標になります。空欄なら総額と同じにします" },
      { key: "actual", label: "実際に自分で払った額", type: "money", hint: "イベントが終わってから記入します。記入すると、計算ではこの額を使います" },
      MEMO,
    ],
  },
};

// タブの並び（「実績」はステップ6で追加する）
const TABS = [
  { id: "basic", label: "基本情報" },
  { id: "incomes", label: "収入" },
  { id: "expenses", label: "生活費" },
  { id: "savings", label: "積立" },
  { id: "events", label: "イベント" },
];

const DISCARD_MESSAGE = "保存していない変更があります。破棄してよいですか？";
const OVERLAP_MESSAGE = "期間が重なっています（重なった月は合計されます）";

// ---- このファイルの中で覚えておくもの ------------------------------------
let data = null; // 保存データ全体
let currentTab = "basic"; // 今開いているタブ
let hasUnsaved = null; // 「保存していない変更があるか」を調べる関数（フォームを開いていないときは null）

// ---- 小さな道具 --------------------------------------------------------

// 小数第1位に丸める
function round1(value) {
  return Math.round(value * 10) / 10;
}

// 2つの期間が重なっているか。終了年月が空欄なら、ずっと続くものとして比べる。
// 年月は "2027-04" の形なので、文字のまま大小を比べられる。
function periodsOverlap(a, b) {
  const FOREVER = "9999-12";
  return a.start <= (b.end || FOREVER) && b.start <= (a.end || FOREVER);
}

// 一覧の中で、指定した期間と重なる「ほかの項目」があるか
function overlapsOthers(items, target, selfId) {
  return items.some((item) => item.id !== selfId && periodsOverlap(item, target));
}

// ---- 入力欄を作る・読み取る ----------------------------------------------

// 欄の種類ごとの、入力欄の設定
function inputAttributes(field) {
  if (field.type === "month") return { type: "month" };
  // inputmode="decimal" で、スマホでは小数点つきの数字キーボードが出る
  if (field.type === "money" || field.type === "percent") {
    return { type: "number", inputmode: "decimal", step: "0.1", min: "0" };
  }
  return { type: "text" };
}

// 入力欄1つ分の値を読み取り、{ value, error } の形で返す
function readInput(field, text) {
  text = text.trim();
  if (text === "") {
    if (field.required) return { error: "入力してください" };
    // 空欄のとき：金額は null（未記入）、それ以外は空の文字
    return { value: field.type === "money" ? null : "" };
  }
  if (field.type === "month") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return { error: "2027-04 の形で入力してください" };
    return { value: text };
  }
  if (field.type === "money" || field.type === "percent") {
    const number = Number(text);
    if (Number.isNaN(number)) return { error: "数字で入力してください" };
    if (number < 0) return { error: "0以上で入力してください" };
    return { value: round1(number) };
  }
  return { value: text };
}

// 臨時収入の入力欄（「何月・いくら」の行を足したり消したりできる）を作る
function createBonusEditor(field, bonuses) {
  const rows = el("div");
  const error = el("p", { class: "field-error" });

  function addRow(bonus) {
    const month = el("select", { "aria-label": "受け取る月" });
    for (let m = 1; m <= 12; m++) {
      month.append(el("option", { value: m, text: m + "月" }));
    }
    month.value = String(bonus.month);
    const amount = el("input", { ...inputAttributes({ type: "money" }), placeholder: "万円", "aria-label": "額（万円）" });
    amount.value = bonus.amount === "" ? "" : String(bonus.amount);
    const row = el("div", { class: "bonus-row" }, [
      month,
      amount,
      el("button", { type: "button", class: "small", text: "消す", onclick: () => row.remove() }),
    ]);
    rows.append(row);
  }
  for (const bonus of bonuses || []) addRow(bonus);

  const wrap = el("div", { class: "field" }, [
    el("span", { class: "field-label", text: field.label + "（万円・任意）" }),
    rows,
    el("button", { type: "button", class: "small", text: "＋ 臨時収入を足す", onclick: () => addRow({ month: 6, amount: "" }) }),
    error,
  ]);

  // 入力された行を読み取る
  function read() {
    const value = [];
    for (const row of rows.children) {
      const result = readInput({ type: "money", required: true }, row.querySelector("input").value);
      if (result.error) return { error: "額を" + result.error };
      value.push({ month: Number(row.querySelector("select").value), amount: result.value });
    }
    return { value };
  }
  return { wrap, error, read };
}

// 欄の定義から、入力欄をまとめて作る。
//   fields : 欄の定義の一覧
//   values : 最初に入れておく値（編集のときは今の値）
// 戻り値の read() で入力内容を読み取れる（エラーがあれば画面に表示して null を返す）。
function buildFields(fields, values) {
  const parts = {}; // 欄ごとの部品。parts.start.input のように取り出せる
  const nodes = [];

  for (const field of fields) {
    if (field.type === "bonuses") {
      parts[field.key] = createBonusEditor(field, values[field.key]);
      nodes.push(parts[field.key].wrap);
      continue;
    }
    const unit = field.type === "money" ? "万円" : field.type === "percent" ? "%" : "";
    const notes = [unit, field.required ? "" : "任意"].filter(Boolean).join("・");
    const input = el("input", inputAttributes(field));
    const value = values[field.key];
    input.value = value === null || value === undefined ? "" : String(value);
    const error = el("p", { class: "field-error" });
    const wrap = el("label", { class: "field" }, [
      el("span", { class: "field-label", text: field.label + (notes ? "（" + notes + "）" : "") }),
      input,
      field.hint ? el("span", { class: "field-hint", text: field.hint }) : null,
      error,
    ]);
    parts[field.key] = { input, error, read: () => readInput(field, input.value) };
    nodes.push(wrap);
  }

  function read() {
    const result = {};
    let ok = true;
    for (const field of fields) {
      const part = parts[field.key];
      const { value, error } = part.read();
      part.error.textContent = error || "";
      if (error) ok = false;
      else result[field.key] = value;
    }
    return ok ? result : null;
  }
  return { parts, nodes, read };
}

// フォームに今入力されている内容を、1つの文字列にまとめる。
// 開いたときの内容と比べて「保存していない変更があるか」を調べるのに使う。
function snapshot(form) {
  return JSON.stringify([...form.querySelectorAll("input, select")].map((input) => input.value));
}

// フォームを「変更を見張る対象」として登録する
function watchUnsaved(form) {
  let saved = snapshot(form);
  hasUnsaved = () => snapshot(form) !== saved;
  // 保存できたら呼ぶ。今の内容を「保存済み」として覚え直す
  return () => { saved = snapshot(form); };
}

// 保存していない変更があれば確認を出す。そのまま進めてよければ true を返す。
function confirmDiscard() {
  if (!hasUnsaved || !hasUnsaved()) return true;
  return confirm(DISCARD_MESSAGE);
}

// データを保存する。失敗したらメッセージを表示して false を返す。
function trySave(messageNode) {
  try {
    saveData(data);
    return true;
  } catch (error) {
    messageNode.className = "message error-box";
    messageNode.textContent = error.message;
    return false;
  }
}

// ---- タブ --------------------------------------------------------------

function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren();
  for (const tab of TABS) {
    tabs.append(el("button", {
      type: "button",
      class: tab.id === currentTab ? "active" : "",
      text: tab.label,
      onclick: () => {
        if (tab.id === currentTab && !hasUnsaved) return;
        if (!confirmDiscard()) return;
        currentTab = tab.id;
        renderTabs();
        renderTab();
      },
    }));
  }
}

// 今のタブの中身を表示する
function renderTab(message = "") {
  hasUnsaved = null;
  if (currentTab === "basic") renderBasic();
  else renderList(currentTab, message);
}

function setContent(nodes) {
  document.getElementById("tab-content").replaceChildren(...nodes);
}

// ---- 基本情報タブ --------------------------------------------------------

function renderBasic() {
  const fields = buildFields(BASIC_FIELDS, data.basic);
  const message = el("p", { class: "message" });
  const form = el("form", { novalidate: "" }, [
    ...fields.nodes,
    el("div", { class: "form-buttons" }, [
      el("button", { type: "submit", class: "primary", text: "保存" }),
    ]),
    message,
  ]);
  const markSaved = watchUnsaved(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault(); // ページが再読み込みされる、フォーム本来の動きを止める
    message.className = "message";
    message.textContent = "";
    const values = fields.read();
    if (!values) return;
    const before = data.basic;
    data.basic = { ...data.basic, ...values };
    if (!trySave(message)) {
      data.basic = before; // 保存に失敗したら元に戻す
      return;
    }
    markSaved();
    message.textContent = "保存しました";
  });

  setContent([form]);
}

// ---- 一覧（収入・生活費・積立・イベント） -----------------------------------

// 一覧の1件を、カードに表示する文にする
function describeItem(type, item) {
  if (type === "events") {
    let text = item.yearMonth + "　" + item.name + "　自分で払う " + formatMoney(item.target);
    if (item.target !== item.estimate) text += "（総額 " + formatMoney(item.estimate) + "）";
    if (item.actual !== null) text += "　実際 " + formatMoney(item.actual);
    return text;
  }
  let text = item.start + " 〜 " + (item.end || "30歳") + "　月 " + formatMoney(item.monthly);
  for (const bonus of item.bonuses || []) {
    text += "　＋" + bonus.month + "月 " + formatMoney(bonus.amount);
  }
  return text;
}

function renderList(type, message) {
  const list = LISTS[type];
  // 年月の早い順に並べる（元の一覧は変えず、並べ替えた写しを作る）
  const sortKey = list.isPeriod ? "start" : "yearMonth";
  const items = [...data[type]].sort((a, b) => a[sortKey].localeCompare(b[sortKey]));

  const nodes = [];
  if (message) nodes.push(el("p", { class: "message", text: message }));
  if (items.length === 0) {
    nodes.push(el("p", { class: "note", text: "まだ登録がありません。" }));
  }
  for (const item of items) {
    const overlap = list.isPeriod && overlapsOthers(items, item, item.id);
    nodes.push(el("button", { type: "button", class: "card", onclick: () => renderForm(type, item) }, [
      el("span", { class: "card-main", text: describeItem(type, item) }),
      item.memo ? el("span", { class: "card-sub", text: item.memo }) : null,
      overlap ? el("span", { class: "card-warning", text: "⚠ " + OVERLAP_MESSAGE }) : null,
    ]));
  }
  nodes.push(el("button", {
    type: "button", class: "primary add", text: "＋ " + list.title + "を追加",
    onclick: () => renderForm(type, null),
  }));
  setContent(nodes);
}

// 追加・編集のフォームを表示する。item が null なら新規追加。
function renderForm(type, item) {
  const list = LISTS[type];
  const isNew = item === null;
  const fields = buildFields(list.fields, item || {});
  const warning = el("p", { class: "warning-box", hidden: "" });
  const message = el("p", { class: "message" });

  // フォームを閉じて一覧に戻る
  const close = (text) => renderTab(text);

  const form = el("form", { novalidate: "" }, [
    el("h2", { text: list.title + (isNew ? "を追加" : "を編集") }),
    ...fields.nodes,
    warning,
    el("div", { class: "form-buttons" }, [
      el("button", { type: "submit", class: "primary", text: "保存" }),
      el("button", { type: "button", text: "キャンセル", onclick: () => { if (confirmDiscard()) close(); } }),
      isNew ? null : el("button", {
        type: "button", class: "danger", text: "削除",
        onclick: () => {
          if (!confirm("この" + list.title + "を削除しますか？")) return;
          const before = data[type];
          data[type] = data[type].filter((other) => other.id !== item.id);
          if (!trySave(message)) {
            data[type] = before;
            return;
          }
          close("削除しました");
        },
      }),
    ]),
    message,
  ]);

  // 期間が重なっていたら注意を出す（保存はできる）。年月を入力するたびに調べ直す。
  if (list.isPeriod) {
    const checkOverlap = () => {
      const start = fields.parts.start.read().value;
      const end = fields.parts.end.read().value;
      // 開始年月が未入力・形式違いのあいだは調べない
      warning.hidden = !start || end === undefined ||
        !overlapsOthers(data[type], { start, end }, item ? item.id : null);
    };
    warning.textContent = "⚠ " + OVERLAP_MESSAGE;
    fields.parts.start.input.addEventListener("input", checkOverlap);
    fields.parts.end.input.addEventListener("input", checkOverlap);
    checkOverlap();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    message.className = "message";
    message.textContent = "";
    const values = fields.read();
    if (!values) return;

    // 終了年月は開始年月以降でなければならない
    if (list.isPeriod && values.end && values.end < values.start) {
      fields.parts.end.error.textContent = "開始年月以降にしてください";
      return;
    }
    // 自分で払う額（準備目標額）が空欄なら、総額と同じにする
    if (type === "events" && values.target === null) {
      values.target = values.estimate;
    }

    const before = data[type];
    if (isNew) {
      data[type] = [...data[type], { id: newId(), ...values }];
    } else {
      data[type] = data[type].map((other) => (other.id === item.id ? { ...other, ...values } : other));
    }
    if (!trySave(message)) {
      data[type] = before;
      return;
    }
    close("保存しました");
  });

  setContent([form]);
  watchUnsaved(form);
  window.scrollTo(0, 0);
}

// ---- 外から呼ぶ関数 ------------------------------------------------------

// 入力画面を準備する（app.js から、読み込んだデータを渡して呼ぶ）
export function initInput(loadedData) {
  data = loadedData;
  renderTabs();
  renderTab();

  // 保存していない変更があるままページを閉じたり再読み込みしようとしたら、
  // ブラウザの確認画面を出す
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsaved && hasUnsaved()) {
      event.preventDefault();
      event.returnValue = ""; // 古いブラウザ向けの書き方
    }
  });
}

// 入力画面からほかの画面へ移る前に呼ぶ。移ってよければ true を返す。
// 変更を破棄する場合は、入力途中のフォームを閉じて元の表示に戻しておく。
export function confirmLeaveInput() {
  if (!data) return true;
  if (!confirmDiscard()) return false;
  if (hasUnsaved) renderTab();
  return true;
}
