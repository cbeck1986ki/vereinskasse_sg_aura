"use strict";
/* Vereinskasse – GitHub Pages + Firebase (Login + gemeinsame Daten, offlinefähig) */

const CATS = ["Essen","Getränke","Sonstiges"];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const eur = c => (c/100).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}) : "–";
function parseEur(s){ s=String(s||"").trim().replace(/\s|€/g,""); if(!s) return null; if(s.includes(",")) s=s.replace(/\./g,"").replace(",","."); const v=parseFloat(s); return isNaN(v)?null:Math.round(v*100); }
const fmtIn = c => c==null ? "" : (c/100).toFixed(2).replace(".",",");
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,10);
function slug(ev){ return "e_" + (ev.replace(/[^A-Za-z0-9_\-.~:@+]/g,"_").slice(0,150) || "x"); }

/* ---------- Zustand (Spiegel der Online-Daten) ---------- */
const store = { products: [], event: "", club: "", cash: {} };
const salesByEvent = {};   // eventName -> [sales] (laufendes Spiel live, Archiv bei Bedarf geladen)
const loading = new Set();
const ui = { cart:{}, given:null, viewEvent:null, lastBooking:null, confirmDel:null, confirmReset:false, archConfirm:null, pending:0 };
let app, auth, db, user = null, unsubs = [], unsubSales = null, currentListenEvent = null;

const curEvent = () => store.event || "Ohne Spielname";
const cashOf = ev => store.cash[ev] || {start:null, counted:null};
function salesOf(ev){
  if(!salesByEvent[ev]){ loadEvent(ev); return []; }
  return salesByEvent[ev];
}

/* ---------- Firebase Start ---------- */
const cfg = window.FIREBASE_CONFIG || {};
function setupError(html){
  $("gateMsg").innerHTML = html;
  $("loginForm").querySelectorAll("input,button").forEach(el=>el.disabled=true);
}
if(!window.FB){
  setupError("<strong>Die Datei <code>firebase.bundle.js</code> fehlt oder wurde nicht geladen.</strong> Bitte prüfen, ob sie im GitHub-Repository liegt.");
} else if(!window.FIREBASE_CONFIG){
  setupError("<strong>Die Datei <code>firebase-config.js</code> ist fehlerhaft oder fehlt.</strong> Oft ist beim Einfügen die erste Zeile kaputtgegangen. Sie muss mit <code>window.FIREBASE_CONFIG = {</code> beginnen.");
} else if(!cfg.apiKey || String(cfg.apiKey).includes("HIER_EINTRAGEN")){
  setupError("<strong>Noch nicht eingerichtet.</strong> In der Datei <code>firebase-config.js</code> fehlen die Firebase-Zugangsdaten. Siehe Anleitung (EINRICHTUNG.md).");
} else {
  try{
    app = FB.initializeApp(cfg);
    auth = FB.getAuth(app);
    try{
      db = FB.initializeFirestore(app, { localCache: FB.persistentLocalCache({ tabManager: FB.persistentMultipleTabManager() }) });
    }catch(e){
      db = FB.initializeFirestore(app, {});
    }
    FB.onAuthStateChanged(auth, u => { user = u; u ? startSession() : endSession(); });
  }catch(e){
    setupError("<strong>Firebase konnte nicht gestartet werden.</strong> Bitte die Werte in <code>firebase-config.js</code> prüfen.<br><small>" + esc(e && (e.code || e.message) || e) + "</small>");
  }
}

/* ---------- Login ---------- */
const authMsg = code => ({
  "auth/invalid-credential":"E-Mail oder Passwort falsch.",
  "auth/wrong-password":"E-Mail oder Passwort falsch.",
  "auth/user-not-found":"E-Mail oder Passwort falsch.",
  "auth/invalid-email":"Bitte eine gültige E-Mail-Adresse eingeben.",
  "auth/too-many-requests":"Zu viele Versuche. Bitte kurz warten.",
  "auth/network-request-failed":"Keine Internetverbindung. Für die erste Anmeldung wird Internet gebraucht.",
  "auth/user-disabled":"Dieses Konto ist gesperrt.",
  "auth/unauthorized-domain":"Diese Internetadresse ist in Firebase nicht freigegeben. In Firebase unter Authentication → Einstellungen → Autorisierte Domains „cbeck1986ki.github.io“ eintragen.",
  "auth/operation-not-allowed":"Anmeldung per E-Mail/Passwort ist in Firebase noch nicht aktiviert (Authentication → Anmeldemethode).",
  "auth/invalid-api-key":"Der apiKey in firebase-config.js stimmt nicht.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.":"Der apiKey in firebase-config.js stimmt nicht."
}[code] || ("Anmeldung fehlgeschlagen" + (code ? " (" + code + ")." : ".")));
$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const err = $("lgErr"); err.hidden = true; $("lgBtn").disabled = true;
  try{ await FB.signInWithEmailAndPassword(auth, $("lgEmail").value.trim(), $("lgPass").value); $("lgPass").value=""; }
  catch(x){ err.textContent = authMsg(x.code); err.hidden = false; }
  $("lgBtn").disabled = false;
});
$("lgForgot").addEventListener("click", async ()=>{
  const email = $("lgEmail").value.trim(), err = $("lgErr");
  if(!email){ err.textContent = "Bitte zuerst die E-Mail-Adresse eintragen."; err.hidden=false; return; }
  try{ await FB.sendPasswordResetEmail(auth, email); err.textContent = "Falls das Konto existiert, kommt gleich eine E-Mail zum Zurücksetzen."; err.hidden=false; }
  catch(x){ err.textContent = authMsg(x.code); err.hidden=false; }
});
$("logoutBtn").addEventListener("click", ()=>{
  if(ui.pending>0 && !navigator.onLine){ showToast("Erst abmelden, wenn alle Buchungen übertragen sind (Internet nötig).", false); return; }
  FB.signOut(auth);
});

