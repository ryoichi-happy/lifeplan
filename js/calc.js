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

// イベントの「自分で払う額」（準備目標額）。空欄なら総額（予想額）と同じとみなす。
export function eventTarget(event) {
  return Number(isBlank(event.target) ? event.estimate : event.target) || 0;
}

// イベントが終わっている（実際に自分で払った額が記入されている）か
export function isEventDone(event) {
  return !isBlank(event.actual);
}

// イベントで現金から出ていく額。
// 実際に払った額が記入されていればそれを、なければ「自分で払う額」を使う。
// （援助してもらう分は自分の現金から出ないので、総額ではなく自分で払う額を引く）
export function eventCost(event) {
  return isEventDone(event) ? Number(event.actual) || 0 : eventTarget(event);
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

// 計算の起点（最初に計算する月と、その直前の残高）を決める。
// ・実績がある → 最新の実績を「その月の月末の残高」とみなし、翌月から計算
// ・実績がない → 基本情報の残高を元に、今月分から計算
export function startPoint(data, thisMonth) {
  const record = latestRecord(data.records);
  if (record) {
    return {
      index: ymToIndex(record.yearMonth) + 1,
      cash: Number(record.cash) || 0,
      investment: Number(record.investment) || 0,
    };
  }
  return {
    index: ymToIndex(thisMonth),
    cash: Number(data.basic.cash) || 0,
    investment: Number(data.basic.investment) || 0,
  };
}

// ---- メインの計算 -----------------------------------------------------
// 起点の月から30歳の月まで、1か月ずつ資産を計算する。
//   data      : 保存データ（storage.js の形）
//   thisMonth : 今月（"2026-11" の形）。テストで日付を固定できるよう、外から渡す
// 戻り値は1か月ごとの結果の一覧（配列）。生まれ年月が未入力なら空の一覧を返す。
export function simulate(data, thisMonth) {
  if (isBlank(data.basic.birthYearMonth)) return [];
  const endIndex = ymToIndex(endYearMonth(data.basic.birthYearMonth));
  return simulateFrom(data, startPoint(data, thisMonth), endIndex);
}

// 指定した起点から、指定した月（通し番号）まで計算する。
//   start : { index: 最初に計算する月, cash: その直前の現金, investment: その直前の投資 }
function simulateFrom(data, start, endIndex) {
  const rate = monthlyRate(Number(data.basic.annualReturnPct) || 0);
  let cash = start.cash;
  let investment = start.investment;

  const months = [];
  for (let index = start.index; index <= endIndex; index++) {
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

// ---- 実績と見込みのズレ -------------------------------------------------
// 実績を年月の早い順に並べ、1件ごとに「見込みとのズレ」を付けて返す。
//   ズレ ＝ 実績 −「1つ前の実績から、今の入力内容で計算した見込み」
// 最初の1件は比べる相手がないので、ズレは null になる。
// 1件分の中身:
//   record : 元の実績
//   predictedCash, predictedInvestment : 1つ前の実績から計算した見込み
//   cashGap, investmentGap             : ズレ（プラスなら見込みより多い）
export function recordGaps(data) {
  const records = [...(data.records || [])].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return records.map((record, n) => {
    if (n === 0) {
      return { record, predictedCash: null, predictedInvestment: null, cashGap: null, investmentGap: null };
    }
    const previous = records[n - 1];
    const start = {
      index: ymToIndex(previous.yearMonth) + 1,
      cash: Number(previous.cash) || 0,
      investment: Number(previous.investment) || 0,
    };
    const months = simulateFrom(data, start, ymToIndex(record.yearMonth));
    const predicted = months[months.length - 1];
    return {
      record,
      predictedCash: predicted.cash,
      predictedInvestment: predicted.investment,
      cashGap: (Number(record.cash) || 0) - predicted.cash,
      investmentGap: (Number(record.investment) || 0) - predicted.investment,
    };
  });
}

// 入力を促したほうがよい実績の年月を返す（促さなくてよければ null）。
// 先月の実績も今月の実績もないとき、先月の年月を返す。
export function missingRecordMonth(data, thisMonth) {
  const lastMonth = indexToYm(ymToIndex(thisMonth) - 1);
  const has = (yearMonth) => (data.records || []).some((record) => record.yearMonth === yearMonth);
  return has(lastMonth) || has(thisMonth) ? null : lastMonth;
}

// ---- 準備目標の判定 ---------------------------------------------------
// 小数の計算のごく小さな誤差で「ちょうど同じ額」が届かない扱いにならないための幅
const EPSILON = 1e-9;

// イベントごとに、準備が間に合うかを判定する。年月の早い順に並べた一覧を返す。
// 1件分の中身:
//   event       : 元のイベント
//   status      : "ok" 達成 / "caution" 注意 / "short" 不足 /
//                 "done" 済み（実際の額が記入済み、または起点より前）/ "none" 30歳より後で対象外
//   reasons     : 注意・不足の理由（文章の一覧）
//   target      : 自分で払う額（準備目標額）
//   cashBefore, investmentBefore : イベント前月末の現金と投資
//   cashAfter   : イベントの月の月末の現金
//   shortfall   : 不足額 ＝ 準備目標額 − イベント前月末の現金（足りていれば 0）
//   minCashGap  : イベント後の現金が「最低限残しておきたい額」に届かない分（届いていれば 0）
//   monthsLeft  : 今月からイベント前月までの月数（イベントが今月なら 0）
//   monthlyNeed : 毎月あといくら必要か ＝ 不足額 ÷ monthsLeft（今月のイベントは null）
export function judgeEvents(data, thisMonth) {
  const months = simulate(data, thisMonth);
  const start = startPoint(data, thisMonth);
  const thisIndex = ymToIndex(thisMonth);
  const minCash = Number(data.basic.minCash) || 0;

  const sorted = [...data.events].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  return sorted.map((event) => {
    const index = ymToIndex(event.yearMonth);
    const i = index - start.index; // 計算結果の一覧の中で、イベントの月が何番目か
    const result = { event, status: "done", reasons: [], target: eventTarget(event) };

    if (isEventDone(event) || i < 0) return result;
    if (i >= months.length) return { ...result, status: "none" };

    // イベント前月末の残高。イベントが起点の月にあるときは、起点の残高を使う
    const before = i === 0 ? start : months[i - 1];
    const cashBefore = before.cash;
    const investmentBefore = before.investment;
    const cashAfter = months[i].cash;

    const reachByCash = cashBefore >= result.target - EPSILON;
    const reachWithInvestment = cashBefore + investmentBefore >= result.target - EPSILON;
    const keepsMinCash = cashAfter >= minCash - EPSILON;

    if (!reachWithInvestment) {
      result.status = "short";
      result.reasons.push("投資を合わせても、自分で払う額に届きません");
    } else if (reachByCash && keepsMinCash) {
      result.status = "ok";
    } else {
      result.status = "caution";
      if (!reachByCash) result.reasons.push("現金だけでは届きませんが、投資を合わせれば届きます");
      if (!keepsMinCash) result.reasons.push("イベント後の現金が、最低限残しておきたい額を下回ります");
    }

    const shortfall = reachByCash ? 0 : result.target - cashBefore;
    const monthsLeft = Math.max(index - thisIndex, 0);
    return {
      ...result,
      cashBefore,
      investmentBefore,
      cashAfter,
      shortfall,
      minCashGap: keepsMinCash ? 0 : minCash - cashAfter,
      monthsLeft,
      monthlyNeed: monthsLeft > 0 ? shortfall / monthsLeft : null,
    };
  });
}
