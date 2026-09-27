const CACHE = "study-notes-v2";
const ASSETS = ["./","./index.html","./manifest.json","./408考点笔记.html","./数学笔记.html",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if(e.request.method!=="GET") return;
  const url = new URL(e.request.url);
  const isHTML = e.request.mode==="navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  if(isHTML){
    // 网络优先：保证内容永远是最新；断网时回退缓存
    e.respondWith(
      fetch(e.request).then(res=>{
        const cp=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
        return res;
      }).catch(()=>caches.match(e.request).then(h=>h||caches.match("./index.html")))
    );
  } else {
    // 静态资源：缓存优先
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
  }
});