function permissionProblem(e){
  if(e && e.code==="permission-denied"){
    FB.signOut(auth);
    $("lgErr").textContent = "Dieses Konto ist nicht für die Kasse freigeschaltet. Bitte beim Kassenwart melden.";
    $("lgErr").hidden = false;
    return true;
  }
  return false;
}

function startSession(){
  $("gate").hidden = true;
  $("whoami").textContent = user.email || "–";
  unsubs.forEach(u=>u()); unsubs = [];
  unsubs.push(FB.onSnapshot(FB.doc(db,"config","products"), s=>{
    const d = s.exists() ? s.data() : null;
    store.products = d && Array.isArray(d.list) ? d.list : [];
    renderKasse();
  }, permissionProblem));
  unsubs.push(FB.onSnapshot(FB.doc(db,"config","settings"), s=>{
    const d = s.exists() ? s.data() : {};
    store.club = d.club || "";
    if(document.activeElement!==$("clubName")) $("clubName").value = store.club;
    const ev = d.event || "";
    if(ev!==store.event || !unsubSales){ store.event = ev; if(ui.viewEvent===curEvent()) ui.viewEvent=null; listenCurrent(); }
    renderKasse(); renderOverview();
  }, permissionProblem));
  unsubs.push(FB.onSnapshot(FB.collection(db,"cash"), snap=>{
    const m = {};
    snap.docs.forEach(d=>{ const x=d.data(); if(x && typeof x.event==="string") m[x.event] = {start:x.start??null, counted:x.counted??null, created:x.created||null}; });
    for(const ev of Object.keys(cashTimers)) if(store.cash[ev]) m[ev] = store.cash[ev];
    store.cash = m; renderOverview(); if(!$("tab-archiv").hidden) renderArchive();
  }, permissionProblem));
}
function endSession(){
  unsubs.forEach(u=>u()); unsubs=[]; if(unsubSales){ unsubSales(); unsubSales=null; }
  Object.keys(salesByEvent).forEach(k=>delete salesByEvent[k]);
  store.products=[]; store.cash={}; store.event=""; ui.cart={};
  $("gate").hidden = false;
}

/* ---------- Buchungen lesen ---------- */
function listenCurrent(){
  const ev = curEvent();
  if(unsubSales && currentListenEvent===ev) return;
  if(unsubSales) unsubSales();
  currentListenEvent = ev;
  unsubSales = FB.onSnapshot(FB.query(FB.collection(db,"sales"), FB.where("event","==",ev)), {includeMetadataChanges:true}, snap=>{
    salesByEvent[ev] = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>b.ts.localeCompare(a.ts));
    ui.pending = snap.docs.filter(d=>d.metadata.hasPendingWrites).length;
    renderSync(); renderOverview(); if(!$("tab-archiv").hidden) renderArchive();
  }, permissionProblem);
}
async function loadEvent(ev, force){
  if(ev===currentListenEvent && !force) return;
  if(loading.has(ev)) return;
  loading.add(ev);
  try{
    const snap = await FB.getDocs(FB.query(FB.collection(db,"sales"), FB.where("event","==",ev)));
    salesByEvent[ev] = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>b.ts.localeCompare(a.ts));
  }catch(e){ if(!permissionProblem(e)) showToast("Archiv konnte nicht geladen werden.", false); salesByEvent[ev] = salesByEvent[ev] || []; }
  loading.delete(ev);
  renderOverview(); if(!$("tab-archiv").hidden) renderArchive();
}

/* ---------- Schreiben (offline wird gepuffert) ---------- */
function write(promise, failMsg){
  promise.catch(e=>{ if(!permissionProblem(e)) showToast(failMsg || "Speichern fehlgeschlagen.", false); });
}
async function deleteEventSales(ev){
  const snap = await FB.getDocs(FB.query(FB.collection(db,"sales"), FB.where("event","==",ev)));
  const docs = snap.docs;
  for(let i=0;i<docs.length;i+=400){
    const b = FB.writeBatch(db);
    docs.slice(i,i+400).forEach(d=>b.delete(d.ref));
    await b.commit();
  }
  if(ev!==currentListenEvent) salesByEvent[ev] = [];
  return docs.length;
}
const cashTimers = {};
function setCash(ev, field, cents){
  store.cash[ev] = {...cashOf(ev), [field]: cents};
  clearTimeout(cashTimers[ev]);
  cashTimers[ev] = setTimeout(()=>{ saveCash(ev); delete cashTimers[ev]; }, 600);
}
function saveCash(ev){
  const c = cashOf(ev);
  write(FB.setDoc(FB.doc(db,"cash",slug(ev)), {event:ev, start:c.start??null, counted:c.counted??null, created:c.created||new Date().toISOString()}), "Kassenbestand nicht gespeichert.");
}
function saveSettings(){ write(FB.setDoc(FB.doc(db,"config","settings"), {event:store.event, club:store.club})); }

