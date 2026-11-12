// main.js
// メイン画面（見通し）の表示。
// 保存データを calc.js で計算し、年表と資産グラフを1枚の SVG の図として描く。
// 年表とグラフは同じ横軸を使うので、イベントの真下にその月の資産が来る。

import { simulate, ymToIndex } from "./calc.js";
import { el, svgEl, formatMoney, formatYearMonth } from "./util.js";

// ---- 図の大きさ（単位は px） ---------------------------------------------
const YEAR_WIDTH = 80; // 1年あたりの横幅
const MONTH_WIDTH = YEAR_WIDTH / 12;
const PAD_LEFT = 8; // 図の左の余白
const PAD_RIGHT = 48; // 図の右の余白（「現金」「投資」のラベルを置く場所）
const HEADER_HEIGHT = 40; // 年と年齢を書く部分の高さ
const ROW_HEIGHT = 24; // 年表の1段の高さ
const PLOT_HEIGHT = 200; // グラフ部分の高さ
const PLOT_PAD = 10; // グラフの上下の余白
const Y_AXIS_WIDTH = 46; // 左に固定する縦軸の幅

// ---- 目盛りの計算 --------------------------------------------------------

// 目盛りの間隔を、1・2・5・10・20・50… のような切りのいい数にする
function niceStep(rough) {
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

// 最小値〜最大値を含む、切りのいい目盛りの一覧を作る
function makeTicks(min, max) {
  const step = niceStep((max - min) / 4);
  const ticks = [];
  for (let i = Math.floor(min / step); i <= Math.ceil(max / step); i++) {
    ticks.push(i * step);
  }
  return ticks;
}

// 縦軸の金額の書き方（100万、1.5億 など）
function formatAxis(value) {
  if (value === 0) return "0";
  if (Math.abs(value) >= 10000) return Number((value / 10000).toFixed(2)) + "億";
  return Number(value.toFixed(1)) + "万";
}

// 文字の横幅のおおよその見積もり（12px の文字。全角は12px、半角は7pxとして数える）
function textWidth(text) {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) < 0x2000 ? 7 : 12;
  return width;
}

