// main.js
// メイン画面（見通し）の表示。
// 保存データを calc.js で計算し、上から「要約」「年表と資産グラフ」「表」を表示する。
// 年表とグラフは1枚の SVG の図で、同じ横軸を使うので、イベントの真下にその月の資産が来る。

import { simulate, judgeEvents, recordGaps, missingRecordMonth, ymToIndex, indexToYm } from "./calc.js";
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
const LABEL_GAP = 13; // 年表の印の中心から、名前までの距離
const BOUNDARY_HEIGHT = 16; // 「実績｜見込み」と書く帯の高さ（実績があるときだけ使う）

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

// ---- 判定の表示 ----------------------------------------------------------
// 判定ごとの名前。色だけに頼らないよう、形と記号も変える（色と形は style.css で決めている）
const STATUS = {
  ok: { label: "達成", icon: "✓" },
  caution: { label: "注意", icon: "!" },
  short: { label: "不足", icon: "×" },
  done: { label: "済み", icon: "" },
};

// 「✓ 達成」のような判定の表示（HTML）を作る
function statusBadge(status) {
  return el("span", { class: "status" }, [
    el("span", { class: "status-icon status-" + status, text: STATUS[status].icon }),
    el("span", { text: STATUS[status].label }),
  ]);
}

// 年表に置く印（SVG）を作る。達成＝丸に✓、注意＝三角に!、不足＝四角に×、済み＝小さな丸
function statusMark(status, cx, cy) {
  if (status === "ok") {
    return [
      svgEl("circle", { class: "mark mark-ok", cx, cy, r: 8 }),
      svgEl("polyline", { class: "mark-glyph-light", points: [cx - 4, cy, cx - 1, cy + 3, cx + 4, cy - 3].join(" ") }),
    ];
  }
  if (status === "caution") {
    return [
      svgEl("polygon", { class: "mark mark-caution", points: [cx, cy - 9, cx + 9.5, cy + 7, cx - 9.5, cy + 7].join(" ") }),
      svgEl("line", { class: "mark-glyph-dark", x1: cx, x2: cx, y1: cy - 3, y2: cy + 1.5 }),
      svgEl("circle", { class: "mark-dot-dark", cx, cy: cy + 4.5, r: 1.1 }),
    ];
  }
  if (status === "short") {
    return [
      svgEl("rect", { class: "mark mark-short", x: cx - 7.5, y: cy - 7.5, width: 15, height: 15, rx: 3 }),
      svgEl("line", { class: "mark-glyph-light", x1: cx - 3.5, x2: cx + 3.5, y1: cy - 3.5, y2: cy + 3.5 }),
      svgEl("line", { class: "mark-glyph-light", x1: cx - 3.5, x2: cx + 3.5, y1: cy + 3.5, y2: cy - 3.5 }),
    ];
  }
  return [svgEl("circle", { class: "mark mark-done", cx, cy, r: 5 })];
}

// ズレの金額を「＋3.2万円」「−1.0万円」の形にする
function formatSigned(value) {
  const rounded = Math.round(value * 10) / 10;
  return (rounded < 0 ? "−" : "＋") + Math.abs(rounded).toFixed(1) + "万円";
}

// ズレの説明文（合計と、現金・投資の内訳）を作る
function gapText(gap) {
  return "見込みより " + formatSigned(gap.cashGap + gap.investmentGap) +
    "（現金 " + formatSigned(gap.cashGap) + " ／ 投資 " + formatSigned(gap.investmentGap) + "）";
}

// 実績のある期間（最初の実績の月〜最新の実績の月）を、1か月ごとの一覧にする。
// 実績がない月は、前後の実績をまっすぐ結んだ線の上の値で補う（グラフの線をつなぐため）。
//   kind: "record" 実績のある月 / "between" 実績がなく補った月
function buildPast(gaps) {
  const past = [];
  gaps.forEach((gap, n) => {
    const record = gap.record;
    const index = ymToIndex(record.yearMonth);
    const cash = Number(record.cash) || 0;
    const investment = Number(record.investment) || 0;
    if (n > 0) {
      const previous = past[past.length - 1];
      const previousIndex = ymToIndex(previous.yearMonth);
      for (let k = previousIndex + 1; k < index; k++) {
        const ratio = (k - previousIndex) / (index - previousIndex);
        past.push({
          kind: "between",
          yearMonth: indexToYm(k),
          cash: previous.cash + (cash - previous.cash) * ratio,
          investment: previous.investment + (investment - previous.investment) * ratio,
          cashShort: false,
        });
      }
    }
    past.push({ kind: "record", yearMonth: record.yearMonth, cash, investment, cashShort: cash < 0, gap });
  });
  return past;
}

