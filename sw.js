const CACHE = "study-notes-v8";
const ASSETS = ["./","./index.html","./manifest.json","./408考点笔记.html","./数学笔记.html","./英语笔记.html",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png",
  "./assets/katex.min.css","./assets/katex.min.js","./assets/auto-render.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if(e.request.method!=="GET") return;
  const url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;
  const isHTML = e.request.mode==="navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  if(isHTML){
    // HTML：网络优先（永远最新），断网回退缓存
    e.respondWith(
      fetch(e.request).then(res=>{
        const cp=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
        return res;
      }).catch(()=>caches.match(e.request).then(h=>h||caches.match("./index.html")))
    );
  } else {
    // 静态资源（css/js/字体/图标）：缓存优先，未命中则取网络并写入缓存
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res=>{
        const cp=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
        return res;
      }).catch(()=>hit))
    );
  }
});
