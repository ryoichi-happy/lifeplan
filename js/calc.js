// calc.js
// 資産の計算ロジックをまとめたファイル。
// 画面（HTML）や保存（localStorage）には触らず、
// 「データを受け取って、計算結果を返す」だけにしてあるので、テストしやすい。
// 金額はすべて万円単位。計算の途中では丸めず、表示するときに丸める。

// ---- 年月の変換 -------------------------------------------------------
// 年月 "2027-04" を「通し番号」（年×12＋月−1）に直す。
// 通し番号にすると、1か月進める＝1を足す、で済むので計算が楽になる。
export function ymToIndex(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return year * 12 + (month - 1);
}

// 通し番号を "2027-04" の形に戻す。
export function indexToYm(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return year + "-" + String(month).padStart(2, "0");
}

// 今日の年月を "2026-11" の形で返す。
export function currentYearMonth(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

// ---- 部品になる関数 ---------------------------------------------------
// 年率（%）を月利に換算する。 月利 = (1 + 年率)^(1/12) − 1
export function monthlyRate(annualReturnPct) {
  return Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
}

// 30歳になる月（計算の終点）を返す。
export function endYearMonth(birthYearMonth) {
  return indexToYm(ymToIndex(birthYearMonth) + 30 * 12);
}

// 値が空欄（未入力）かどうか
function isBlank(value) {
  return value === null || value === undefined || value === "";
}

// ある月（通し番号）が期間の中に入っているか。
// 終了年月の月も含む。終了年月が空欄なら、ずっと続くものとして扱う。
function inPeriod(period, index) {
  if (!isBlank(period.start) && index < ymToIndex(period.start)) return false;
  if (!isBlank(period.end) && index > ymToIndex(period.end)) return false;
  return true;
}

// その月に当てはまる期間の「毎月の額」を合計する。
// 期間が重なっていたら足し合わせる（例：バイト代＋仕送り）。
function sumMonthly(periods, index) {
  let total = 0;
  for (const period of periods) {
    if (inPeriod(period, index)) total += Number(period.monthly) || 0;
  }
  return total;
}

// その月の臨時収入（ボーナスなど）を合計する。
// bonuses は [{ month: 6, amount: 30 }, ...] の形で、期間内のその月に毎年入る。
function sumBonuses(incomes, index) {
  const month = (index % 12) + 1; // 1〜12
  let total = 0;
  for (const income of incomes) {
    if (!inPeriod(income, index)) continue;
    for (const bonus of income.bonuses || []) {
      if (Number(bonus.month) === month) total += Number(bonus.amount) || 0;
    }
  }
  return total;
}

// イベントで出ていく額。実際の額が記入されていればそれを、なければ予想額を使う。
export function eventCost(event) {
  return Number(isBlank(event.actual) ? event.estimate : event.actual) || 0;
}

// 最新の実績（年月がいちばん新しいもの）を返す。なければ null。
export function latestRecord(records) {
  let latest = null;
  for (const record of records || []) {
    if (latest === null || ymToIndex(record.yearMonth) > ymToIndex(latest.yearMonth)) {
      latest = record;
    }
  }
  return latest;
}

// ---- メインの計算 -----------------------------------------------------
// 起点の月から30歳の月まで、1か月ずつ資産を計算する。
//   data      : 保存データ（storage.js の形）
//   thisMonth : 今月（"2026-11" の形）。テストで日付を固定できるよう、外から渡す
// 戻り値は1か月ごとの結果の一覧（配列）。生まれ年月が未入力なら空の一覧を返す。
export function simulate(data, thisMonth) {
  const basic = data.basic;
  if (isBlank(basic.birthYearMonth)) return [];

  // 起点を決める
  // ・実績がある → 最新の実績を「その月の月末の残高」とみなし、翌月から計算
  // ・実績がない → 基本情報の残高を元に、今月分から計算
  const record = latestRecord(data.records);
  let startIndex, cash, investment;
  if (record) {
    startIndex = ymToIndex(record.yearMonth) + 1;
    cash = Number(record.cash) || 0;
    investment = Number(record.investment) || 0;
  } else {
    startIndex = ymToIndex(thisMonth);
    cash = Number(basic.cash) || 0;
    investment = Number(basic.investment) || 0;
  }

  const endIndex = ymToIndex(endYearMonth(basic.birthYearMonth));
  const rate = monthlyRate(Number(basic.annualReturnPct) || 0);

  const months = [];
  for (let index = startIndex; index <= endIndex; index++) {
    const yearMonth = indexToYm(index);

    const income = sumMonthly(data.incomes, index) + sumBonuses(data.incomes, index);
    const expense = sumMonthly(data.expenses, index);
    const saving = sumMonthly(data.savings, index);
    let eventTotal = 0;
    for (const event of data.events) {
      if (event.yearMonth === yearMonth) eventTotal += eventCost(event);
    }

    // 1. 余り ＝ 手取り（＋臨時収入）− 生活費 − イベント額
    const surplus = income - expense - eventTotal;
    // 2. 投資 ＝ 前月の投資 ×（1＋月利）＋ 積立額
    investment = investment * (1 + rate) + saving;
    // 3. 現金 ＝ 前月の現金 ＋ 余り − 積立額
    cash = cash + surplus - saving;

    months.push({
      yearMonth,
      income,
      expense,
      eventCost: eventTotal,
      saving,
      cash, // 月末の現金
      investment, // 月末の投資
      // 4. 現金がマイナスなら警告の印を付ける（投資の自動取り崩しはしない）
      cashShort: cash < 0,
    });
  }
  return months;
}
