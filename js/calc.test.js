// calc.test.js
// calc.js のテスト。手計算で答えが分かる小さな例を計算させて、合っているか確かめる。
// test.html を開くと実行され、結果が ○／× で表示される。
// テストに使う金額はすべて架空の値。

import { createEmptyData } from "./storage.js";
import { simulate, monthlyRate, endYearMonth, ymToIndex, indexToYm } from "./calc.js";

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

test("イベントの月に予想額が引かれる", () => {
  const data = baseData();
  data.events.push({ name: "テスト", yearMonth: "2029-12", estimate: 30, target: 30, actual: null });
  const months = simulate(data, "2029-11");
  near(monthOf(months, "2029-11").cash, 100, "イベント前");
  near(monthOf(months, "2029-12").cash, 70, "イベント月");
});

test("実際の額があれば予想額の代わりに使う（0円も有効）", () => {
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
