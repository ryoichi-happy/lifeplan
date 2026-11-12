// util.js
// いろいろな画面で使う、小さな道具をまとめたファイル。

// HTML の要素を作る。 el("p", { class: "note", text: "こんにちは" }) のように使う。
//   class → クラス名 / text → 中の文字 / on〜 → クリックなどのときに動かす関数
//   それ以外は、そのまま要素の属性になる
export function el(tag, props = {}, children = []) {
  return applyProps(document.createElement(tag), props, children);
}

// SVG（図形を描くための要素）を作る。使い方は el と同じ。
// SVG の要素は、専用の作り方（createElementNS）をしないと表示されない。
export function svgEl(tag, props = {}, children = []) {
  return applyProps(document.createElementNS("http://www.w3.org/2000/svg", tag), props, children);
}

function applyProps(node, props, children) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.setAttribute("class", value);
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

// 金額を「8.0万円」の形にする
export function formatMoney(value) {
  return Number(value).toFixed(1) + "万円";
}

// 年月 "2028-04" を「2028年4月」の形にする
export function formatYearMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return year + "年" + month + "月";
}