/* ---------- Online-Status ---------- */
function renderSync(){
  const el = $("sync");
  if(!navigator.onLine){ el.hidden=false; el.className="sync off"; el.textContent = ui.pending ? `Offline · ${ui.pending} warten` : "Offline"; }
  else if(ui.pending){ el.hidden=false; el.className="sync"; el.textContent = `Überträgt ${ui.pending} …`; }
  else el.hidden = true;
}
window.addEventListener("online", renderSync); window.addEventListener("offline", renderSync);

/* ---------- Kasse ---------- */
function renderProducts(){
  let html = "";
  for(const cat of CATS){
    const ps = store.products.filter(p=>p.cat===cat);
    if(!ps.length) continue;
    html += `<div class="catlabel">${cat}</div><div class="grid">`;
    for(const p of ps){
      const q = ui.cart[p.id]||0;
      html += `<button class="prod" data-cat="${esc(p.cat)}" data-id="${esc(p.id)}">${q?`<span class="badge num">${q}</span>`:""}<span class="n">${esc(p.name)}</span><span class="p num">${eur(p.price)}</span></button>`;
    }
    html += `</div>`;
  }
  $("products").innerHTML = html || `<p class="hint">Noch keine Artikel. Unter „Einstell.“ anlegen.</p>`;
}
function cartTotal(){ let t=0; for(const [id,q] of Object.entries(ui.cart)){ const p=store.products.find(x=>x.id===id); if(p) t+=p.price*q; } return t; }
function renderCart(){
  for(const id of Object.keys(ui.cart)) if(!store.products.find(p=>p.id===id)) delete ui.cart[id];
  const entries = Object.entries(ui.cart).filter(([,q])=>q>0);
  $("lines").innerHTML = !entries.length ? `<div class="empty">Artikel antippen, um sie hinzuzufügen.</div>` : entries.map(([id,q])=>{
    const p = store.products.find(x=>x.id===id);
    return `<div class="line"><div><div class="nm">${esc(p.name)}</div><div class="sub num">${q} × ${eur(p.price)}</div></div>
      <div class="qty"><button data-dec="${esc(id)}" aria-label="${esc(p.name)} weniger">−</button><span class="num">${q}</span><button data-inc="${esc(id)}" aria-label="${esc(p.name)} mehr">+</button></div>
      <div class="sum num">${eur(p.price*q)}</div></div>`;
  }).join("");
  const t = cartTotal(), n = entries.reduce((s,[,q])=>s+q,0);
  $("total").textContent = eur(t);
  $("cnt").textContent = n ? ` · ${n} Art.` : "";
  $("bookBtn").disabled = !entries.length;
  const opts = [];
  if(t>0){ const r = Math.ceil(t/100)*100; if(r!==t) opts.push(r); [500,1000,2000,5000].forEach(v=>{ if(v>=t && !opts.includes(v)) opts.push(v); }); }
  $("givenRow").innerHTML = t>0 ? `<button data-given="${t}" aria-pressed="${ui.given===t}">Passend</button>` + opts.slice(0,4).map(v=>`<button data-given="${v}" aria-pressed="${ui.given===v}" class="num">${(v/100).toLocaleString("de-DE")} €</button>`).join("") : "";
  const ch = $("change");
  if(ui.given!=null && t>0){
    const diff = ui.given - t;
    ch.hidden = false; ch.classList.toggle("short", diff<0);
    ch.innerHTML = diff>=0 ? `<span>Gegeben ${eur(ui.given)}</span><span>Rückgeld ${eur(diff)}</span>` : `<span>Gegeben ${eur(ui.given)}</span><span>Fehlt ${eur(-diff)}</span>`;
  } else ch.hidden = true;
}
function renderKasse(){ renderProducts(); renderCart(); renderHeader(); }

$("products").addEventListener("click", e=>{
  const b = e.target.closest(".prod"); if(!b) return;
  ui.cart[b.dataset.id]=(ui.cart[b.dataset.id]||0)+1; ui.given=null; renderProducts(); renderCart();
  if(navigator.vibrate) try{ navigator.vibrate(10); }catch(_){}
});
$("lines").addEventListener("click", e=>{
  const inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
  if(inc){ ui.cart[inc.dataset.inc]++; }
  if(dec){ const id=dec.dataset.dec; ui.cart[id]--; if(ui.cart[id]<=0) delete ui.cart[id]; }
  ui.given=null; renderProducts(); renderCart();
});
$("givenRow").addEventListener("click", e=>{
  const b = e.target.closest("[data-given]"); if(!b) return;
  const v = +b.dataset.given; ui.given = ui.given===v ? null : v; renderCart();
});
$("cartToggle").addEventListener("click", ()=>{
  const open = $("cart").classList.toggle("open");
  $("cartToggle").setAttribute("aria-expanded", open);
  $("cartToggle").textContent = open ? "Zuklappen ▼" : "Details ▲";
});
$("clearBtn").addEventListener("click", ()=>{ ui.cart={}; ui.given=null; renderProducts(); renderCart(); });
$("bookBtn").addEventListener("click", ()=>{
  const items = Object.entries(ui.cart).filter(([,q])=>q>0).map(([id,q])=>{
    const p = store.products.find(x=>x.id===id); return {id, name:p.name, price:p.price, qty:q, cat:p.cat};
  });
  if(!items.length) return;
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);
  const id = newId();
  const sale = {event: curEvent(), ts: new Date().toISOString(), items, total, by: user && user.email || ""};
  write(FB.setDoc(FB.doc(db,"sales",id), sale), "Buchung konnte nicht gespeichert werden!");
  ui.cart={}; ui.given=null; ui.lastBooking = id;
  $("cart").classList.remove("open"); $("cartToggle").textContent = "Details ▲";
  renderProducts(); renderCart();
  showToast(`Gebucht · ${eur(total)}`, true);
});

