/* Excursion — aucun JavaScript n'est exécuté depuis les pages HTML importées. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const state = { waypoints: [], trace: [], mode:"production", selected:null, visitIndex:0, map:null, markerLayer:null, traceLayer:null, tileLayer:null, mbtiles:null, mbtilesDb:null, nextId:1, circuitName:"excursion", archiveFiles:[], editingFiles:{photos:[],videos:[],audios:[],html:[]}, pendingFiles:{photos:[],videos:[],audios:[],html:[]}, importArchive:null };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const basename = s => (s||"").split(/[\\/]/).pop();
function status(msg){$("status").textContent=msg}
function count(){ $("counts").textContent=`${state.waypoints.length} waypoint${state.waypoints.length>1?"s":""} · ${state.trace.length?state.trace.length+" point(s) de trace":"aucune trace"}` }
function initMap(){
 state.map=L.map("map",{preferCanvas:true}).setView([49.5,0.15],10);
 state.markerLayer=L.layerGroup().addTo(state.map);
 state.traceLayer=L.layerGroup().addTo(state.map);
 setBasemap("osm");
 state.map.on("click",e=>{if(state.mode==="production") createWaypoint(e.latlng.lat,e.latlng.lng)});
}
function setBasemap(kind){
 if(state.tileLayer){state.map.removeLayer(state.tileLayer);state.tileLayer=null}
 if(kind==="osm") state.tileLayer=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'});
 if(kind==="ign") state.tileLayer=L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",{maxZoom:19,attribution:'&copy; IGN — Plan IGN V2'});
 if(kind==="ortho") state.tileLayer=L.tileLayer("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",{maxZoom:19,attribution:'&copy; IGN — BD ORTHO'});
 if(kind==="mbtiles"){
   if(state.mbtilesDb) state.tileLayer=L.tileLayer(({x,y,z})=>`mbtile://${z}/${x}/${y}`,{maxZoom:19});
   else { status("Choisissez un fichier MBTiles. La lecture dépend de la disponibilité de sql.js et de ses fichiers WASM."); $("inputMbtiles").click(); return; }
 }
 if(state.tileLayer)state.tileLayer.addTo(state.map);
}
function tileToLayer(db){
 // MBTiles est une base SQLite. Les tuiles sont décodées depuis TMS et fournies sous forme d'URL blob.
 const layer=L.tileLayer("",{maxZoom:22,attribution:"Tuiles MBTiles locales",tileSize:256});
 layer.createTile=function(coords,done){
   const tile=document.createElement("img"); tile.alt="";
   try{
     const z=coords.z,x=coords.x,y=(1<<z)-1-coords.y;
     const stmt=db.prepare("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?");
     stmt.bind([z,x,y]);
     if(stmt.step()){const bytes=stmt.get()[0];const blob=new Blob([bytes],{type:"image/png"});tile.src=URL.createObjectURL(blob);tile.onload=()=>{URL.revokeObjectURL(tile.src);done(null,tile)};tile.onerror=e=>done(e,tile)}
     else {tile.style.opacity="0";setTimeout(()=>done(null,tile),0)}
     stmt.free();
   }catch(e){done(e,tile)}
   return tile;
 };
 return layer;
}
async function loadMbtiles(file){
 try{
   if(typeof initSqlJs!=="function")throw new Error("Bibliothèque SQLite indisponible (connexion nécessaire au premier chargement).");
   const SQL=await initSqlJs({locateFile:f=>"https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/"+f});
   const db=new SQL.Database(new Uint8Array(await file.arrayBuffer()));
   db.exec("SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles LIMIT 1");
   state.mbtilesDb=db; if(state.tileLayer)state.map.removeLayer(state.tileLayer);state.tileLayer=tileToLayer(db).addTo(state.map);
   $("basemap").value="mbtiles";status(`MBTiles chargé : ${file.name}`);
 }catch(e){status("Lecture MBTiles impossible : "+e.message)}
}
function makeMarker(w){
 const m=L.marker([w.lat,w.lon],{draggable:state.mode==="production",title:w.name||"Waypoint"}).addTo(state.markerLayer);
 m.on("click",()=>{state.mode==="production"?selectWaypoint(w.id):showVisit(w.id)});
 m.on("dragend",e=>{if(state.mode!=="production")return;const p=e.target.getLatLng();w.lat=p.lat;w.lon=p.lng;renderAll();selectWaypoint(w.id);status("Waypoint déplacé.")});
 w._marker=m;
}
function renderMap(){
 state.markerLayer.clearLayers();state.traceLayer.clearLayers();
 state.waypoints.forEach(makeMarker);
 if(state.trace.length){
   const latlngs=state.trace.map(p=>[p.lat,p.lon]);
   L.polyline(latlngs,{color:"#d14b2f",weight:4,opacity:.85}).addTo(state.traceLayer);
 }
 if(state.waypoints.length||state.trace.length){
   const pts=[...state.waypoints.map(w=>[w.lat,w.lon]),...state.trace.map(p=>[p.lat,p.lon])];
   if(pts.length===1)state.map.setView(pts[0],15);else state.map.fitBounds(L.latLngBounds(pts).pad(.08),{maxZoom:16});
 }
 count();
}
function renderLists(){
 const list=$("waypointList"),vlist=$("visitList");list.innerHTML="";vlist.innerHTML="";
 state.waypoints.forEach((w,i)=>{
   const li=document.createElement("li"),row=document.createElement("div");row.className="wp-row";
   const b=document.createElement("button");b.className="wp-select"+(state.selected===w.id?" active":"");b.textContent=`${i+1}. ${w.name||"Waypoint sans nom"}`;b.onclick=()=>selectWaypoint(w.id);
   const up=document.createElement("button");up.className="wp-mini";up.textContent="↑";up.title="Monter";up.disabled=i===0;up.onclick=()=>moveOrder(i,-1);
   const down=document.createElement("button");down.className="wp-mini";down.textContent="↓";down.title="Descendre";down.disabled=i===state.waypoints.length-1;down.onclick=()=>moveOrder(i,1);
   row.append(b,up,down);li.append(row);list.append(li);
   const vli=document.createElement("li"),vb=document.createElement("button");vb.className="wp-select"+(state.visitIndex===i?" active":"");vb.textContent=`${i+1}. ${w.name||"Waypoint sans nom"}`;vb.onclick=()=>showVisit(w.id);vli.append(vb);vlist.append(vli);
 });
}
function moveOrder(i,d){const j=i+d;if(j<0||j>=state.waypoints.length)return;[state.waypoints[i],state.waypoints[j]]=[state.waypoints[j],state.waypoints[i]];renderLists();status("Ordre des étapes modifié.")}
function createWaypoint(lat,lon){
 const w={id:String(state.nextId++),name:"Nouveau waypoint",description:"",lat,lon,photos:[],videos:[],audios:[],html:[],links:[]};
 state.waypoints.push(w);state.selected=w.id;renderAll();fillForm(w);status("Waypoint ajouté. Complétez sa fiche puis enregistrez-la.");
}
function selectWaypoint(id){const w=state.waypoints.find(x=>x.id===id);if(!w)return;state.selected=id;fillForm(w);renderLists();if(w._marker)state.map.panTo([w.lat,w.lon]);}
function fillForm(w){
 $("wpId").value=w.id;$("wpName").value=w.name||"";$("wpDescription").value=w.description||"";$("wpLat").value=w.lat;$("wpLon").value=w.lon;$("wpLinks").value=(w.links||[]).join("\n");
 state.editingFiles={photos:[...(w.photos||[])],videos:[...(w.videos||[])],audios:[...(w.audios||[])],html:[...(w.html||[])]};
 state.pendingFiles={photos:[],videos:[],audios:[],html:[]};
 ["wpPhotos","wpVideos","wpAudios","wpHtml"].forEach(id=>$(id).value="");
 renderFileQueues();
 $("deleteWaypoint").disabled=false;
}
function renderFileQueues(){
 const map={photos:"photoQueue",videos:"videoQueue",audios:"audioQueue",html:"htmlQueue"};
 for(const [k,id] of Object.entries(map)){
   const el=$(id);el.innerHTML="";
   const all=[...(state.editingFiles[k]||[]),...(state.pendingFiles[k]||[])];
   all.forEach((f,i)=>{const div=document.createElement("div");div.textContent=`${f.name||f.path||"fichier"}${i<(state.editingFiles[k]||[]).length?" (déjà associé)":" (à ajouter)"}`;el.append(div)});
 }
}
function safeHtml(input){
 // Les pages HTML importées sont neutralisées : suppression des scripts, gestionnaires d'événements et URL javascript.
 const doc=new DOMParser().parseFromString(input,"text/html");
 doc.querySelectorAll("script,iframe,object,embed,form").forEach(n=>n.remove());
 doc.querySelectorAll("*").forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||((a.name==="href"||a.name==="src")&&/^\s*javascript:/i.test(a.value)))n.removeAttribute(a.name)}));
 return "<!doctype html>\n"+doc.documentElement.outerHTML;
}
function filesFromInput(input,key){
 const files=[...input.files].map(file=>({name:file.name,mime:file.type||mimeFor(file.name),blob:file}));
 state.pendingFiles[key].push(...files);renderFileQueues();
}
function mimeFor(name){const ext=(name.split(".").pop()||"").toLowerCase();return ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",mp4:"video/mp4",webm:"video/webm",ogg:"audio/ogg",mp3:"audio/mpeg",wav:"audio/wav",htm:"text/html",html:"text/html"})[ext]||"application/octet-stream"}
$("wpPhotos").addEventListener("change",e=>filesFromInput(e.target,"photos"));
$("wpVideos").addEventListener("change",e=>filesFromInput(e.target,"videos"));
$("wpAudios").addEventListener("change",e=>filesFromInput(e.target,"audios"));
$("wpHtml").addEventListener("change",e=>filesFromInput(e.target,"html"));
$("waypointForm").addEventListener("submit",e=>{
 e.preventDefault();const w=state.waypoints.find(x=>x.id===$("wpId").value);if(!w)return;
 const lat=Number($("wpLat").value),lon=Number($("wpLon").value);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){status("Coordonnées invalides.");return}
 const desc=$("wpDescription").value;
 const assets=[...state.editingFiles.photos,...state.editingFiles.videos,...state.editingFiles.audios,...state.editingFiles.html,...Object.values(state.pendingFiles).flat()];
 if(!desc.trim()&&!assets.length&&!$("wpLinks").value.trim()){status("Chaque waypoint doit comporter un commentaire, un média ou un lien.");return}
 w.name=$("wpName").value.trim()||"Waypoint";w.description=desc;w.lat=lat;w.lon=lon;
 for(const k of ["photos","videos","audios","html"])w[k]=[...state.editingFiles[k],...state.pendingFiles[k]];
 w.links=$("wpLinks").value.split(/\r?\n/).map(s=>s.trim()).filter(s=>/^https?:\/\//i.test(s));
 state.pendingFiles={photos:[],videos:[],audios:[],html:[]};renderAll();selectWaypoint(w.id);status("Fiche enregistrée.");
});
$("deleteWaypoint").onclick=()=>{if(!state.selected)return;if(!confirm("Supprimer ce waypoint et ses associations de médias ?"))return;state.waypoints=state.waypoints.filter(w=>w.id!==state.selected);state.selected=null;clearForm();renderAll();status("Waypoint supprimé.")};
function clearForm(){$("waypointForm").reset();$("wpId").value="";$("photoQueue").innerHTML=$("videoQueue").innerHTML=$("audioQueue").innerHTML=$("htmlQueue").innerHTML="";state.editingFiles={photos:[],videos:[],audios:[],html:[]};state.pendingFiles={photos:[],videos:[],audios:[],html:[]}}
function renderAll(){renderMap();renderLists()}
$("addWaypoint").onclick=()=>{const c=state.map.getCenter();createWaypoint(c.lat,c.lng)};
$("newCircuit").onclick=()=>{if(!confirm("Créer un nouveau circuit ? Les modifications non exportées seront perdues."))return;state.waypoints=[];state.trace=[];state.archiveFiles=[];state.importArchive=null;state.circuitName="excursion";state.selected=null;clearForm();renderAll();status("Nouveau circuit prêt.")};
document.querySelectorAll('input[name="mode"]').forEach(el=>el.addEventListener("change",()=>{
 state.mode=el.value;const prod=state.mode==="production";$("productionPanel").hidden=!prod;$("visitPanel").hidden=prod;$("saveKmz").hidden=!prod;$("addWaypoint").hidden=!prod;
 $("mapHint").textContent=prod?"En Production : cliquez sur la carte pour ajouter un waypoint.":"En Visite : cliquez sur une épingle pour ouvrir sa fiche.";
 if(!prod&&state.waypoints.length)showVisit(state.waypoints[Math.min(state.visitIndex,state.waypoints.length-1)].id);
 renderMap();renderLists();
}));
$("basemap").addEventListener("change",e=>{if(e.target.value==="mbtiles"&&!state.mbtilesDb){$("inputMbtiles").click();return}setBasemap(e.target.value)});
$("inputMbtiles").addEventListener("change",e=>{const f=e.target.files[0];if(f)loadMbtiles(f)});
function parseCoords(text){return text.trim().split(/\s+/).map(pair=>{const a=pair.split(",");return {lon:Number(a[0]),lat:Number(a[1])}}).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))}
function parseKml(xml){
 const doc=new DOMParser().parseFromString(xml,"application/xml");if(doc.querySelector("parsererror"))throw new Error("KML mal formé.");
 const trace=[];
 doc.querySelectorAll("LineString coordinates,Track").forEach(el=>{if(el.tagName==="Track"){const pts=[...el.querySelectorAll("coord")].map(n=>{const a=n.textContent.trim().split(/\s+/);return {lon:+a[0],lat:+a[1]}});trace.push(...pts)}else trace.push(...parseCoords(el.textContent))});
 const wps=[];
 doc.querySelectorAll("Placemark").forEach(pm=>{
   if(pm.querySelector("Point coordinates")){
     const p=parseCoords(pm.querySelector("Point coordinates").textContent)[0];if(!p)return;
     const name=pm.querySelector("name")?.textContent||"Waypoint";
     const desc=pm.querySelector("description")?.textContent||"";
     wps.push({id:String(state.nextId++),name,description:desc,lat:p.lat,lon:p.lon,photos:[],videos:[],audios:[],html:[],links:[]});
   }
 });
 return {trace:trace.filter(p=>Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180),waypoints:wps};
}
function parseGpx(xml){
 const doc=new DOMParser().parseFromString(xml,"application/xml");if(doc.querySelector("parsererror"))throw new Error("GPX mal formé.");
 const trace=[...doc.querySelectorAll("trkpt,rtept")].map(n=>({lat:+n.getAttribute("lat"),lon:+n.getAttribute("lon")})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
 const wps=[...doc.querySelectorAll("wpt")].map(n=>({id:String(state.nextId++),name:n.querySelector("name")?.textContent||"Waypoint",description:n.querySelector("desc")?.textContent||n.querySelector("cmt")?.textContent||"",lat:+n.getAttribute("lat"),lon:+n.getAttribute("lon"),photos:[],videos:[],audios:[],html:[],links:[]})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
 return {trace,waypoints:wps};
}
function mediaPath(kind,name){const ext=(name.split(".").pop()||"bin").toLowerCase();return `${kind}/${String(Date.now()).slice(-6)}_${Math.random().toString(36).slice(2,7)}.${ext}`}
async function importCircuit(file){
 try{
  state.circuitName=file.name.replace(/\.(gpx|kml|kmz)$/i,"");state.archiveFiles=[];state.importArchive=null;
  if(/\.kmz$/i.test(file.name)){
    const zip=await JSZip.loadAsync(file);state.importArchive=zip;let kml=zip.file("doc.kml");if(!kml){const f=Object.values(zip.files).find(x=>!x.dir&&/\.kml$/i.test(x.name));if(f)kml=f}if(!kml)throw new Error("Aucun fichier KML trouvé dans le KMZ.");
    const parsed=parseKml(await kml.async("text"));state.trace=parsed.trace;state.waypoints=parsed.waypoints;
    const fileMap=Object.values(zip.files).filter(x=>!x.dir);
    for(const w of state.waypoints){
      // Associer les médias à partir des chemins référencés dans la description KML, ou du dossier par convention.
      const pm=[...new DOMParser().parseFromString(await kml.async("text"),"application/xml").querySelectorAll("Placemark")].find(p=>p.querySelector("name")?.textContent===(w.name||""));
      const desc=pm?.querySelector("description")?.textContent||"";
      const paths=[...desc.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m=>decodeURIComponent(m[1].split("#")[0]));
      for(const path of paths){const entry=zip.file(path)||zip.file(path.replace(/^\.\//,""));if(!entry)continue;const blob=await entry.async("blob"),f={name:basename(path),path,mime:mimeFor(path),blob};if(/^images\//i.test(path))w.photos.push(f);else if(/^videos\//i.test(path))w.videos.push(f);else if(/^audios\//i.test(path))w.audios.push(f);else if(/^html\//i.test(path))w.html.push(f)}
      w.links=[...desc.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m=>m[1]);
      w.description=desc.replace(/<img\b[^>]*>/gi,"[photo]").replace(/<video\b[\s\S]*?<\/video>/gi,"[vidéo]").replace(/<audio\b[\s\S]*?<\/audio>/gi,"[audio]");
    }
    // Récupérer les médias selon convention même si le KML ne les référence pas.
    for(const entry of fileMap)if(/^(images|videos|audios|html)\//i.test(entry.name))state.archiveFiles.push({path:entry.name,blob:await entry.async("blob"),mime:mimeFor(entry.name)});
  }else{
    const text=await file.text(),parsed=/\.gpx$/i.test(file.name)?parseGpx(text):parseKml(text);state.trace=parsed.trace;state.waypoints=parsed.waypoints;
  }
  state.selected=state.waypoints[0]?.id||null;renderAll();if(state.selected)selectWaypoint(state.selected);status(`Import terminé : ${state.waypoints.length} waypoint(s).`);
 }catch(e){console.error(e);status("Import impossible : "+e.message)}
}
$("inputCircuit").addEventListener("change",e=>{const f=e.target.files[0];if(f)importCircuit(f);e.target.value=""});
function htmlSafeDescription(s){return String(s||"").replace(/<script\b[\s\S]*?<\/script>/gi,"").replace(/\son\w+\s*=\s*(["']).*?\1/gi,"").replace(/javascript\s*:/gi,"")}
function assetMarkup(asset,kind){
 const url=asset.url||asset.blobUrl||"";
 if(kind==="photos")return `<div class="media-item"><img src="${url}" alt="${esc(asset.name)}"><a href="#" data-enlarge="${esc(url)}" data-name="${esc(asset.name)}">Agrandir</a></div>`;
 if(kind==="videos")return `<div class="media-item"><small>${esc(asset.name)}</small><video controls preload="metadata" src="${url}"></video></div>`;
 if(kind==="audios")return `<div class="media-item"><small>${esc(asset.name)}</small><audio controls preload="metadata" src="${url}"></audio></div>`;
 if(kind==="html")return `<div class="media-item"><a href="${url}" target="_blank" rel="noopener">Ouvrir la page : ${esc(asset.name)}</a></div>`;
 return "";
}
function objectUrlFor(asset){if(asset.url)return asset.url;if(asset.blob)return URL.createObjectURL(asset.blob);return ""}
function contentFor(w,small=false){
 let html=`<div class="${small?"popup-content":"visit-current"}"><h3>${esc(w.name||"Waypoint")}</h3>`;
 if(w.description)html+=`<div class="comment">${htmlSafeDescription(w.description)}</div>`;
 for(const kind of ["photos","videos","audios","html"])for(const a of (w[kind]||[])){
   a.url=objectUrlFor(a);
   if(small&&kind==="photos"){html+=`<div class="media-item"><img src="${a.url}" alt="${esc(a.name)}"><a href="#" data-enlarge="${a.url}" data-name="${esc(a.name)}">Agrandir</a></div>`}
   else if(small&&kind==="videos")html+=`<div class="media-item"><video controls preload="none" src="${a.url}"></video></div>`;
   else if(small&&kind==="audios")html+=`<div class="media-item"><audio controls preload="none" src="${a.url}"></audio></div>`;
   else if(small&&kind==="html")html+=`<a href="${a.url}" target="_blank" rel="noopener">${esc(a.name)}</a>`;
   else html+=assetMarkup(a,kind);
 }
 for(const link of (w.links||[]))html+=`<p><a href="${esc(link)}" target="_blank" rel="noopener">Ouvrir la page web ↗</a></p>`;
 html+=`<div class="popup-actions"><button type="button" data-go="${esc(w.id)}">Afficher l’étape</button></div></div>`;
 return html;
}
function showVisit(id){
 const idx=state.waypoints.findIndex(w=>w.id===id);if(idx<0)return;state.visitIndex=idx;
 const w=state.waypoints[idx];$("visitCurrent").innerHTML=contentFor(w,false);
 state.map.setView([w.lat,w.lon],Math.max(state.map.getZoom(),14));renderLists();
 bindMediaActions($("visitCurrent"));
}
function bindMediaActions(root){
 root.querySelectorAll("[data-enlarge]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const url=a.dataset.enlarge,name=a.dataset.name||"";$("modalBody").innerHTML=`<h3>${esc(name)}</h3><img src="${url}" alt="${esc(name)}">`;$("mediaModal").hidden=false}));
 root.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showVisit(b.dataset.go)));
}
$("prevWaypoint").onclick=()=>{if(!state.waypoints.length)return;state.visitIndex=(state.visitIndex-1+state.waypoints.length)%state.waypoints.length;showVisit(state.waypoints[state.visitIndex].id)};
$("nextWaypoint").onclick=()=>{if(!state.waypoints.length)return;state.visitIndex=(state.visitIndex+1)%state.waypoints.length;showVisit(state.waypoints[state.visitIndex].id)};
$("closeModal").onclick=()=>{$("mediaModal").hidden=true;$("modalBody").innerHTML=""};
$("mediaModal").addEventListener("click",e=>{if(e.target.dataset.close){$("mediaModal").hidden=true;$("modalBody").innerHTML=""}});
function kmlEscape(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
async function exportKmz(){
 try{
  if(typeof JSZip!=="function")throw new Error("Bibliothèque ZIP indisponible. Connectez-vous puis rechargez la page.");
  // Lire le contenu du formulaire courant avant l'export.
  if(state.selected && $("wpId").value===state.selected){$("waypointForm").requestSubmit();if($("status").textContent==="Fiche enregistrée."){}}
  if(!state.waypoints.length&&!state.trace.length)throw new Error("Le circuit est vide.");
  const zip=new JSZip(),mediaEntries=[],placemarks=[];
  const addAssets=async(w,kind,folder)=>{
    const out=[];
    for(let i=0;i<(w[kind]||[]).length;i++){
      const a=w[kind][i];let blob=a.blob;
      if(!blob&&a.path&&state.importArchive){const f=state.importArchive.file(a.path);if(f)blob=await f.async("blob")}
      if(!blob)continue;
      const path=mediaPath(folder,a.name||`${kind}${i+1}.bin`);zip.file(path,blob);out.push({name:a.name||basename(path),path,kind});
    }
    return out;
  };
  for(let i=0;i<state.waypoints.length;i++){
    const w=state.waypoints[i];const photos=await addAssets(w,"photos","images"),videos=await addAssets(w,"videos","videos"),audios=await addAssets(w,"audios","audios"),htmls=await addAssets(w,"html","html");
    let desc=`<div>${htmlSafeDescription(w.description||"")}</div>`;
    for(const a of photos)desc+=`<p><a href="${kmlEscape(a.path)}">${kmlEscape(a.name)}</a></p><img src="${kmlEscape(a.path)}" alt="${kmlEscape(a.name)}" style="max-width:100%">`;
    for(const a of videos)desc+=`<p><video controls width="320"><source src="${kmlEscape(a.path)}" type="${mimeFor(a.path)}"></video></p>`;
    for(const a of audios)desc+=`<p><audio controls><source src="${kmlEscape(a.path)}" type="${mimeFor(a.path)}"></audio></p>`;
    for(const a of htmls)desc+=`<p><a href="${kmlEscape(a.path)}">${kmlEscape(a.name)}</a></p>`;
    for(const link of (w.links||[]))desc+=`<p><a href="${kmlEscape(link)}">${kmlEscape(link)}</a></p>`;
    placemarks.push(`<Placemark><name>${kmlEscape(`${i+1}. ${w.name||"Waypoint"}`)}</name><description><![CDATA[${desc.replace(/\]\]>/g,"]]]]><![CDATA[>")}]]></description><Point><coordinates>${w.lon},${w.lat},0</coordinates></Point><ExtendedData><Data name="excursion_order"><value>${i+1}</value></Data></ExtendedData></Placemark>`);
  }
  let line="";if(state.trace.length)line=`<Placemark><name>Trace</name><Style><LineStyle><color>ff2f4bd1</color><width>4</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${state.trace.map(p=>`${p.lon},${p.lat},0`).join(" ")}</coordinates></LineString></Placemark>`;
  // Conserver aussi les médias présents dans l'archive source et non référencés dans les waypoints.
  if(state.archiveFiles.length){for(const a of state.archiveFiles){if(!zip.file(a.path))zip.file(a.path,a.blob)}}
  const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${kmlEscape(state.circuitName||"excursion")}</name>${line}${placemarks.join("")}</Document></kml>`;
  zip.file("doc.kml",kml);
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:4}});
  const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(state.circuitName||"excursion").replace(/[^\w\-À-ÿ]+/g,"_")+".kmz";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status(`KMZ exporté (${(blob.size/1024/1024).toFixed(1)} Mo).`);
 }catch(e){console.error(e);status("Export impossible : "+e.message)}
}
$("saveKmz").onclick=exportKmz;
function registerSW(){if("serviceWorker" in navigator && location.protocol!=="file:")navigator.serviceWorker.register("./sw.js").catch(e=>console.warn("Service worker",e))}
function boot(){initMap();renderAll();registerSW();if(location.protocol==="file:")status("Mode fichier local : la carte et les bibliothèques nécessitent une connexion. Déployez sur GitHub Pages pour installer la PWA.");}
boot();
})();