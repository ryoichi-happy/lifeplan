// sw.js
// サービスワーカー：ページの裏で動く小さなプログラム。
// アプリのファイルを端末に控えて（キャッシュして）おき、電波がないときでも開けるようにする。
//
// 方針は「ネット優先」。
//   ・つながるとき   → ネットから最新のファイルを取り、控えも新しくする
//   ・つながらないとき → 控えを使う
// こうしておくと、コードを直して公開すれば、次に開いたときに新しい版になる。

// 控えの名前。GitHub Pages では同じドメインの他のアプリと置き場所を共有するので、
// このアプリ固有の名前を先頭に付ける。
const CACHE_PREFIX = "lifeplan-app-";
const CACHE_NAME = CACHE_PREFIX + "v1";

// ネットの返事をこの時間（ミリ秒）待っても来なければ、控えを使う
const TIMEOUT = 4000;

// 最初に控えておくファイルの一覧。ファイルを増やしたら、ここにも足す。
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/calc.js",
  "js/data.js",
  "js/input.js",
  "js/main.js",
  "js/storage.js",
  "js/util.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

// インストールされたとき：ファイルをまとめて控える
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()) // 古いサービスワーカーの終了を待たずに交代する
  );
});

// 動き始めたとき：このアプリの古い控えを消す（他のアプリの控えには触らない）
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim()) // 今開いているページもすぐ担当する
  );
});

// ネットから取る。時間がかかりすぎたら失敗として扱う
function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// ページがファイルを取りに行くたびに呼ばれる
self.addEventListener("fetch", (event) => {
  const request = event.request;
  // このアプリのファイルの読み込み（GET）だけを扱う。それ以外はブラウザに任せる
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;

  event.respondWith(
    fetchWithTimeout(request)
      .then((response) => {
        // 正しく取れたら、控えを新しくしておく
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // ネットから取れなかったら、控えを探す。なければ失敗を返す
        caches.match(request, { ignoreSearch: true }).then((cached) => cached || Response.error())
      )
  );
});