let toastTimer=null;
function showToast(msg, undo){
  $("toastMsg").textContent = msg; $("toastUndo").hidden = !undo; $("toast").hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$("toast").hidden=true; ui.lastBooking=null;}, undo?6000:4000);
}
$("toastUndo").addEventListener("click", ()=>{
  if(!ui.lastBooking) return;
  deleteSale(ui.lastBooking); ui.lastBooking=null;
  showToast("Letzte Buchung storniert", false);
});
function deleteSale(id){
  write(FB.deleteDoc(FB.doc(db,"sales",id)), "Storno fehlgeschlagen.");
  for(const ev of Object.keys(salesByEvent)) if(ev!==currentListenEvent) salesByEvent[ev] = salesByEvent[ev].filter(s=>s.id!==id);
  renderOverview();
}

/* ---------- Übersicht ---------- */
const viewName = () => ui.viewEvent || curEvent();
const selectedSales = () => salesOf(viewName());
function aggregate(sales){
  const map = new Map();
  for(const s of sales) for(const i of s.items){
    const key = i.name+"|"+i.price;
    const r = map.get(key) || {name:i.name, price:i.price, cat:i.cat, qty:0, sum:0};
    r.qty+=i.qty; r.sum+=i.qty*i.price; map.set(key,r);
  }
  const order = n => { const idx = store.products.findIndex(p=>p.name===n); return idx<0?999:idx; };
  return [...map.values()].sort((a,b)=>order(a.name)-order(b.name) || a.name.localeCompare(b.name));
}
function cashFigures(sales){
  const ev = viewName(), c = cashOf(ev);
  const umsatz = sales.reduce((s,x)=>s+x.total,0);
  const soll = (c.start||0) + umsatz;
  const diff = c.counted==null ? null : c.counted - soll;
  return {ev, start:c.start, umsatz, soll, counted:c.counted, diff};
}
function knownEvents(){ const set = new Set(Object.keys(store.cash)); set.add(curEvent()); return [...set]; }
function renderHeader(){
  $("eventLabel").textContent = curEvent(); $("eventLabel").title = curEvent();
  const hs = $("startCash");
  if(document.activeElement!==hs) hs.value = fmtIn(cashOf(curEvent()).start);
}
function renderOverview(){
  renderHeader();
  const cur = curEvent();
  const others = knownEvents().filter(e=>e!==cur).sort((a,b)=>(cashOf(b).created||"").localeCompare(cashOf(a).created||""));
  const sel = $("filterEvent");
  sel.innerHTML = [`<option value="">Laufendes Spiel: ${esc(cur)}</option>`].concat(others.map(e=>`<option value="${esc(e)}">Archiv: ${esc(e)}</option>`)).join("");
  sel.value = ui.viewEvent || "";
  $("archPill").hidden = !ui.viewEvent;
  if($("tab-uebersicht").hidden) return;

  const isLoading = !salesByEvent[viewName()];
  const sales = selectedSales();
  const rows = aggregate(sales);
  const total = sales.reduce((s,x)=>s+x.total,0);
  $("kUmsatz").textContent = eur(total);
  $("kBuch").textContent = sales.length;
  $("kStk").textContent = rows.filter(r=>r.price>0).reduce((s,r)=>s+r.qty,0);
  $("kAvg").textContent = eur(sales.length ? Math.round(total/sales.length) : 0);
  $("sumBody").innerHTML = isLoading ? `<tr><td colspan="4" class="empty">Lade Buchungen …</td></tr>` : rows.length ? rows.map(r=>`<tr><td><span class="dot ${esc(r.cat||"Sonstiges")}"></span>${esc(r.name)}</td><td class="r num">${r.qty}</td><td class="r num">${eur(r.price)}</td><td class="r num">${eur(r.sum)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">Noch keine Buchungen für dieses Spiel.</td></tr>`;
  $("fStk").textContent = rows.reduce((s,r)=>s+r.qty,0);
  $("fSum").textContent = eur(total);

  const cf = cashFigures(sales);
  const sIn = $("cStartIn"), iIn = $("cIstIn");
  if(document.activeElement!==sIn) sIn.value = fmtIn(cf.start);
  if(document.activeElement!==iIn) iIn.value = fmtIn(cf.counted);
  $("cUmsatz").textContent = eur(cf.umsatz);
  $("cSoll").textContent = eur(cf.soll);
  const d = $("cDiff"); d.className = "";
  if(cf.diff==null) d.textContent = "–";
  else { d.textContent = (cf.diff>0?"+":"") + eur(cf.diff) + (cf.diff===0?" · stimmt":""); d.className = cf.diff===0?"ok":"bad"; }

  $("log").innerHTML = sales.length ? sales.slice(0,30).map(s=>{
    const t = new Date(s.ts).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
    const items = s.items.map(i=>`${i.qty}× ${esc(i.name)}`).join(", ");
    const ctl = ui.confirmDel===s.id
      ? `<span class="confirm"><button class="btn danger small" data-dodel="${esc(s.id)}">Stornieren</button><button class="btn ghost small" data-nodel>Nein</button></span>`
      : `<button class="x" data-del="${esc(s.id)}">Storno</button>`;
    return `<div class="it"><span class="t num">${t}</span><span class="items">${items}</span><strong class="num">${eur(s.total)}</strong>${ctl}</div>`;
  }).join("") : `<div class="empty">${isLoading?"Lade …":"Keine Buchungen."}</div>`;

  $("resetBar").innerHTML = !sales.length ? "" : ui.confirmReset
    ? `<span class="err">Alle ${sales.length} Buchungen von „${esc(viewName())}“ endgültig löschen? Artikel und Preise bleiben.</span>
       <button class="btn danger small" id="resetYes">Ja, Umsätze löschen</button><button class="btn ghost small" id="resetNo">Abbrechen</button>`
    : `<button class="btn ghost small" id="resetAsk" style="color:var(--danger)">Umsätze dieses Spiels zurücksetzen</button>`;
}
$("filterEvent").addEventListener("change", e=>openEvent(e.target.value || null));
function openEvent(ev){
  ui.viewEvent = (ev && ev!==curEvent()) ? ev : null;
  if(ui.viewEvent) loadEvent(ui.viewEvent, true);
  ui.confirmReset=false; ui.confirmDel=null; renderOverview();
}
$("log").addEventListener("click", e=>{
  const d=e.target.closest("[data-del]"), y=e.target.closest("[data-dodel]"), n=e.target.closest("[data-nodel]");
  if(d) ui.confirmDel=d.dataset.del;
  if(n) ui.confirmDel=null;
  if(y){ ui.confirmDel=null; deleteSale(y.dataset.dodel); }
  renderOverview();
});
$("resetBar").addEventListener("click", async e=>{
  if(e.target.id==="resetAsk") ui.confirmReset=true;
  if(e.target.id==="resetNo") ui.confirmReset=false;
  if(e.target.id==="resetYes"){
    const ev = viewName(); ui.confirmReset=false;
    $("resetBar").innerHTML = `<span class="status">Lösche Buchungen …</span>`;
    try{ await deleteEventSales(ev); setCash(ev, "counted", null); showToast(`Umsätze von „${ev}“ zurückgesetzt`, false); }
    catch(x){ if(!permissionProblem(x)) showToast("Zurücksetzen fehlgeschlagen. Internet prüfen und nochmal versuchen.", false); }
  }
  renderOverview();
});

/* ---------- Kassenbestand ---------- */
$("startCash").addEventListener("input", e=>{ setCash(curEvent(), "start", parseEur(e.target.value)); renderOverview(); });
$("startCash").addEventListener("blur", e=>{ e.target.value = fmtIn(cashOf(curEvent()).start); });
$("cStartIn").addEventListener("input", e=>{ setCash(viewName(),"start",parseEur(e.target.value)); renderOverview(); });
$("cIstIn").addEventListener("input", e=>{ setCash(viewName(),"counted",parseEur(e.target.value)); renderOverview(); });
["cStartIn","cIstIn"].forEach(id=>$(id).addEventListener("blur", renderOverview));

/* ---------- Neues Spiel ---------- */
$("newEventBtn").addEventListener("click", ()=>{
  const f = $("newEventForm");
  if(!f.hidden){ f.hidden = true; return; }
  $("nfOld").textContent = curEvent();
  $("nfName").value = "";
  $("nfStart").value = fmtIn(cashOf(curEvent()).start);
  $("nfErr").hidden = true;
  f.hidden = false; $("nfName").focus();
});
$("nfCancel").addEventListener("click", ()=>{ $("newEventForm").hidden = true; });
$("newEventForm").addEventListener("submit", e=>{
  e.preventDefault();
  const name = $("nfName").value.trim().replace(/\s+/g," ");
  const err = msg => { $("nfErr").textContent = msg; $("nfErr").hidden = false; };
  if(!name) return err("Bitte einen Namen für das Spiel eingeben.");
  if(knownEvents().includes(name)) return err("Ein Spiel mit diesem Namen gibt es schon. Bitte z. B. das Datum ergänzen.");
  const old = curEvent();
  if(!store.cash[old]){ store.cash[old] = {start:null, counted:null, created:new Date(Date.now()-1000).toISOString()}; saveCash(old); }
  store.cash[name] = {start: parseEur($("nfStart").value), counted:null, created:new Date().toISOString()};
  saveCash(name);
  store.event = name; saveSettings(); listenCurrent();
  ui.cart = {}; ui.given=null; ui.viewEvent = null;
  $("newEventForm").hidden = true;
  renderKasse(); renderOverview();
  showToast(`„${name}“ gestartet. „${old}“ liegt im Archiv.`, false);
});

/* ---------- Archiv ---------- */
function renderArchive(){
  const cur = curEvent();
  const evs = knownEvents().sort((a,b)=>{
    if(a===cur) return -1; if(b===cur) return 1;
    return (cashOf(b).created||"").localeCompare(cashOf(a).created||"");
  });
  $("archBody").innerHTML = evs.map(ev=>{
    const s = salesOf(ev), loaded = !!salesByEvent[ev];
    const total = s.reduce((a,x)=>a+x.total,0);
    const first = s.length ? s[s.length-1].ts : null;
    const c = cashOf(ev), live = ev===cur;
    let kasse = "–";
    if(loaded && c.counted!=null){ const diff = c.counted - ((c.start||0)+total); kasse = diff===0 ? `<span class="ok">stimmt</span>` : `<span class="bad">${diff>0?"+":""}${eur(diff)}</span>`; }
    else if(c.start!=null) kasse = `<span class="status">nicht gezählt</span>`;
    const acts = ui.archConfirm===ev
      ? `<span class="err" style="font-size:13px">Spiel samt ${s.length} Buchungen löschen?</span><button class="btn danger small" data-archdel="${esc(ev)}">Löschen</button><button class="btn ghost small" data-archno>Nein</button>`
      : `<button class="btn ghost small" data-open="${esc(ev)}">Anzeigen</button>` +
        (live ? "" : `<button class="btn ghost small" data-activate="${esc(ev)}">Fortsetzen</button><button class="x" data-archask="${esc(ev)}">Löschen</button>`);
    return `<tr><td><strong>${esc(ev)}</strong> ${live?'<span class="pill live">läuft</span>':""}</td>
      <td class="num">${fmtDate(first || c.created)}</td><td class="r num">${loaded?s.length:"…"}</td><td class="r num">${loaded?eur(total):"…"}</td>
      <td class="r num">${kasse}</td><td><div class="acts">${acts}</div></td></tr>`;
  }).join("");
}
$("archBody").addEventListener("click", async e=>{
  const o=e.target.closest("[data-open]"), a=e.target.closest("[data-activate]"), ask=e.target.closest("[data-archask]"),
        no=e.target.closest("[data-archno]"), del=e.target.closest("[data-archdel]");
  if(o){ switchTab("uebersicht"); openEvent(o.dataset.open); return; }
  if(a){
    const ev = a.dataset.activate, old = curEvent();
    if(!store.cash[old]){ store.cash[old] = {start:null, counted:null, created:new Date().toISOString()}; saveCash(old); }
    store.event = ev; saveSettings(); listenCurrent(); ui.viewEvent=null; ui.cart={}; renderKasse();
    showToast(`„${ev}“ läuft wieder`, false);
  }
  if(ask) ui.archConfirm = ask.dataset.archask;
  if(no) ui.archConfirm = null;
  if(del){
    const ev = del.dataset.archdel; ui.archConfirm=null;
    del.closest(".acts").innerHTML = `<span class="status">Lösche …</span>`;
    try{
      await deleteEventSales(ev);
      await FB.deleteDoc(FB.doc(db,"cash",slug(ev)));
      delete store.cash[ev]; delete salesByEvent[ev];
      if(ui.viewEvent===ev) ui.viewEvent=null;
      showToast(`„${ev}“ gelöscht`, false);
    }catch(x){ if(!permissionProblem(x)) showToast("Löschen fehlgeschlagen. Internet prüfen.", false); }
  }
  renderArchive();
});

/* ---------- Dateien speichern / teilen ---------- */
async function saveFile(blob, filename){
  try{
    const file = new File([blob], filename, {type: blob.type});
    if(navigator.canShare && navigator.canShare({files:[file]}) && matchMedia("(pointer:coarse)").matches){
      await navigator.share({files:[file], title: filename});
      return;
    }
  }catch(e){ if(e && e.name==="AbortError") return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 10000);
}
const fileBase = () => viewName().replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g,"_").slice(0,60);

