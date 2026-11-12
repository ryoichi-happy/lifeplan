// calc.test.js
// calc.js のテスト。手計算で答えが分かる小さな例を計算させて、合っているか確かめる。
// test.html を開くと実行され、結果が ○／× で表示される。
// テストに使う金額はすべて架空の値。

import { createEmptyData } from "./storage.js";
import {
  simulate, judgeEvents, recordGaps, missingRecordMonth,
  monthlyRate, endYearMonth, ymToIndex, indexToYm,
} from "./calc.js";

// テスト結果をためておく一覧。{ name: テスト名, ok: 成功したか, detail: 失敗の内容 }
export const results = [];

// テストを1つ実行する。途中でエラーが出たら失敗として記録する。
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true, detail: "" });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

// 2つの数がほぼ等しいことを確かめる。
// 小数の計算にはごく小さな誤差が出るので、完全一致ではなく差が十分小さいかで判定する。
function near(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(label + ": 期待 " + expected + " / 実際 " + actual);
  }
}

// 2つの値が同じであることを確かめる。
function same(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ": 期待 " + expected + " / 実際 " + actual);
  }
}

// テスト用のデータを作る。2000年1月生まれ → 30歳の月は2030年1月。
function baseData() {
  const data = createEmptyData();
  data.basic.birthYearMonth = "2000-01";
  data.basic.cash = 100;
  data.basic.investment = 50;
  return data;
}

// 結果の一覧から、指定した年月の行を取り出す。
function monthOf(months, yearMonth) {
  const found = months.find((m) => m.yearMonth === yearMonth);
  if (!found) throw new Error(yearMonth + " の行がありません");
  return found;
}

// ---- ここからテスト ----------------------------------------------------

test("年月と通し番号を行き来できる", () => {
  same(indexToYm(ymToIndex("2027-04")), "2027-04", "4月");
  same(indexToYm(ymToIndex("2027-12") + 1), "2028-01", "12月の翌月");
  same(endYearMonth("2000-01"), "2030-01", "30歳の月");
});

test("今月から30歳の月まで計算する", () => {
  const months = simulate(baseData(), "2029-11");
  same(months.length, 3, "月数");
  same(months[0].yearMonth, "2029-11", "最初の月");
  same(months[2].yearMonth, "2030-01", "最後の月");
});

test("生まれ年月が未入力なら空の一覧を返す", () => {
  same(simulate(createEmptyData(), "2029-11").length, 0, "月数");
});

test("1か月で 現金＋5、投資＋3（収入20・生活費12・積立3）", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "", monthly: 20, bonuses: [] });
  data.expenses.push({ start: "2029-01", end: "", monthly: 12 });
  data.savings.push({ start: "2029-01", end: "", monthly: 3 });
  const first = simulate(data, "2029-11")[0];
  near(first.cash, 105, "現金");
  near(first.investment, 53, "投資");
});

test("年率5%で12か月たつと投資が1.05倍になる", () => {
  const data = baseData();
  data.basic.annualReturnPct = 5;
  const months = simulate(data, "2029-02"); // 2029-02 〜 2030-01 の12か月
  same(months.length, 12, "月数");
  near(months[11].investment, 50 * 1.05, "投資");
  near(Math.pow(1 + monthlyRate(5), 12), 1.05, "月利の換算");
});

test("期間の切り替わり（終了年月の月も含む）", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "2029-11", monthly: 10, bonuses: [] });
  data.incomes.push({ start: "2029-12", end: "", monthly: 25, bonuses: [] });
  const months = simulate(data, "2029-10");
  same(monthOf(months, "2029-11").income, 10, "終了月");
  same(monthOf(months, "2029-12").income, 25, "次の期間の開始月");
  same(monthOf(months, "2030-01").income, 25, "終了が空欄なら続く");
});

test("重なった期間は合計する", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "", monthly: 8, bonuses: [] });
  data.incomes.push({ start: "2029-01", end: "2029-11", monthly: 5, bonuses: [] });
  const months = simulate(data, "2029-11");
  same(monthOf(months, "2029-11").income, 13, "重なる月");
  same(monthOf(months, "2029-12").income, 8, "重ならない月");
});

test("臨時収入は期間内の指定した月にだけ入る", () => {
  const data = baseData();
  data.incomes.push({
    start: "2029-01", end: "2029-12", monthly: 20,
    bonuses: [{ month: 12, amount: 40 }, { month: 1, amount: 99 }],
  });
  const months = simulate(data, "2029-11");
  same(monthOf(months, "2029-11").income, 20, "ボーナスのない月");
  same(monthOf(months, "2029-12").income, 60, "ボーナス月");
  same(monthOf(months, "2030-01").income, 0, "期間が終わった後の1月");
});

