// testlib.js
// テストを書くための小さな道具。calc.test.js と storage.test.js が使う。

// テスト結果をためておく一覧。{ name: テスト名, ok: 成功したか, detail: 失敗の内容 }
export const results = [];

// テストを1つ実行する。途中でエラーが出たら失敗として記録する。
export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true, detail: "" });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

// 2つの数がほぼ等しいことを確かめる。
// 小数の計算にはごく小さな誤差が出るので、完全一致ではなく差が十分小さいかで判定する。
export function near(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(label + ": 期待 " + expected + " / 実際 " + actual);
  }
}

// 2つの値が同じであることを確かめる。
export function same(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ": 期待 " + expected + " / 実際 " + actual);
  }
}

// 関数を実行するとエラーになり、そのメッセージに指定した文字が含まれることを確かめる。
export function throwsWith(fn, part, label) {
  try {
    fn();
  } catch (error) {
    if (error.message.includes(part)) return;
    throw new Error(label + ": エラーの文が違います → " + error.message);
  }
  throw new Error(label + ": エラーになりませんでした");
}