function summaryText(){
  const sales = selectedSales(), rows = aggregate(sales), cf = cashFigures(sales);
  return [`Abrechnung: ${viewName()}`, `Stand: ${new Date().toLocaleString("de-DE")}`, "",
    ...rows.map(r=>`${String(r.qty).padStart(4)} × ${r.name} (${eur(r.price)}) = ${eur(r.sum)}`), "",
    `Buchungen: ${sales.length}`, `UMSATZ: ${eur(cf.umsatz)}`,
    `Anfangsbestand: ${cf.start==null?"–":eur(cf.start)}`, `Soll-Endbestand: ${eur(cf.soll)}`,
    `Gezählt: ${cf.counted==null?"–":eur(cf.counted)}`, `Differenz: ${cf.diff==null?"–":eur(cf.diff)}`].join("\n");
}
$("copyBtn").addEventListener("click", ()=>{
  const txt = summaryText();
  const fallback = ()=>{ const ta=document.createElement("textarea"); ta.value=txt; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); showToast("Übersicht kopiert", false);}catch(e){ showToast("Kopieren nicht möglich", false);} ta.remove(); };
  try{ navigator.clipboard.writeText(txt).then(()=>showToast("Übersicht kopiert", false), fallback); }catch(e){ fallback(); }
});
$("csvBtn").addEventListener("click", ()=>{
  const sales = selectedSales().slice().reverse();
  const rows = [["Spiel","Zeit","Artikel","Menge","Einzelpreis","Summe","Kassiert von"]];
  for(const s of sales) for(const i of s.items) rows.push([s.event, new Date(s.ts).toLocaleString("de-DE"), i.name, i.qty, (i.price/100).toFixed(2).replace(".",","), (i.price*i.qty/100).toFixed(2).replace(".",","), s.by||""]);
  const csv = "﻿"+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\r\n");
  saveFile(new Blob([csv], {type:"text/csv"}), `Kasse_${fileBase()}.csv`);
});