test("イベントの月に「自分で払う額」が引かれる（総額ではない）", () => {
  const data = baseData();
  // 総額80のうち、援助を見込んで自分で払うのは30
  data.events.push({ name: "テスト", yearMonth: "2029-12", estimate: 80, target: 30, actual: null });
  const months = simulate(data, "2029-11");
  near(monthOf(months, "2029-11").cash, 100, "イベント前");
  near(monthOf(months, "2029-12").cash, 70, "イベント月");
});

test("自分で払う額が空欄なら総額を使う", () => {
  const data = baseData();
  data.events.push({ name: "テスト", yearMonth: "2029-12", estimate: 80, target: null, actual: null });
  same(monthOf(simulate(data, "2029-11"), "2029-12").eventCost, 80, "イベント額");
});

test("実際に払った額があれば、それを使う（0円も有効）", () => {
  const data = baseData();
  data.events.push({ name: "A", yearMonth: "2029-12", estimate: 30, target: 30, actual: 45 });
  data.events.push({ name: "B", yearMonth: "2030-01", estimate: 30, target: 30, actual: 0 });
  const months = simulate(data, "2029-11");
  same(monthOf(months, "2029-12").eventCost, 45, "実際の額");
  same(monthOf(months, "2030-01").eventCost, 0, "実際の額が0円");
});

test("実績があれば、最新の実績の翌月から計算する", () => {
  const data = baseData();
  data.records.push({ yearMonth: "2029-09", cash: 80, investment: 60 });
  data.records.push({ yearMonth: "2029-11", cash: 90, investment: 70 }); // こちらが最新
  data.records.push({ yearMonth: "2029-10", cash: 85, investment: 65 });
  data.incomes.push({ start: "2029-01", end: "", monthly: 10, bonuses: [] });
  const months = simulate(data, "2029-12");
  same(months[0].yearMonth, "2029-12", "最初の月");
  near(months[0].cash, 100, "現金（90＋10）");
  near(months[0].investment, 70, "投資");
});

test("現金がマイナスの月に警告の印が付く", () => {
  const data = baseData();
  data.events.push({ name: "テスト", yearMonth: "2029-12", estimate: 130, target: 130, actual: null });
  const months = simulate(data, "2029-11");
  same(monthOf(months, "2029-11").cashShort, false, "イベント前");
  same(monthOf(months, "2029-12").cashShort, true, "イベント月");
  near(monthOf(months, "2029-12").cash, -30, "マイナスのまま計算を続ける");
});

// ---- 準備目標の判定 ----------------------------------------------------
// baseData は 現金100・投資50。収入や生活費がなければ、イベントまで残高は変わらない。

// イベントを1件だけ入れて判定し、その結果を返す
function judgeOne(data, event, thisMonth = "2029-10") {
  data.events.push({ name: "テスト", estimate: event.target, actual: null, ...event });
  return judgeEvents(data, thisMonth)[0];
}

test("判定：現金だけで届き、最低額も残れば「達成」", () => {
  const data = baseData();
  data.basic.minCash = 20;
  const j = judgeOne(data, { yearMonth: "2029-12", target: 80 }); // イベント後の現金は20
  same(j.status, "ok", "判定（最低額ちょうどは達成）");
  near(j.cashBefore, 100, "前月末の現金");
  near(j.cashAfter, 20, "イベント後の現金");
  same(j.shortfall, 0, "不足額");
});

test("判定：目標額ちょうどの現金でも「達成」", () => {
  same(judgeOne(baseData(), { yearMonth: "2029-12", target: 100 }).status, "ok", "判定");
});

test("判定：現金では届かないが投資込みなら届けば「注意」", () => {
  const j = judgeOne(baseData(), { yearMonth: "2029-12", target: 120 });
  same(j.status, "caution", "判定");
  near(j.shortfall, 20, "不足額（120 − 100）");
  same(j.monthsLeft, 2, "今月(10月)からイベント前月(11月)までの月数");
  near(j.monthlyNeed, 10, "毎月あといくら（20 ÷ 2）");
});

test("判定：現金で届いても、イベント後に最低額を下回れば「注意」", () => {
  const data = baseData();
  data.basic.minCash = 30;
  const j = judgeOne(data, { yearMonth: "2029-12", target: 80 }); // イベント後の現金は20
  same(j.status, "caution", "判定");
  same(j.shortfall, 0, "不足額");
  near(j.minCashGap, 10, "最低額に届かない分");
});

