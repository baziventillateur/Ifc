const C='app-v3';
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

// Notifications (Web Push) : nouvelle maquette, invité arrivé, message de l'administrateur.
// Si NexBim est déjà ouvert à l'écran, la notification reste discrète (pas de son ni vibration)
// et l'appli affiche le message elle-même.
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data&&e.data.text()};}
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    const vis=l.filter(c=>c.visibilityState==='visible');
    vis.forEach(c=>c.postMessage({nexbimNotif:true,titre:d.title||'',texte:d.body||''}));
    return self.registration.showNotification(d.title||'NexBim',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/badge-72.png',
      tag:d.tag||'nexbim',renotify:true,silent:vis.length>0,data:{url:d.url||'./'}});}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'./';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const c=l.find(x=>'focus' in x);
    if(!c)return self.clients.openWindow(url);
    if(url!=='./'&&'navigate' in c)return c.navigate(url).then(w=>(w||c).focus()).catch(()=>c.focus());
    return c.focus();}));});
