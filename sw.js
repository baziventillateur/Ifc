const C='app-v2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  if(new URL(r.url).origin!==location.origin)return;
  // La page est toujours revérifiée auprès du serveur : une nouvelle version s'affiche dès sa publication.
  const req=r.mode==='navigate'?fetch(r.url,{cache:'no-cache',credentials:'same-origin'}):fetch(r);
  e.respondWith(req.then(res=>{
    if(r.mode==='navigate'&&res.ok){const c=res.clone();caches.open(C).then(k=>k.put('./',c));}
    return res;
  }).catch(()=>caches.match(r).then(m=>m||(r.mode==='navigate'?caches.match('./'):Response.error())))));
// Hors ligne, seule la navigation retombe sur la page en cache : la vérification des mises à jour
// ne doit pas lire l'ancienne page et conclure « à jour ».
});