test("判定：投資込みでも届かなければ「不足」", () => {
  const j = judgeOne(baseData(), { yearMonth: "2029-12", target: 160 });
  same(j.status, "short", "判定");
  near(j.shortfall, 60, "不足額（160 − 100）");
});

test("判定：イベントが今月なら、起点の残高で判定し、月割りはしない", () => {
  const j = judgeOne(baseData(), { yearMonth: "2029-10", target: 120 });
  same(j.status, "caution", "判定");
  near(j.cashBefore, 100, "起点の現金");
  same(j.monthsLeft, 0, "月数");
  same(j.monthlyNeed, null, "毎月あといくら");
});

test("判定：それまでの収入と、前のイベントの支払いを反映する", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "", monthly: 10, bonuses: [] });
  data.events.push({ name: "先", yearMonth: "2029-11", estimate: 90, target: 90, actual: null });
  data.events.push({ name: "後", yearMonth: "2030-01", estimate: 50, target: 50, actual: null });
  const [first, second] = judgeEvents(data, "2029-10");
  near(first.cashBefore, 110, "先のイベント前月末（100＋10）");
  near(second.cashBefore, 40, "後のイベント前月末（100＋30−90）");
  same(second.status, "caution", "後のイベントの判定");
});

test("判定：実際の額が記入済み・起点より前は「済み」、30歳より後は対象外", () => {
  const data = baseData();
  data.events.push({ name: "記入済み", yearMonth: "2029-12", estimate: 500, target: 500, actual: 10 });
  data.events.push({ name: "過去", yearMonth: "2029-01", estimate: 500, target: 500, actual: null });
  data.events.push({ name: "30歳より後", yearMonth: "2031-01", estimate: 500, target: 500, actual: null });
  const result = judgeEvents(data, "2029-10");
  same(result.map((j) => j.event.name).join(), "過去,記入済み,30歳より後", "年月の順に並ぶ");
  same(result.map((j) => j.status).join(), "done,done,none", "判定");
});

// ---- 実績と見込みのズレ --------------------------------------------------

test("ズレ：1つ前の実績から計算した見込みと比べる", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "", monthly: 20, bonuses: [] });
  data.expenses.push({ start: "2029-01", end: "", monthly: 12 });
  data.savings.push({ start: "2029-01", end: "", monthly: 3 });
  // 毎月の見込みは 現金＋5、投資＋3
  data.records.push({ yearMonth: "2029-10", cash: 110, investment: 60 }); // わざと順番を入れ替えて登録
  data.records.push({ yearMonth: "2029-09", cash: 100, investment: 50 });
  const [first, second] = recordGaps(data);
  same(first.record.yearMonth, "2029-09", "年月の早い順に並ぶ");
  same(first.cashGap, null, "最初の1件はズレなし");
  near(second.predictedCash, 105, "現金の見込み");
  near(second.predictedInvestment, 53, "投資の見込み");
  near(second.cashGap, 5, "現金のズレ（110 − 105）");
  near(second.investmentGap, 7, "投資のズレ（60 − 53）");
});

test("ズレ：実績が何か月か空いていても、その間を計算して比べる", () => {
  const data = baseData();
  data.incomes.push({ start: "2029-01", end: "", monthly: 10, bonuses: [] });
  data.records.push({ yearMonth: "2029-06", cash: 100, investment: 0 });
  data.records.push({ yearMonth: "2029-09", cash: 120, investment: 0 });
  const second = recordGaps(data)[1];
  near(second.predictedCash, 130, "3か月分の見込み（100＋10×3）");
  near(second.cashGap, -10, "現金のズレ");
});

test("入力忘れ：先月も今月も実績がなければ、先月の年月を返す", () => {
  const data = baseData();
  same(missingRecordMonth(data, "2029-11"), "2029-10", "実績なし");
  same(missingRecordMonth(data, "2029-01"), "2028-12", "1月なら前の年の12月");
  data.records.push({ yearMonth: "2029-09", cash: 1, investment: 1 });
  same(missingRecordMonth(data, "2029-11"), "2029-10", "古い実績だけ");
  data.records.push({ yearMonth: "2029-10", cash: 1, investment: 1 });
  same(missingRecordMonth(data, "2029-11"), null, "先月の実績あり");
  data.records[1].yearMonth = "2029-11";
  same(missingRecordMonth(data, "2029-11"), null, "今月の実績あり");
});