// 残りの月数を「あと1年2か月」の形にする
function formatMonthsLeft(count) {
  if (count <= 0) return "今月";
  const years = Math.floor(count / 12);
  const rest = count % 12;
  return "あと" + (years ? years + "年" : "") + (rest ? rest + "か月" : "");
}

// 判定の結果から、「毎月あといくら必要か」の説明文を作る
function needText(judgement) {
  if (judgement.status === "ok") return "今のペースで間に合います";
  if (judgement.shortfall > 0) {
    if (judgement.monthlyNeed === null) {
      return "不足 " + formatMoney(judgement.shortfall) + "（今月のイベントです）";
    }
    return "月 " + formatMoney(judgement.monthlyNeed) + "（不足 " + formatMoney(judgement.shortfall) + " ÷ " + judgement.monthsLeft + "か月）";
  }
  return "現金は足りますが、イベント後に最低限残したい額を " + formatMoney(judgement.minCashGap) + " 下回ります";
}

// 画面上部の要約を作る
function buildSummary(months, judgements) {
  const last = months[months.length - 1];
  const items = [
    el("div", { class: "summary-item" }, [
      el("p", { class: "summary-label", text: "30歳時点の予想資産" }),
      el("p", { class: "summary-hero", text: formatMoney(last.cash + last.investment) }),
      el("p", { class: "summary-sub", text: "現金 " + formatMoney(last.cash) + " ／ 投資 " + formatMoney(last.investment) }),
    ]),
  ];

  // これから来るイベント（判定の対象になっているもの）
  const upcoming = judgements.filter((j) => j.status === "ok" || j.status === "caution" || j.status === "short");
  if (upcoming.length === 0) {
    items.push(el("div", { class: "summary-item" }, [
      el("p", { class: "summary-label", text: "次のイベント" }),
      el("p", { class: "summary-sub", text: "予定されているイベントはありません。" }),
    ]));
    return el("div", { class: "summary" }, items);
  }

  const next = upcoming[0];
  const others = upcoming.slice(1);
  const cautionCount = others.filter((j) => j.status === "caution").length;
  const shortCount = others.filter((j) => j.status === "short").length;
  const otherText = [cautionCount ? "注意" + cautionCount + "件" : "", shortCount ? "不足" + shortCount + "件" : ""].filter(Boolean).join("・");

  items.push(
    el("div", { class: "summary-item" }, [
      el("p", { class: "summary-label", text: "次のイベント" }),
      el("p", { class: "summary-main" }, [
        el("span", { text: next.event.name + "　" + formatMonthsLeft(next.monthsLeft) }),
        statusBadge(next.status),
      ]),
      el("p", { class: "summary-sub", text: formatYearMonth(next.event.yearMonth) + "・自分で払う額 " + formatMoney(next.target) }),
      otherText ? el("p", { class: "summary-sub", text: "ほかに " + otherText }) : null,
    ]),
    el("div", { class: "summary-item" }, [
      el("p", { class: "summary-label", text: "毎月あといくら必要か" }),
      el("p", { class: "summary-main", text: needText(next) }),
      ...next.reasons.map((reason) => el("p", { class: "summary-sub", text: reason })),
    ]),
  );
  return el("div", { class: "summary" }, items);
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
  // これから先の見込み（最新の実績、なければ今の残高から計算したもの）
  const forecast = simulate(data, thisMonth);
  if (forecast.length === 0) {
    root.replaceChildren(el("p", { class: "note", text: "30歳の月を過ぎているため、表示する期間がありません。" }));
    return;
  }
  // 実績のある期間。図には「実績 → 見込み」の順につなげて描く
  const gaps = recordGaps(data);
  const past = buildPast(gaps);
  const months = past.concat(forecast);

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

  // イベントごとの判定（達成／注意／不足）。イベントから判定を引けるようにしておく
  const judgements = judgeEvents(data, thisMonth);
  const judgementOf = new Map(judgements.map((j) => [j.event, j]));

  const rowEnds = []; // 各段で、すでに使われている右端
  const placed = events.map((event) => {
    const i = ymToIndex(event.yearMonth) - startIndex;
    const label = shorten(event.name);
    const labelWidth = textWidth(label);
    // ふつうは印の右に名前を書く。右にはみ出すときは左に書く
    const onLeft = x(i) + LABEL_GAP + labelWidth > width;
    const left = onLeft ? x(i) - LABEL_GAP - labelWidth : x(i) - 10;
    const right = onLeft ? x(i) + 10 : x(i) + LABEL_GAP + labelWidth;
    let row = rowEnds.findIndex((end) => left > end + 4);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = right;
    return { event, i, label, onLeft, row, judgement: judgementOf.get(event) };
  });
  const timelineHeight = Math.max(rowEnds.length, 1) * ROW_HEIGHT + 8;

  const boundaryTop = HEADER_HEIGHT + timelineHeight; // 「実績｜見込み」の帯の上端
  const plotTop = boundaryTop + (past.length ? BOUNDARY_HEIGHT : 0) + PLOT_PAD;
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

  // 実績と見込みの境目（最新の実績の位置）に縦線を引き、左右に「実績」「見込み」と書く
  if (past.length) {
    const boundaryX = x(past.length - 1);
    chart.append(svgEl("line", { class: "boundary", x1: boundaryX, x2: boundaryX, y1: boundaryTop, y2: height - PLOT_PAD }));
    if (boundaryX >= 34) { // 左が狭くて書けないときは「実績」を省く
      chart.append(svgEl("text", { class: "boundary-label", x: boundaryX - 4, y: boundaryTop + 12, "text-anchor": "end", text: "実績" }));
    }
    chart.append(svgEl("text", { class: "boundary-label", x: boundaryX + 4, y: boundaryTop + 12, text: "見込み" }));
  }
  // 実績のある月に点を打つ（現金と、現金＋投資の2つ）
  months.forEach((month, i) => {
    if (month.kind !== "record") return;
    chart.append(
      svgEl("circle", { class: "dot-invest", cx: x(i), cy: y(total[i]), r: 4 }),
      svgEl("circle", { class: "dot-cash", cx: x(i), cy: y(month.cash), r: 4 }),
    );
  });

  // 選んだ月を示す縦線と点（最初は隠しておく）
  const crossLine = svgEl("line", { class: "crosshair", y1: HEADER_HEIGHT - 4, y2: height - PLOT_PAD });
  const crossCash = svgEl("circle", { class: "dot-cash", r: 4 });
  const crossInvest = svgEl("circle", { class: "dot-invest", r: 4 });
  const cross = svgEl("g", { visibility: "hidden" }, [crossLine, crossCash, crossInvest]);
  chart.append(cross);

  // 年表のイベント（判定の印と名前）
  for (const item of placed) {
    const cy = HEADER_HEIGHT + 4 + item.row * ROW_HEIGHT + ROW_HEIGHT / 2;
    const labelWidth = textWidth(item.label);
    // 印と名前をまとめて覆う、透明なタップ用の四角。
    // 印は1か月分の幅より大きいので、これがないと隣の月が選ばれてしまうことがある
    const hitLeft = item.onLeft ? x(item.i) - LABEL_GAP - labelWidth : x(item.i) - 12;
    const hitWidth = 12 + LABEL_GAP + labelWidth;
    // 印か名前をタップしたら、位置から月を探すのではなく、そのイベントの月を直接選ぶ
    const selectEvent = (event) => {
      event.stopPropagation(); // グラフ全体のタップ処理（位置から月を選ぶ）を動かさない
      select(item.i);
    };
    chart.append(svgEl("g", {
      class: "event",
      onclick: selectEvent,
      onpointermove: (event) => { if (event.pointerType === "mouse") selectEvent(event); },
    }, [
      svgEl("rect", { class: "event-hit", x: hitLeft, y: cy - ROW_HEIGHT / 2, width: hitWidth, height: ROW_HEIGHT }),
      ...statusMark(item.judgement.status, x(item.i), cy),
      svgEl("text", {
        class: "event-label", y: cy + 4, text: item.label,
        x: item.onLeft ? x(item.i) - LABEL_GAP : x(item.i) + LABEL_GAP,
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
    const kindText = month.kind === "record" ? "実績" : month.kind === "between" ? "実績なし" : "見込み";
    const rows = [
      el("p", { class: "readout-title", text: formatYearMonth(month.yearMonth) + "（" + age + "歳）の月末・" + kindText }),
      valueRow("swatch-cash", "現金", month.cash),
      valueRow("swatch-invest", "投資", month.investment),
      valueRow(null, "合計", month.cash + month.investment),
    ];
    if (month.kind === "between") {
      rows.push(el("p", { class: "readout-memo", text: "この月は実績がないため、前後の実績をまっすぐ結んだ値を表示しています。" }));
    }
    if (month.kind === "record") {
      rows.push(el("p", { class: "readout-memo", text: month.gap.cashGap === null
        ? "最初の実績なので、見込みとのズレはありません。"
        : "1つ前の実績から計算した" + gapText(month.gap) }));
      if (month.gap.record.memo) rows.push(el("p", { class: "readout-memo", text: "メモ：" + month.gap.record.memo }));
    }
    if (month.cashShort) {
      rows.push(el("p", { class: "readout-warning", text: "⚠ 現金がマイナスです" }));
    }
    for (const item of placed) {
      if (item.i !== i) continue;
      const event = item.event;
      const judgement = item.judgement;
      const isDone = judgement.status === "done";
      rows.push(el("p", { class: "readout-event" }, [
        el("span", { class: "readout-event-name", text: event.name }),
        statusBadge(judgement.status),
      ]));
      rows.push(el("p", { class: "readout-memo", text:
        (isDone ? "実際に自分で払った額 " + formatMoney(event.actual) : "自分で払う額 " + formatMoney(judgement.target)) +
        "（総額の予想 " + formatMoney(event.estimate) + "）" }));
      if (!isDone) {
        rows.push(el("p", { class: "readout-memo", text: "前月末の見込み：現金 " + formatMoney(judgement.cashBefore) + "・投資 " + formatMoney(judgement.investmentBefore) }));
        for (const reason of judgement.reasons) rows.push(el("p", { class: "readout-memo", text: reason }));
        if (judgement.status !== "ok") rows.push(el("p", { class: "readout-memo", text: needText(judgement) }));
      }
      if (event.memo) rows.push(el("p", { class: "readout-memo", text: "メモ：" + event.memo }));
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
    past.length ? el("span", {}, [el("span", { class: "swatch swatch-record" }), el("span", { text: "実績のある月" })]) : null,
    el("span", { class: "legend-unit", text: "単位：万円" }),
  ]);
  // 年表の印の説明（イベントがあるときだけ出す）
  const statusLegend = placed.length === 0 ? null : el("div", { class: "legend" }, [
    el("span", { text: "イベントの準備：" }),
    statusBadge("ok"), statusBadge("caution"), statusBadge("short"),
  ]);

  // ---- 表（図が見づらいとき用。各年の最後の月の値） ----
  const tableRows = [];
  months.forEach((month, i) => {
    const isYearEnd = month.yearMonth.endsWith("-12") || i === months.length - 1;
    if (!isYearEnd || month.kind === "between") return; // 実績がなく補った月は、表には出さない
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

  // ---- 要約（最新の実績があれば、見込みとのズレを4つ目の項目として足す） ----
  const summary = buildSummary(months, judgements);
  if (gaps.length) {
    const latest = gaps[gaps.length - 1];
    summary.append(el("div", { class: "summary-item" }, [
      el("p", { class: "summary-label", text: "最新の実績（" + formatYearMonth(latest.record.yearMonth) + "）" }),
      latest.cashGap === null
        ? el("p", { class: "summary-sub", text: "見込みとのズレは、実績が2か月分そろうと表示されます。" })
        : el("p", { class: "summary-main", text: gapText(latest) }),
    ]));
  }

  // ---- 実績の入力忘れの案内 ----
  const missing = missingRecordMonth(data, thisMonth);
  const notice = missing === null ? null : el("p", {
    class: "notice-box",
    text: formatYearMonth(missing) + "の実績がまだ入力されていません。「入力」→「実績」から登録できます。",
  });

  root.replaceChildren(
    ...[notice, warning].filter(Boolean),
    summary,
    el("div", { class: "viz-root chart-card" }, [
      legend,
      statusLegend,
      el("div", { class: "chart-row" }, [
        yAxis,
        el("div", { class: "chart-scroll" }, [chart]),
      ]),
      readout,
    ]),
    table,
  );
}
