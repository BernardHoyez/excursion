/* brise-caches — cache des fichiers applicatifs statiques */
const CACHE_NAME = "excursion-brise-caches-v1";
const APP_SHELL = ["./","./index.html","./style.css","./app.js","./manifest.webmanifest","./icon192.png","./icon512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req=event.request;
  if(req.method!=="GET" || new URL(req.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(resp=>{
    if(resp.ok){const copy=resp.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy))}
    return resp;
  }).catch(()=>caches.match("./index.html"))));
});