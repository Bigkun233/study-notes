const CACHE = "study-notes-v1";
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
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res=>{
      const cp=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
      return res;
    }).catch(()=>caches.match("./index.html")))
  );
});