const pdfEur = c => (c/100).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}) + " EUR";
const pdfSafe = s => String(s).replace(/[–—]/g,"-").replace(/[^\x20-\x7E\xA0-\xFF]/g,"?");
function buildPdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const L=20, R=190; let y=22;
  const sales = selectedSales().slice().reverse();
  const rows = aggregate(sales), cf = cashFigures(sales);
  const fmtDT = ts => new Date(ts).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const need = h => { if(y+h>275){ doc.addPage(); y=22; } };

  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(90);
  if(store.club){ doc.text(pdfSafe(store.club).toUpperCase(), L, y); y+=7; }
  doc.setTextColor(20); doc.setFontSize(20); doc.text("Kassenabrechnung", L, y); y+=8;
  doc.setFont("helvetica","normal"); doc.setFontSize(12); doc.text(pdfSafe(cf.ev), L, y); y+=6;
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text(sales.length ? `Verkaufszeitraum: ${fmtDT(sales[0].ts)} bis ${fmtDT(sales[sales.length-1].ts)}` : "Keine Buchungen", L, y); y+=4.5;
  doc.text(`Erstellt: ${fmtDT(new Date().toISOString())}${user&&user.email?" von "+pdfSafe(user.email):""}`, L, y); y+=9;
  doc.setTextColor(20);

  doc.setFont("helvetica","bold"); doc.setFontSize(10);
  doc.text("Artikel", L, y); doc.text("Stück", 125, y, {align:"right"}); doc.text("Einzelpreis", 157, y, {align:"right"}); doc.text("Umsatz", R, y, {align:"right"});
  y+=2; doc.setLineWidth(0.4); doc.line(L, y, R, y); y+=5.5;
  doc.setFont("helvetica","normal");
  if(!rows.length){ doc.text("Keine Verkäufe.", L, y); y+=6; }
  for(const r of rows){
    need(7);
    doc.text(pdfSafe(r.name), L, y); doc.text(String(r.qty), 125, y, {align:"right"}); doc.text(pdfEur(r.price), 157, y, {align:"right"}); doc.text(pdfEur(r.sum), R, y, {align:"right"});
    y+=2; doc.setDrawColor(210); doc.setLineWidth(0.1); doc.line(L, y, R, y); doc.setDrawColor(0); y+=4.5;
  }
  need(20);
  doc.setLineWidth(0.4); doc.line(L, y-3, R, y-3); y+=1.5;
  doc.setFont("helvetica","bold");
  doc.text("Umsatz gesamt", L, y); doc.text(String(rows.reduce((s,r)=>s+r.qty,0)), 125, y, {align:"right"}); doc.text(pdfEur(cf.umsatz), R, y, {align:"right"}); y+=6;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(`Anzahl Buchungen: ${sales.length}   -   Durchschnitt pro Bon: ${pdfEur(sales.length?Math.round(cf.umsatz/sales.length):0)}`, L, y); y+=12;
  doc.setTextColor(20);

  need(60);
  doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.text("Kassenbestand", L, y); y+=7;
  doc.setFontSize(10);
  const line = (label, val, bold) => { doc.setFont("helvetica", bold?"bold":"normal"); doc.text(label, L, y); doc.text(val, 120, y, {align:"right"}); y+=6.5; };
  line("Anfangsbestand", cf.start==null ? "nicht erfasst" : pdfEur(cf.start));
  line("+ Umsatz", pdfEur(cf.umsatz));
  doc.setLineWidth(0.3); doc.line(L, y-4.5, 120, y-4.5);
  line("= Soll-Endbestand", pdfEur(cf.soll), true);
  line("Gezählter Endbestand (Ist)", cf.counted==null ? "________________" : pdfEur(cf.counted));
  line("Differenz (Ist - Soll)", cf.diff==null ? "________________" : (cf.diff>0?"+":"") + pdfEur(cf.diff), true);
  y+=4;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(90);
  doc.text("Pfand-Rückgaben sind als negative Beträge im Umsatz enthalten.", L, y); y+=18;
  doc.setTextColor(20);

  need(25);
  doc.setLineWidth(0.3); doc.line(L, y, 95, y); doc.line(115, y, R, y); y+=5;
  doc.setFontSize(9);
  doc.text("Datum, Unterschrift Kassierer/in", L, y); doc.text("Datum, Unterschrift Prüfer/in", 115, y);

  const pages = doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`Seite ${i} von ${pages}`, R, 287, {align:"right"}); }
  return doc;
}
$("pdfBtn").addEventListener("click", ()=>{
  if(!window.jspdf){ showToast("PDF-Modul nicht geladen. Seite einmal mit Internet öffnen.", false); return; }
  if(!salesByEvent[viewName()]){ showToast("Buchungen werden noch geladen …", false); return; }
  try{ saveFile(buildPdf().output("blob"), `Abrechnung_${fileBase()}.pdf`); }
  catch(e){ showToast("PDF konnte nicht erstellt werden", false); }
});

