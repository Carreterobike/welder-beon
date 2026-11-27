// Welder BeOn: la app siempre se pide a internet primero (así llegan las actualizaciones);
// si no hay cobertura, abre la última versión guardada.
const APP='welder-app-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const url=new URL(r.url);if(url.origin!==location.origin)return;
  if(r.mode==='navigate'||/\/(index\.html)?$/.test(url.pathname)){
    if(url.searchParams.has('chk'))return;
    const k=url.pathname.replace(/index\.html$/,'');
    e.respondWith(fetch(r.url,{cache:'no-cache',credentials:'same-origin'}).then(x=>{if(x.ok){const cp=x.clone();caches.open(APP).then(c=>c.put(k,cp))}return x})
      .catch(()=>caches.open(APP).then(c=>c.match(k).then(m=>m||Response.error()))));
    return;
  }
  if(/\.(png|json)$/.test(url.pathname))
    e.respondWith(caches.open(APP).then(c=>fetch(r).then(x=>{if(x.ok)c.put(r,x.clone());return x}).catch(()=>c.match(r).then(m=>m||Response.error()))));
});