// 長い名前は途中で切って「…」を付ける
function shorten(text, max = 12) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ---- メイン画面を描く ------------------------------------------------------
//   data      : 保存データ
//   thisMonth : 今月（"2026-11" の形）
export function renderMain(data, thisMonth) {
  const root = document.getElementById("main-content");

  if (!data.basic.birthYearMonth) {
    root.replaceChildren(el("p", { class: "note", text: "まず下の「入力」から、基本情報（生まれ年月と今の残高）を登録してください。" }));
    return;
  }
  const months = simulate(data, thisMonth);
  if (months.length === 0) {
    root.replaceChildren(el("p", { class: "note", text: "30歳の月を過ぎているため、表示する期間がありません。" }));
    return;
  }

  const birthIndex = ymToIndex(data.basic.birthYearMonth);
  const startIndex = ymToIndex(months[0].yearMonth);
  const endIndex = startIndex + months.length - 1;

  // 積み上げグラフ用の値。現金を下、投資を上に積む。
  // 現金がマイナスの月は、投資を0の線から積み、マイナス分は0より下に描く。
  const cashTop = months.map((m) => Math.max(m.cash, 0)); // 現金の面の上端
  const cashNegative = months.map((m) => Math.min(m.cash, 0)); // マイナス分（0以下）
  const total = months.map((m, i) => cashTop[i] + m.investment); // 投資の面の上端

  // ---- 位置を決める ----
  // 年表の段の割り当て（名前が重ならないよう、空いている段に入れる）
  const events = data.events
    .filter((event) => ymToIndex(event.yearMonth) >= startIndex && ymToIndex(event.yearMonth) <= endIndex)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  const width = PAD_LEFT + (months.length - 1) * MONTH_WIDTH + PAD_RIGHT;
  const x = (i) => PAD_LEFT + i * MONTH_WIDTH; // i 番目の月の横位置

  const rowEnds = []; // 各段で、すでに使われている右端
  const placed = events.map((event) => {
    const i = ymToIndex(event.yearMonth) - startIndex;
    const label = shorten(event.name);
    const labelWidth = textWidth(label);
    // ふつうは印の右に名前を書く。右にはみ出すときは左に書く
    const onLeft = x(i) + 10 + labelWidth > width;
    const left = onLeft ? x(i) - 10 - labelWidth : x(i) - 6;
    const right = onLeft ? x(i) + 6 : x(i) + 10 + labelWidth;
    let row = rowEnds.findIndex((end) => left > end + 4);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = right;
    return { event, i, label, onLeft, row };
  });
  const timelineHeight = Math.max(rowEnds.length, 1) * ROW_HEIGHT + 8;

  const plotTop = HEADER_HEIGHT + timelineHeight + PLOT_PAD;
  const height = plotTop + PLOT_HEIGHT + PLOT_PAD;

  // 縦軸の範囲と目盛り
  const ticks = makeTicks(Math.min(0, ...cashNegative), Math.max(10, ...total));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const y = (value) => plotTop + ((yMax - value) / (yMax - yMin)) * PLOT_HEIGHT; // 金額の縦位置

  // 点の並びを SVG の線の書き方（"x,y x,y ..."）にする
  const points = (values) => values.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1));
  // 上端と下端にはさまれた面を作る（上端を左→右、下端を右→左にたどる）
  const area = (upper, lower) => points(upper).concat(points(lower).reverse()).join(" ");
  const zero = months.map(() => 0);

  // ---- 図（横スクロールする部分）を組み立てる ----
  const chart = svgEl("svg", {
    class: "chart", width, height, viewBox: "0 0 " + width + " " + height,
    role: "img", "aria-label": "年表と資産の見通しのグラフ。下の「表で見る」から数値を確認できます。",
  });

  // 年の目盛り（毎年1月）と、年・年齢のラベル
  const startYear = Math.floor(startIndex / 12);
  const endYear = Math.floor(endIndex / 12);
  const birthYear = Math.floor(birthIndex / 12);
  for (let year = startYear; year <= endYear; year++) {
    const january = year * 12 - startIndex; // その年の1月が、何番目の月か
    if (january >= 0) {
      chart.append(svgEl("line", { class: "grid", x1: x(january), x2: x(january), y1: HEADER_HEIGHT - 4, y2: height - PLOT_PAD }));
    }
    // 最初の年が途中から始まる場合、次の1月まで狭ければラベルを省く
    if (january < 0 && x(january + 12) - x(0) < 36) continue;
    const labelX = x(Math.max(january, 0)) + 3;
    chart.append(
      svgEl("text", { class: "axis-year", x: labelX, y: 14, text: String(year) }),
      svgEl("text", { class: "axis-age", x: labelX, y: 30, text: (year - birthYear) + "歳" }),
    );
  }

  // 金額の目盛りの横線
  for (const tick of ticks) {
    chart.append(svgEl("line", { class: tick === 0 ? "baseline" : "grid", x1: 0, x2: width, y1: y(tick), y2: y(tick) }));
  }
  // 年表とグラフの区切り線
  chart.append(svgEl("line", { class: "grid", x1: 0, x2: width, y1: HEADER_HEIGHT - 4, y2: HEADER_HEIGHT - 4 }));

  // 面と線（現金 → 投資 → マイナス分の順に描く）
  chart.append(
    svgEl("polygon", { class: "area-cash", points: area(cashTop, zero) }),
    svgEl("polygon", { class: "area-invest", points: area(total, cashTop) }),
    svgEl("polygon", { class: "area-short", points: area(zero, cashNegative) }),
    svgEl("polyline", { class: "line-cash", points: points(cashTop).join(" ") }),
    svgEl("polyline", { class: "line-invest", points: points(total).join(" ") }),
  );

  // 右端に「現金」「投資」と直接書く（面が薄くて書く場所がないときは省き、凡例に任せる）
  const last = months.length - 1;
  const labelX = x(last) + 6;
  const cashBand = y(0) - y(cashTop[last]);
  const investBand = y(cashTop[last]) - y(total[last]);
  if (cashBand >= 14) {
    chart.append(svgEl("text", { class: "series-label", x: labelX, y: y(cashTop[last] / 2) + 4, text: "現金" }));
  }
  if (investBand >= 14) {
    chart.append(svgEl("text", { class: "series-label", x: labelX, y: y((cashTop[last] + total[last]) / 2) + 4, text: "投資" }));
  }

  // 選んだ月を示す縦線と点（最初は隠しておく）
  const crossLine = svgEl("line", { class: "crosshair", y1: HEADER_HEIGHT - 4, y2: height - PLOT_PAD });
  const crossCash = svgEl("circle", { class: "dot-cash", r: 4 });
  const crossInvest = svgEl("circle", { class: "dot-invest", r: 4 });
  const cross = svgEl("g", { visibility: "hidden" }, [crossLine, crossCash, crossInvest]);
  chart.append(cross);

  // 年表のイベント（印と名前）。判定の色とアイコンはステップ5で付ける
  for (const item of placed) {
    const cy = HEADER_HEIGHT + 4 + item.row * ROW_HEIGHT + ROW_HEIGHT / 2;
    chart.append(svgEl("g", { class: "event" }, [
      svgEl("circle", { class: "event-dot", cx: x(item.i), cy, r: 5 }),
      svgEl("text", {
        class: "event-label", y: cy + 4, text: item.label,
        x: item.onLeft ? x(item.i) - 10 : x(item.i) + 10,
        "text-anchor": item.onLeft ? "end" : "start",
      }),
    ]));
  }

  // ---- 左に固定する縦軸 ----
  const yAxis = svgEl("svg", { class: "y-axis", width: Y_AXIS_WIDTH, height, "aria-hidden": "true" });
  for (const tick of ticks) {
    yAxis.append(svgEl("text", { class: "axis-tick", x: Y_AXIS_WIDTH - 6, y: y(tick) + 4, "text-anchor": "end", text: formatAxis(tick) }));
  }

  // ---- タップした月の数値を出す欄 ----
  const readout = el("div", { class: "readout" }, [
    el("p", { class: "note", text: "グラフをタップすると、その月の金額が出ます。" }),
  ]);

  // i 番目の月を選ぶ
  function select(i) {
    const month = months[i];
    cross.setAttribute("visibility", "visible");
    crossLine.setAttribute("x1", x(i));
    crossLine.setAttribute("x2", x(i));
    crossCash.setAttribute("cx", x(i));
    crossCash.setAttribute("cy", y(month.cash)); // マイナスの月は0より下に点が出る
    crossInvest.setAttribute("cx", x(i));
    crossInvest.setAttribute("cy", y(total[i]));

    const age = Math.floor((startIndex + i - birthIndex) / 12);
    const rows = [
      el("p", { class: "readout-title", text: formatYearMonth(month.yearMonth) + "（" + age + "歳）の月末" }),
      valueRow("swatch-cash", "現金", month.cash),
      valueRow("swatch-invest", "投資", month.investment),
      valueRow(null, "合計", month.cash + month.investment),
    ];
    if (month.cashShort) {
      rows.push(el("p", { class: "readout-warning", text: "⚠ 現金がマイナスです" }));
    }
    for (const item of placed) {
      if (item.i !== i) continue;
      const event = item.event;
      const hasActual = event.actual !== null && event.actual !== undefined && event.actual !== "";
      rows.push(el("p", { class: "readout-event" }, [
        el("span", { class: "swatch swatch-event" }),
        el("span", { text: event.name + "　" + (hasActual ? "実際 " + formatMoney(event.actual) : "予想 " + formatMoney(event.estimate)) + "（準備目標 " + formatMoney(event.target) + "）" }),
      ]));
      if (event.memo) rows.push(el("p", { class: "readout-memo", text: event.memo }));
    }
    readout.replaceChildren(...rows);
  }

  // 「■ 現金　85.2万円」の1行を作る
  function valueRow(swatchClass, label, value) {
    return el("p", { class: "readout-row" }, [
      el("span", { class: "swatch " + (swatchClass || "swatch-none") }),
      el("span", { class: "readout-label", text: label }),
      el("span", { class: "readout-value", text: formatMoney(value) }),
    ]);
  }

  // タップ（またはマウスを動かした）位置に、いちばん近い月を選ぶ
  function selectAt(event) {
    const offset = event.clientX - chart.getBoundingClientRect().left;
    const i = Math.round((offset - PAD_LEFT) / MONTH_WIDTH);
    select(Math.min(Math.max(i, 0), months.length - 1));
  }
  chart.addEventListener("click", selectAt);
  // パソコンではマウスを動かすだけで追従させる。
  // スマホの指の動きは横スクロールに使うので、タップのときだけ選ぶ
  chart.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse") selectAt(event);
  });

  // ---- 現金がマイナスになる月の警告 ----
  const shortMonths = months.filter((m) => m.cashShort);
  const warning = shortMonths.length === 0 ? null : el("p", {
    class: "warning-box",
    text: "⚠ " + formatYearMonth(shortMonths[0].yearMonth) + "に現金がマイナスになります（マイナスの月は全部で" + shortMonths.length + "か月）",
  });

  // ---- 凡例（色の説明） ----
  const legend = el("div", { class: "legend" }, [
    el("span", {}, [el("span", { class: "swatch swatch-cash" }), el("span", { text: "現金" })]),
    el("span", {}, [el("span", { class: "swatch swatch-invest" }), el("span", { text: "投資" })]),
    shortMonths.length ? el("span", {}, [el("span", { class: "swatch swatch-short" }), el("span", { text: "⚠ 現金のマイナス" })]) : null,
    el("span", { class: "legend-unit", text: "単位：万円" }),
  ]);

  // ---- 表（図が見づらいとき用。各年の最後の月の値） ----
  const tableRows = [];
  months.forEach((month, i) => {
    const isYearEnd = month.yearMonth.endsWith("-12") || i === months.length - 1;
    if (!isYearEnd) return;
    tableRows.push(el("tr", {}, [
      el("td", { text: formatYearMonth(month.yearMonth) }),
      el("td", { class: "num", text: month.cash.toFixed(1) }),
      el("td", { class: "num", text: month.investment.toFixed(1) }),
      el("td", { class: "num", text: (month.cash + month.investment).toFixed(1) }),
    ]));
  });
  const table = el("details", { class: "table-view" }, [
    el("summary", { text: "表で見る（各年の12月末・万円）" }),
    el("table", {}, [
      el("thead", {}, [el("tr", {}, ["年月", "現金", "投資", "合計"].map((text) => el("th", { text })))]),
      el("tbody", {}, tableRows),
    ]),
  ]);

  root.replaceChildren(
    ...[warning].filter(Boolean),
    el("div", { class: "viz-root chart-card" }, [
      legend,
      el("div", { class: "chart-row" }, [
        yAxis,
        el("div", { class: "chart-scroll" }, [chart]),
      ]),
      readout,
    ]),
    table,
  );
}