/* ---------- Einstellungen ---------- */
let draft = [];
function renderEdit(){
  $("editList").innerHTML = draft.map((p,i)=>`<div class="erow">
    <input data-i="${i}" data-f="name" value="${esc(p.name)}" aria-label="Name">
    <input data-i="${i}" data-f="price" inputmode="decimal" value="${fmtIn(p.price)}" aria-label="Preis in Euro" class="num">
    <select data-i="${i}" data-f="cat" aria-label="Kategorie">${CATS.map(c=>`<option ${c===p.cat?"selected":""}>${c}</option>`).join("")}</select>
    <button class="del" data-rm="${i}" aria-label="Entfernen">×</button></div>`).join("");
}
$("editList").addEventListener("input", e=>{
  const el=e.target, i=+el.dataset.i, f=el.dataset.f; if(isNaN(i)) return;
  if(f==="price"){ const v=parseEur(el.value); draft[i].price = v==null?0:v; } else if(f) draft[i][f]=el.value;
});
$("editList").addEventListener("change", e=>{ const el=e.target; if(el.dataset.f==="cat") draft[+el.dataset.i].cat=el.value; });
$("editList").addEventListener("click", e=>{ const b=e.target.closest("[data-rm]"); if(b){ draft.splice(+b.dataset.rm,1); renderEdit(); } });
$("addRow").addEventListener("click", ()=>{ draft.push({id:"p"+newId(), name:"Neuer Artikel", price:0, cat:"Essen"}); renderEdit(); });
$("saveProducts").addEventListener("click", ()=>{
  store.products = draft.filter(p=>p.name.trim()).map(p=>({...p, name:p.name.trim()}));
  write(FB.setDoc(FB.doc(db,"config","products"), {list: store.products}), "Artikel nicht gespeichert.");
  $("saveStatus").textContent = "Gespeichert";
  renderKasse(); setTimeout(()=>$("saveStatus").textContent="", 3000);
});
let clubTimer=null;
$("clubName").addEventListener("input", e=>{ store.club = e.target.value.trim(); clearTimeout(clubTimer); clubTimer=setTimeout(saveSettings, 800); });

$("backupBtn").addEventListener("click", async ()=>{
  $("storageStatus").textContent = "Sammle alle Buchungen …";
  try{
    const snap = await FB.getDocs(FB.collection(db,"sales"));
    const sales = snap.docs.map(d=>({id:d.id, ...d.data()}));
    const data = {app:"vereinskasse", version:2, exported:new Date().toISOString(), products:store.products, event:store.event, club:store.club, cash:store.cash, sales};
    saveFile(new Blob([JSON.stringify(data, null, 1)], {type:"application/json"}), `Vereinskasse_Sicherung_${new Date().toISOString().slice(0,10)}.json`);
    $("storageStatus").textContent = `${sales.length} Buchungen gesichert.`;
  }catch(e){ if(!permissionProblem(e)) $("storageStatus").textContent = "Sicherung fehlgeschlagen. Internet prüfen."; }
});
$("restoreBtn").addEventListener("click", ()=>$("restoreFile").click());
$("restoreFile").addEventListener("change", async e=>{
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  let d;
  try{ d = JSON.parse(await f.text()); if(d.app!=="vereinskasse" || !Array.isArray(d.sales)) throw 0; }
  catch(_){ showToast("Datei ist keine gültige Vereinskasse-Sicherung", false); return; }
  $("storageStatus").textContent = "Spiele Sicherung ein …";
  try{
    const valid = d.sales.filter(s=>s && s.id && s.event && s.ts && Array.isArray(s.items));
    for(let i=0;i<valid.length;i+=400){
      const b = FB.writeBatch(db);
      valid.slice(i,i+400).forEach(s=>{ const {id, ...rest} = s; b.set(FB.doc(db,"sales",String(id)), rest); });
      await b.commit();
    }
    const b2 = FB.writeBatch(db);
    for(const [ev,c] of Object.entries(d.cash||{})) if(!store.cash[ev]) b2.set(FB.doc(db,"cash",slug(ev)), {event:ev, start:c.start??null, counted:c.counted??null, created:c.created||null});
    if(Array.isArray(d.products) && d.products.length && !store.products.length) b2.set(FB.doc(db,"config","products"), {list:d.products});
    const settings = {event: store.event || d.event || "", club: store.club || d.club || ""};
    b2.set(FB.doc(db,"config","settings"), settings);
    await b2.commit();
    Object.keys(salesByEvent).forEach(k=>{ if(k!==currentListenEvent) delete salesByEvent[k]; });
    $("storageStatus").textContent = `${valid.length} Buchungen eingespielt (doppelte überschrieben, nicht verdoppelt).`;
    showToast("Sicherung eingespielt", false);
  }catch(x){ if(!permissionProblem(x)) $("storageStatus").textContent = "Einspielen fehlgeschlagen. Internet prüfen."; }
});

/* ---------- Tabs ---------- */
function switchTab(tab){
  document.querySelectorAll("nav.tabs button").forEach(x=>x.setAttribute("aria-selected", x.dataset.tab===tab));
  ["kasse","uebersicht","archiv","artikel"].forEach(t=>$("tab-"+t).hidden = t!==tab);
  document.body.classList.toggle("on-kasse", tab==="kasse");
  $("newEventForm").hidden = true;
  if(tab==="artikel"){ draft = store.products.map(p=>({...p})); renderEdit(); $("clubName").value = store.club; }
  if(tab==="uebersicht") renderOverview();
  if(tab==="archiv"){ ui.archConfirm=null; knownEvents().forEach(ev=>{ if(ev!==currentListenEvent) loadEvent(ev, true); }); renderArchive(); }
  window.scrollTo(0,0);
}
document.querySelector("nav.tabs").addEventListener("click", e=>{ const b=e.target.closest("[data-tab]"); if(b) switchTab(b.dataset.tab); });

/* ---------- Bildschirm anlassen ---------- */
let wakeLock = null;
async function keepAwake(){
  try{ if("wakeLock" in navigator && document.visibilityState==="visible" && !wakeLock){ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", ()=>{ wakeLock=null; }); } }catch(e){}
}
document.addEventListener("visibilitychange", keepAwake);
document.addEventListener("click", keepAwake, {once:true});

renderKasse(); renderSync();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(()=>{});
