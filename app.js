'use strict';
/* =========================================================
   えほんアプリ
   ・データはすべて端末内（IndexedDB）に保存
   ・books: 絵本（文字・タイムライン） / clips: 声 / media: 画像
   ========================================================= */

/* ===== ユーティリティ ===== */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs = {}, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtSec = s => `${(Math.round(s * 10) / 10).toFixed(1)}秒`;
const CATS = {opening: 'はじまりはじまり', ending: 'おしまい', other: 'そのほか'};

const prefs = (() => { try{ return JSON.parse(localStorage.getItem('ehon-prefs') || '{}'); }catch(e){ return {}; } })();
function setPref(k, v){ prefs[k] = v; try{ localStorage.setItem('ehon-prefs', JSON.stringify(prefs)); }catch(e){} }

let toastTimer;
function toast(msg, ms = 2200){
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

/* ===== データベース ===== */
let db;
function openDB(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('ehon-app', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['books', 'clips', 'media']) d.createObjectStore(s, {keyPath: 'id'});
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function dbReq(store, mode, fn){
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => res(q && q.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const DB = {
  all: s => dbReq(s, 'readonly', st => st.getAll()),
  get: (s, id) => dbReq(s, 'readonly', st => st.get(id)),
  put: (s, v) => dbReq(s, 'readwrite', st => st.put(v)),
  del: (s, id) => dbReq(s, 'readwrite', st => st.delete(id)),
  clear: s => dbReq(s, 'readwrite', st => st.clear()),
};

let books = [], clips = [];
const findBook = id => books.find(b => b.id === id);
const clipById = id => id ? clips.find(c => c.id === id) : null;

/* ===== 画像 ===== */
const mediaUrls = new Map();
async function mediaUrl(id){
  if (!id) return null;
  if (mediaUrls.has(id)) return mediaUrls.get(id);
  const m = await DB.get('media', id);
  if (!m) return null;
  const u = URL.createObjectURL(m.blob);
  mediaUrls.set(id, u);
  return u;
}
async function addMedia(blob){ const id = uid(); await DB.put('media', {id, blob}); return id; }
function mediaRefs(id){
  let n = 0;
  for (const b of books){ if (b.coverMediaId === id) n++; for (const p of b.pages) if (p.mediaId === id) n++; }
  return n;
}
async function releaseMedia(id){
  if (!id || mediaRefs(id) > 0) return;
  await DB.del('media', id);
  if (mediaUrls.has(id)){ URL.revokeObjectURL(mediaUrls.get(id)); mediaUrls.delete(id); }
}
async function loadImageFile(file, max = 1600){
  const bmp = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.86));
}
function pickFile(accept){
  return new Promise(res => {
    const i = el('input', {type: 'file', accept});
    i.addEventListener('change', () => res(i.files[0] || null));
    i.addEventListener('cancel', () => res(null));
    i.click();
  });
}
function pickFiles(accept){
  return new Promise(res => {
    const i = el('input', {type: 'file', accept, multiple: true});
    i.addEventListener('change', () => res([...i.files]));
    i.addEventListener('cancel', () => res([]));
    i.click();
  });
}
function pictureNode(src, fallbackTitle){
  const box = el('div', {class: 'pic'});
  if (src && src.mediaId){
    const img = el('img', {alt: ''});
    if (src.fit === 'cover') img.style.objectFit = 'cover';
    box.append(img);
    mediaUrl(src.mediaId).then(u => { if (u) img.src = u; });
  } else if (src && src.svg){
    box.innerHTML = src.svg;
  } else {
    box.classList.add('blank');
    if (fallbackTitle) box.append(el('div', {class: 'ph-title'}, fallbackTitle));
  }
  return box;
}
function coverSrc(b){
  if (b.coverMediaId) return {mediaId: b.coverMediaId};
  if (b.coverSvg) return {svg: b.coverSvg};
  const p = b.pages[0];
  return p ? {mediaId: p.mediaId, svg: p.svg, fit: p.fit} : {};
}

/* ===== 音声の再生 ===== */
let AC = null;
function ac(){
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
let playToken = 0, curAudio = null;
function stopAudio(){
  playToken++;
  if (curAudio){ const a = curAudio; curAudio = null; a.pause(); }
  document.querySelectorAll('.play-mini.on').forEach(b => { b.classList.remove('on'); b.textContent = '▶'; });
}
function playBlob(blob, token){
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    curAudio = a;
    let fin = false;
    const done = () => { if (fin) return; fin = true; URL.revokeObjectURL(url); if (curAudio === a) curAudio = null; res(); };
    a.onended = done; a.onerror = done;
    a.onpause = () => { if (token !== playToken) done(); };
    a.play().catch(done);
  });
}
const estDur = text => Math.max(0.7, [...(text || '')].length * 0.17);
function itemDur(it){
  if (it.type === 'pause') return it.sec;
  const c = clipById(it.clipId);
  return c ? c.dur : ((it.text || '').trim() ? estDur(it.text) : 0);
}
/* ことばと「ま」を順番に再生。声のないことばは文字の長さぶんだけ表示 */
async function playItems(items, {onStart, onEnd} = {}){
  stopAudio();
  const token = playToken;
  for (const it of items){
    if (token !== playToken) return false;
    if (it.type === 'pause'){ await sleep(it.sec * 1000); continue; }
    const c = clipById(it.clipId);
    if (!c && !(it.text || '').trim()) continue;
    onStart && onStart(it);
    if (c) await playBlob(c.blob, token);
    else await sleep(estDur(it.text) * 1000);
    onEnd && onEnd(it);
  }
  return token === playToken;
}
function playBtn(clip){
  const b = el('button', {class: 'play-mini', 'aria-label': 'きく', onclick: async e => {
    e.stopPropagation();
    if (b.classList.contains('on')){ stopAudio(); return; }
    stopAudio();
    b.classList.add('on'); b.textContent = '■';
    await playBlob(clip.blob, playToken);
    b.classList.remove('on'); b.textContent = '▶';
  }}, '▶');
  return b;
}

/* ===== 汎用ダイアログ ===== */
function modal(build, {cls = ''} = {}){
  return new Promise(resolve => {
    const d = el('dialog', {class: cls});
    let done = false;
    const close = v => {
      if (done) return; done = true;
      if (d.open) d.close();
      d.dispatchEvent(new Event('cleanup'));
      setTimeout(() => d.remove(), 0);
      resolve(v);
    };
    d.addEventListener('cancel', e => { e.preventDefault(); close(undefined); });
    document.body.append(d);
    d.append(build(close, d));
    d.showModal();
  });
}
function confirmBox(title, msg, {yes = 'はい', no = 'いいえ', danger = true} = {}){
  return modal(close => el('div', {class: 'pad'},
    el('h2', {}, title), msg ? el('p', {class: 'note'}, msg) : null,
    el('div', {class: 'foot'}, el('span'), el('div', {class: 'r'},
      el('button', {class: 'btn', onclick: () => close(false)}, no),
      el('button', {class: 'btn fill' + (danger ? ' danger' : ''), onclick: () => close(true)}, yes)))
  )).then(v => v === true);
}
function promptBox(title, value = '', {multiline = false, placeholder = ''} = {}){
  return modal(close => {
    const inp = multiline
      ? el('textarea', {rows: '6', placeholder})
      : el('input', {type: 'text', placeholder, maxlength: '40'});
    inp.value = value;
    setTimeout(() => inp.focus(), 60);
    const ok = () => close(inp.value);
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); ok(); } });
    return el('div', {class: 'pad'}, el('h2', {}, title), inp,
      el('div', {class: 'foot'}, el('span'), el('div', {class: 'r'},
        el('button', {class: 'btn', onclick: () => close(null)}, 'キャンセル'),
        el('button', {class: 'btn fill', onclick: ok}, 'OK'))));
  }).then(v => v == null ? null : v);
}
function menuBox(title, items){
  return modal(close => el('div', {class: 'pad'}, el('h2', {}, title),
    el('div', {class: 'menu'}, items.filter(Boolean).map(([label, fn, cls]) =>
      el('button', {class: 'btn ' + (cls || ''), onclick: () => { close(); fn(); }}, label))),
    el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn ghost', onclick: () => close()}, 'とじる'))));
}

/* ===== 文章 → ことばのリスト ===== */
function textToItems(text){
  const out = [];
  for (const line of String(text).split(/\n+/)){
    const parts = line.match(/[^。！？!?]+[。！？!?」』]*/g) || [];
    for (const pt of parts){
      const t = pt.trim();
      if (!t) continue;
      out.push({id: uid(), type: 'text', text: t, clipId: null});
      out.push({id: uid(), type: 'pause', sec: 0.6});
    }
  }
  while (out.length && out[out.length - 1].type === 'pause') out.pop();
  if (!out.length) out.push({id: uid(), type: 'text', text: '', clipId: null});
  return out;
}
const newPage = () => ({id: uid(), mediaId: null, svg: null, items: [{id: uid(), type: 'text', text: '', clipId: null}]});
const latestClip = cat => { const a = clips.filter(c => c.cat === cat).sort((x, y) => y.created - x.created); return a[0] ? a[0].id : null; };

/* ===== 保存 ===== */
let saveTimer = null, pendingSave = null;
function saveBook(b, now = false){
  b.updated = Date.now();
  pendingSave = b;
  clearTimeout(saveTimer);
  const f = () => { pendingSave = null; return DB.put('books', b); };
  if (now) return f();
  saveTimer = setTimeout(f, 300);
}
window.addEventListener('pagehide', () => { if (pendingSave) DB.put('books', pendingSave); });
document.addEventListener('visibilitychange', () => { if (document.hidden && pendingSave){ clearTimeout(saveTimer); DB.put('books', pendingSave); pendingSave = null; } });

/* ===== 画面の切り替え ===== */
function go(h){ if (location.hash === h) route(); else location.hash = h; }
function route(){
  stopAudio();
  const [v, id] = location.hash.replace(/^#\/?/, '').split('/');
  for (const x of ['vHome', 'vEdit', 'vPlay']) $('#' + x).hidden = true;
  if (v !== 'play'){
    releaseWake();
    pl = null;
    if (document.fullscreenElement && !wantLand()) document.exitFullscreen().catch(() => {});
    else applyOrientation(false);
  }
  const b = findBook(id);
  if (v === 'edit' && b) showEdit(b);
  else if (v === 'play' && b) showPlay(b);
  else showHome();
}
window.addEventListener('hashchange', route);

/* =========================================================
   ホーム
   ========================================================= */
function showHome(){
  const v = $('#vHome'); v.hidden = false;
  const mode = prefs.mode || 'play';
  const tab = prefs.homeTab || 'books';
  const tabBtn = (k, label) => el('button', {class: tab === k ? 'on' : '', onclick: () => { setPref('homeTab', k); showHome(); }}, label);
  v.replaceChildren(...[
    el('header', {class: 'home-head'},
      el('div', {class: 'brand'}, el('img', {src: './icon-192.png', alt: ''}), el('h1', {}, 'えほんアプリ')),
      el('div', {class: 'head-r'}, orientBtn(), el('button', {class: 'icon-btn', onclick: openSettings, 'aria-label': 'せってい'}, 'せってい'))),
    el('div', {class: 'mode-switch'},
      el('button', {class: mode === 'play' ? 'on' : '', onclick: () => { setPref('mode', 'play'); showHome(); }}, '▶ よむ（さいせい）'),
      el('button', {class: mode === 'edit' ? 'on' : '', onclick: () => { setPref('mode', 'edit'); showHome(); }}, '✎ つくる（へんしゅう）')),
    mode === 'edit' ? el('nav', {class: 'seg-tabs'}, tabBtn('books', 'えほん'), tabBtn('lib', 'こえのライブラリ')) : null,
    (mode === 'edit' && tab === 'lib') ? libraryView() : bookGrid(mode)
  ].filter(Boolean));
}

function bookGrid(mode){
  const sorted = [...books].sort((a, b) => b.updated - a.updated);
  const grid = el('div', {class: 'book-grid'},
    el('button', {class: 'book-card new', onclick: openTemplates}, el('span', {}, '＋'), 'えほんを つくる'),
    sorted.map(b => {
      const card = el('div', {class: 'book-card', role: 'button', tabindex: '0', onclick: () => go(`#/${mode === 'edit' ? 'edit' : 'play'}/${b.id}`)},
        pictureNode(coverSrc(b), b.title),
        el('div', {class: 'meta'}, el('b', {}, b.title || '（タイトルなし）'), el('small', {}, `${b.pages.length} ページ`)),
        mode === 'edit' ? el('span', {class: 'tag'}, 'へんしゅう') : null,
        mode === 'edit' ? el('button', {class: 'more', 'aria-label': 'メニュー', onclick: e => { e.stopPropagation(); bookMenu(b); }}, '⋯') : null
      );
      return card;
    })
  );
  const wrap = el('div', {}, grid);
  if (!books.length) wrap.append(el('p', {class: 'note', style: 'text-align:center;margin-top:18px'},
    'まずは「えほんを つくる」から テンプレートを えらびましょう。'));
  return wrap;
}

function bookMenu(b){
  menuBox(b.title || 'えほん', [
    ['よむ（さいせい）', () => go('#/play/' + b.id)],
    ['ふくせいする', async () => {
      const c = JSON.parse(JSON.stringify(b));
      c.id = uid(); c.title = (b.title || 'えほん') + '（コピー）'; c.created = c.updated = Date.now();
      for (const p of c.pages){ p.id = uid(); for (const it of p.items) it.id = uid(); }
      books.push(c); await DB.put('books', c); showHome(); toast('ふくせいしました');
    }],
    ['このえほんを けす', async () => {
      if (!await confirmBox('本当に削除しますか？', `「${b.title}」を けします。もとに もどせません。（こえのライブラリの こえは のこります）`)) return;
      books = books.filter(x => x !== b);
      await DB.del('books', b.id);
      const ids = [b.coverMediaId, ...b.pages.map(p => p.mediaId)];
      for (const id of ids) await releaseMedia(id);
      showHome(); toast('けしました');
    }, 'danger'],
  ]);
}

function openTemplates(){
  modal(close => el('div', {class: 'pad'},
    el('h2', {}, 'テンプレートを えらぶ'),
    el('p', {class: 'note'}, 'えらんだあとで、もじ・え・こえは じゆうに かえられます。'),
    el('div', {class: 'tpl-grid'}, TEMPLATES.map(t => el('button', {class: 'tpl', onclick: async () => {
      close();
      const b = await createBook(t);
      setPref('mode', 'edit'); setPref('homeTab', 'books');
      go('#/edit/' + b.id);
      toast('えほんを ついかしました');
    }}, el('div', {class: 'pic tpl-cover'}, el('div', {class: 'tpl-ico'}, 'しゃしん'), el('div', {class: 'tpl-pages'}, `${t.pages.length} ページ`)), el('b', {}, t.title), el('small', {}, t.desc)))),
    el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn ghost', onclick: () => close()}, 'とじる'))
  ), {cls: 'full'});
}
async function createBook(t){
  const b = {
    id: uid(), title: t.title, templateId: t.id,
    coverMediaId: null, coverSvg: null,
    openingClipId: latestClip('opening'), endingClipId: latestClip('ending'),
    pages: t.pages.map(pg => ({id: uid(), mediaId: null, svg: null, fit: 'contain', items: textToItems(pg.text || '')})),
    created: Date.now(), updated: Date.now(),
  };
  if (!b.pages.length) b.pages.push(newPage());
  books.push(b);
  await DB.put('books', b);
  return b;
}

/* ===== こえのライブラリ ===== */
function clipUsage(id){
  let n = 0;
  for (const b of books){
    if (b.openingClipId === id) n++;
    if (b.endingClipId === id) n++;
    for (const p of b.pages) for (const it of p.items) if (it.clipId === id) n++;
  }
  return n;
}
function libraryView(){
  const wrap = el('div', {});
  wrap.append(el('section', {class: 'card'},
    el('h3', {}, 'こえのライブラリ'),
    el('p', {class: 'note'}, 'ここに ほぞんした こえは、どの えほんでも つかえます。「はじまりはじまり」「おしまい」を いくつか いれておくと べんりです。'),
    el('div', {class: 'row-btns'},
      el('button', {class: 'btn fill small', onclick: () => importVoice('other', true)}, '＋ スマホの こえを とりこむ'),
      el('button', {class: 'btn small', onclick: () => recordVoice('other', true)}, '● その場で ろくおん'))));
  for (const cat of ['opening', 'ending', 'other']){
    const arr = clips.filter(c => c.cat === cat).sort((a, b) => b.created - a.created);
    wrap.append(el('section', {class: 'card lib-sec'},
      el('h3', {}, CATS[cat], el('span', {class: 'cnt'}, `${arr.length}こ`)),
      arr.length ? arr.map(c => el('div', {class: 'clip-row'}, playBtn(c),
        el('div', {class: 'clip-info'}, el('b', {}, c.name), el('small', {}, `${fmtSec(c.dur)}・${clipUsage(c.id)}かしょで しよう`)),
        el('button', {class: 'icon-btn', 'aria-label': 'メニュー', onclick: () => clipMenu(c)}, '⋯')))
        : el('p', {class: 'empty'}, 'まだ ありません'),
      el('div', {class: 'row-btns'},
        el('button', {class: 'btn tiny', onclick: () => importVoice(cat, true)}, '＋ とりこむ'),
        el('button', {class: 'btn tiny ghost', onclick: () => recordVoice(cat, true)}, '● ろくおん'))));
  }
  return wrap;
}
async function importVoice(cat, continuous){
  const f = await pickFile('audio/*,.m4a,.mp3,.wav,.aac,.ogg,.3gp,.amr');
  if (!f) return null;
  const c = await openCutter(f, {cat, continuous});
  if (!$('#vHome').hidden) showHome();
  return c;
}
async function recordVoice(cat, continuous){
  const blob = await openRecorder();
  if (!blob) return null;
  const c = await openCutter(blob, {cat, continuous});
  if (!$('#vHome').hidden) showHome();
  return c;
}
function clipMenu(c){
  menuBox(c.name, [
    ['なまえを かえる', async () => {
      const n = await promptBox('こえの なまえ', c.name);
      if (n && n.trim()){ c.name = n.trim(); await DB.put('clips', c); showHome(); }
    }],
    ...Object.entries(CATS).filter(([k]) => k !== c.cat).map(([k, label]) => [`「${label}」に いどう`, async () => {
      c.cat = k; await DB.put('clips', c); showHome();
    }]),
    ['この こえを けす', async () => {
      const n = clipUsage(c.id);
      if (!await confirmBox('本当に削除しますか？', n ? `この こえは ${n}かしょで つかわれています。けすと、その ばしょの こえも なくなります。` : 'この こえを けします。')) return;
      for (const b of books){
        let ch = false;
        if (b.openingClipId === c.id){ b.openingClipId = null; ch = true; }
        if (b.endingClipId === c.id){ b.endingClipId = null; ch = true; }
        for (const p of b.pages) for (const it of p.items) if (it.clipId === c.id){ it.clipId = null; ch = true; }
        if (ch) await saveBook(b, true);
      }
      clips = clips.filter(x => x !== c);
      await DB.del('clips', c.id);
      showHome(); toast('けしました');
    }, 'danger'],
  ]);
}
function nextClipName(cat){
  const base = cat === 'opening' ? 'はじまりはじまり' : cat === 'ending' ? 'おしまい' : 'こえ';
  let n = clips.filter(c => c.cat === cat).length + 1;
  while (clips.some(c => c.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/* ===== こえを えらぶ ===== */
function openPicker({cat = 'other', allowNone = false, title = 'こえを えらぶ'} = {}){
  return modal(close => {
    let filter = cat;
    const chips = el('div', {class: 'chips'});
    const list = el('div', {class: 'pick-list'});
    const draw = () => {
      chips.replaceChildren(...['all', 'opening', 'ending', 'other'].map(k =>
        el('button', {class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; draw(); }}, k === 'all' ? 'すべて' : CATS[k])));
      const arr = clips.filter(c => filter === 'all' || c.cat === filter).sort((a, b) => b.created - a.created);
      list.replaceChildren(...(arr.length ? arr.map(c => el('div', {class: 'clip-row'}, playBtn(c),
        el('div', {class: 'clip-info'}, el('b', {}, c.name), el('small', {}, fmtSec(c.dur))),
        el('button', {class: 'btn small fill', onclick: () => { stopAudio(); close(c.id); }}, 'えらぶ')))
        : [el('p', {class: 'empty'}, 'この しゅるいの こえは まだ ありません。下の ボタンから ついかできます。')]));
    };
    const add = async rec => {
      const tcat = filter === 'all' ? cat : filter;
      const c = rec ? await recordVoice(tcat, false) : await importVoice(tcat, false);
      if (c){ stopAudio(); close(c.id); } else draw();
    };
    draw();
    return el('div', {class: 'pad'}, el('h2', {}, title), chips, list,
      el('div', {class: 'row-btns'},
        el('button', {class: 'btn small', onclick: () => add(false)}, '＋ スマホの こえから きりだす'),
        el('button', {class: 'btn small ghost', onclick: () => add(true)}, '● ろくおん')),
      el('div', {class: 'foot'},
        allowNone ? el('button', {class: 'btn ghost', onclick: () => { stopAudio(); close('none'); }}, 'なしにする') : el('span'),
        el('button', {class: 'btn ghost', onclick: () => { stopAudio(); close(undefined); }}, 'とじる')));
  });
}

/* ===== 録音 ===== */
function openRecorder(){
  return modal((close, d) => {
    let rec = null, stream = null, t0 = 0, timer = 0, chunks = [];
    const time = el('div', {class: 'rec-time'}, '0.0');
    const stopAll = () => { clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
    d.addEventListener('cleanup', () => { if (rec && rec.state !== 'inactive'){ rec.onstop = null; rec.stop(); } stopAll(); });
    const btn = el('button', {class: 'rec-btn', onclick: async () => {
      if (!rec){
        try{ stream = await navigator.mediaDevices.getUserMedia({audio: true}); }
        catch(e){ toast('マイクが つかえません（ブラウザの許可を かくにんしてください）', 3500); return; }
        rec = new MediaRecorder(stream);
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => { stopAll(); close(new Blob(chunks, {type: rec.mimeType || 'audio/webm'})); };
        rec.start();
        t0 = Date.now();
        timer = setInterval(() => time.textContent = ((Date.now() - t0) / 1000).toFixed(1), 100);
        btn.textContent = '■ ろくおんを とめる';
      } else rec.stop();
    }}, '● ろくおん かいし');
    return el('div', {class: 'pad'}, el('h2', {}, 'その場で ろくおん'),
      el('p', {class: 'note'}, 'とめたあと、つぎの がめんで ひつような ところを きりだして ほぞんします。'),
      time, btn,
      el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn ghost', onclick: () => close(null)}, 'キャンセル')));
  });
}

/* ===== 音声の切り出し（カット） ===== */
function wavBlob(d, sr){
  const b = new ArrayBuffer(44 + d.length * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, d.length * 2, true);
  for (let i = 0, o = 44; i < d.length; i++, o += 2){
    const x = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([b], {type: 'audio/wav'});
}
async function encodeRange(buf, s, e){
  const sr = 24000, len = Math.max(1, Math.round((e - s) * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start(0, s, e - s);
  const out = await off.startRendering();
  const d = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++){ const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const gain = peak > 0.001 ? Math.min(4, 0.9 / peak) : 1;           // 音量をそろえる
  const f = Math.min(Math.floor(len / 2), Math.round(sr * 0.01));     // プチッという音を防ぐフェード
  for (let i = 0; i < d.length; i++) d[i] *= gain;
  for (let i = 0; i < f; i++){ d[i] *= i / f; d[len - 1 - i] *= i / f; }
  return {blob: wavBlob(d, sr), dur: len / sr};
}
async function openCutter(blob, {cat = 'other', continuous = false} = {}){
  toast('こえを よみこんでいます…', 20000);
  let buf;
  try{ buf = await ac().decodeAudioData(await blob.arrayBuffer()); }
  catch(e){ toast('この おんせいファイルは よみこめませんでした', 3500); return null; }
  $('#toast').hidden = true;
  const dur = buf.duration;
  const c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const step = Math.max(1, Math.floor(buf.sampleRate / 1000));
  const peaks = new Float32Array(Math.ceil(c0.length / step));
  for (let i = 0; i < peaks.length; i++){
    let m = 0;
    for (let j = i * step, J = Math.min(c0.length, j + step); j < J; j++){
      let x = c1 ? (c0[j] + c1[j]) / 2 : c0[j]; if (x < 0) x = -x; if (x > m) m = x;
    }
    peaks[i] = m;
  }

  return modal((close, d) => {
    let s = 0, e = dur, view = [0, dur], zoom = false, src = null, raf = 0, lastSaved = null;
    let ccat = cat;
    const canvas = el('canvas', {class: 'wave'});
    const sLbl = el('span', {class: 'val'}), eLbl = el('span', {class: 'val'}), info = el('div', {class: 'cut-info'});
    const nameIn = el('input', {type: 'text', value: nextClipName(ccat)});
    const catSel = el('select', {onchange: () => { const auto = /^(はじまりはじまり|おしまい|こえ) \d+$/.test(nameIn.value); ccat = catSel.value; if (auto) nameIn.value = nextClipName(ccat); }},
      Object.entries(CATS).map(([k, v]) => el('option', {value: k}, v)));
    catSel.value = ccat;
    const playB = el('button', {class: 'btn small fill', onclick: () => src ? stopPrev() : playSel()}, '▶ きく');
    const zoomB = el('button', {class: 'btn small ghost', onclick: () => { zoom = !zoom; setView(); }}, 'えらんだ ところを おおきく');

    const t2x = (t, W) => (t - view[0]) / (view[1] - view[0]) * W;
    function setView(){
      view = zoom ? [Math.max(0, s - 0.6), Math.min(dur, e + 0.6)] : [0, dur];
      zoomB.textContent = zoom ? 'ぜんたいを みる' : 'えらんだ ところを おおきく';
      draw();
    }
    function draw(ph){
      const dpr = window.devicePixelRatio || 1, W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
      if (!W) return;
      if (canvas.width !== W || canvas.height !== H){ canvas.width = W; canvas.height = H; }
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,138,61,.16)';
      g.fillRect(t2x(s, W), 0, t2x(e, W) - t2x(s, W), H);
      const mid = H / 2, span = view[1] - view[0];
      for (let x = 0; x < W; x++){
        const t0 = view[0] + x / W * span, t1 = view[0] + (x + 1) / W * span;
        let m = 0;
        for (let i = Math.floor(t0 * 1000), I = Math.max(i + 1, Math.floor(t1 * 1000)); i < I && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
        g.fillStyle = (t0 >= s && t0 <= e) ? '#ff8a3d' : '#cfc5ba';
        const h = Math.max(dpr, m * mid * 0.95);
        g.fillRect(x, mid - h, 1, h * 2);
      }
      for (const [t, col] of [[s, '#2a9d8f'], [e, '#e5534b']]){
        const x = t2x(t, W);
        g.fillStyle = col;
        g.fillRect(x - 1.5 * dpr, 0, 3 * dpr, H);
        g.beginPath(); g.arc(x, H - 10 * dpr, 8 * dpr, 0, Math.PI * 2); g.fill();
      }
      if (ph != null){ g.fillStyle = '#3a2f28'; g.fillRect(t2x(ph, W) - dpr, 0, 2 * dpr, H); }
      sLbl.textContent = `${s.toFixed(2)}秒`;
      eLbl.textContent = `${e.toFixed(2)}秒`;
      info.textContent = `えらんだ ながさ：${fmtSec(e - s)}（ぜんたい ${fmtSec(dur)}）`;
    }
    const clampSE = () => {
      s = Math.max(0, Math.min(s, dur - 0.05));
      e = Math.max(s + 0.05, Math.min(e, dur));
    };
    // 波形をタッチして はじめ／おわり を うごかす
    let drag = null;
    const x2t = ev => { const r = canvas.getBoundingClientRect(); return view[0] + Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * (view[1] - view[0]); };
    canvas.addEventListener('pointerdown', ev => {
      const t = x2t(ev);
      drag = Math.abs(t - s) <= Math.abs(t - e) ? 's' : 'e';
      canvas.setPointerCapture(ev.pointerId);
      move(ev);
    });
    const move = ev => {
      if (!drag) return;
      const t = x2t(ev);
      if (drag === 's') s = Math.min(t, e - 0.05); else e = Math.max(t, s + 0.05);
      clampSE(); draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => drag = null);
    canvas.addEventListener('pointercancel', () => drag = null);

    const nudge = (which, dv) => { stopPrev(); if (which === 's') s = Math.min(s + dv, e - 0.05); else e = Math.max(e + dv, s + 0.05); clampSE(); draw(); };
    function stopPrev(){ if (src){ try{ src.onended = null; src.stop(); }catch(_){} src = null; } cancelAnimationFrame(raf); playB.textContent = '▶ きく'; draw(); }
    function playSel(){
      stopAudio(); stopPrev();
      const ctx = ac();
      src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      const t0 = ctx.currentTime, from = s, len = e - s;
      src.start(0, from, len);
      src.onended = () => { src = null; stopPrev(); };
      playB.textContent = '■ とめる';
      const tick = () => { const p = from + (ctx.currentTime - t0); if (p <= from + len){ draw(p); raf = requestAnimationFrame(tick); } };
      tick();
    }
    function trimSilence(){
      stopPrev();
      const i0 = Math.floor(s * 1000), i1 = Math.min(peaks.length - 1, Math.floor(e * 1000));
      let mx = 0; for (let i = i0; i <= i1; i++) if (peaks[i] > mx) mx = peaks[i];
      const thr = Math.max(0.01, mx * 0.08);
      let a = i0, b = i1;
      while (a < i1 && peaks[a] < thr) a++;
      while (b > a && peaks[b] < thr) b--;
      if (b - a < 30){ toast('こえが みつかりませんでした'); return; }
      s = Math.max(0, a / 1000 - 0.06); e = Math.min(dur, b / 1000 + 0.1);
      clampSE(); if (zoom) setView(); else draw();
      toast('まえと うしろの しずかな ところを カットしました');
    }
    async function save(next){
      stopPrev();
      const out = await encodeRange(buf, s, e);
      const c = {id: uid(), name: nameIn.value.trim() || nextClipName(ccat), cat: ccat, blob: out.blob, dur: out.dur, created: Date.now()};
      await DB.put('clips', c); clips.push(c); lastSaved = c;
      toast(`「${c.name}」を ほぞんしました`);
      if (!next){ close(c); return; }
      const len = e - s;
      s = Math.min(e, dur - 0.05); e = Math.min(dur, s + len);
      clampSE(); nameIn.value = nextClipName(ccat);
      if (zoom) setView(); else draw();
    }
    d.addEventListener('cleanup', stopPrev);
    const ro = new ResizeObserver(() => draw()); ro.observe(canvas);
    d.addEventListener('cleanup', () => ro.disconnect());

    return el('div', {class: 'pad'},
      el('h2', {}, 'こえを きりだす'),
      el('p', {class: 'note'}, 'なみの 上を タッチ・スライドして、はじめ（みどり）と おわり（あか）を きめます。もとの ファイルは かわりません。'),
      canvas,
      el('div', {class: 'cut-row'}, el('span', {class: 'lbl s'}, 'はじめ'),
        el('button', {class: 'btn tiny', onclick: () => nudge('s', -0.1)}, '−0.1'), sLbl,
        el('button', {class: 'btn tiny', onclick: () => nudge('s', 0.1)}, '+0.1')),
      el('div', {class: 'cut-row'}, el('span', {class: 'lbl e'}, 'おわり'),
        el('button', {class: 'btn tiny', onclick: () => nudge('e', -0.1)}, '−0.1'), eLbl,
        el('button', {class: 'btn tiny', onclick: () => nudge('e', 0.1)}, '+0.1')),
      info,
      el('div', {class: 'row-btns'}, playB, zoomB, el('button', {class: 'btn small ghost', onclick: trimSilence}, 'しずかな ところを カット')),
      el('div', {class: 'field'}, el('label', {}, 'なまえ'), nameIn),
      el('div', {class: 'field'}, el('label', {}, 'しゅるい'), catSel),
      el('div', {class: 'foot'},
        el('button', {class: 'btn ghost', onclick: () => close(lastSaved)}, lastSaved ? 'おわる' : 'キャンセル'),
        el('div', {class: 'r'},
          continuous ? el('button', {class: 'btn', onclick: () => save(true)}, 'ほぞんして つぎへ') : null,
          el('button', {class: 'btn fill', onclick: () => save(false)}, 'ほぞん')))
    );
  }, {cls: 'full'});
}

/* =========================================================
   へんしゅう
   ========================================================= */
let ed = null;
function showEdit(b){
  const keep = ed && ed.book === b ? ed.sel : 0;
  ed = {book: b, sel: Math.max(0, Math.min(keep, b.pages.length - 1))};
  $('#vEdit').hidden = false;
  renderEdit();
}
function renderEdit(){
  const b = ed.book, y = window.scrollY;
  const colY = [...document.querySelectorAll('#vEdit .ed-col')].map(c => c.scrollTop);
  const pe = b.pages.length ? pageEditor(b, b.pages[ed.sel]) : [el('p', {class: 'empty'}, 'ページが ありません。「＋ ページ」で ふやしましょう。')];
  $('#vEdit').replaceChildren(
    el('header', {class: 'ed-head'},
      el('button', {class: 'icon-btn', onclick: () => go('#/')}, '‹ もどる'),
      el('input', {class: 'title-input', value: b.title, placeholder: 'えほんの タイトル', oninput: e => { b.title = e.target.value; saveBook(b); }}),
      orientBtn(),
      el('button', {class: 'btn small fill', onclick: () => go('#/play/' + b.id)}, '▶ よむ')),
    el('div', {class: 'ed-grid'}, el('div', {class: 'ed-col'},
    bookSettingsCard(b),
    el('section', {class: 'card'}, el('h3', {}, 'ページ'),
      el('div', {class: 'strip'},
        b.pages.map((p, i) => el('button', {class: 'strip-page' + (i === ed.sel ? ' on' : ''), onclick: () => { stopAudio(); ed.sel = i; renderEdit(); }},
          pictureNode(p), el('span', {class: 'pno'}, String(i + 1)))),
        el('button', {class: 'strip-add', onclick: () => { b.pages.splice(ed.sel + 1, 0, newPage()); ed.sel = b.pages.length > 1 ? ed.sel + 1 : 0; saveBook(b); renderEdit(); }}, '＋\nページ')),
      el('div', {class: 'row-btns'}, el('button', {class: 'btn small fill', onclick: () => bulkPhotos(b)}, 'しゃしんを まとめて えらぶ')),
      el('p', {class: 'note'}, 'えらんだ じゅんばんに、1ページめから しゃしんが はいります。たりない ぶんの ページは じどうで ふえます。')),
    pe[0]), el('div', {class: 'ed-col'}, pe.slice(1)))
  );
  window.scrollTo(0, y);
  document.querySelectorAll('#vEdit .ed-col').forEach((c, k) => { if (colY[k] != null) c.scrollTop = colY[k]; });
  const on = $('#vEdit .strip-page.on'); if (on) on.scrollIntoView({inline: 'nearest', block: 'nearest'});
}
function bookSettingsCard(b){
  const voiceRow = (key, cat, label) => {
    const c = clipById(b[key]);
    return el('div', {},
      el('span', {class: 'vs-label'}, `「${label}」の こえ`),
      el('div', {class: 'vs-ctrl'}, c ? playBtn(c) : null,
        el('button', {class: 'btn small' + (c ? '' : ' ghost'), onclick: async () => {
          const r = await openPicker({cat, allowNone: true, title: `「${label}」の こえを えらぶ`});
          if (r === undefined) return;
          b[key] = r === 'none' ? null : r;
          saveBook(b); renderEdit();
        }}, c ? c.name : 'えらぶ（いまは なし）')));
  };
  return el('section', {class: 'card'}, el('h3', {}, 'ひょうし と こえ'),
    el('div', {class: 'cover-row'},
      el('div', {class: 'cover-thumb', onclick: () => coverMenu(b)}, pictureNode(coverSrc(b), b.title), el('span', {class: 'cover-tag'}, 'サムネイルを かえる')),
      el('div', {class: 'voice-sets'}, voiceRow('openingClipId', 'opening', 'はじまりはじまり'), voiceRow('endingClipId', 'ending', 'おしまい'))),
    el('p', {class: 'note'}, 'さいせいの とき、ひょうしで「はじまりはじまり」、さいごに「おしまい」の こえが ながれます。'));
}
function coverMenu(b){
  menuBox('サムネイル（ひょうし）', [
    ['スマホの がぞうを えらぶ', async () => {
      const f = await pickFile('image/*'); if (!f) return;
      try{
        const blob = await loadImageFile(f, 1200);
        const old = b.coverMediaId;
        b.coverMediaId = await addMedia(blob); b.coverSvg = null;
        await saveBook(b, true); await releaseMedia(old); renderEdit();
      }catch(e){ toast('がぞうを よみこめませんでした'); }
    }],
    ['1ページめの えを つかう', async () => {
      const old = b.coverMediaId; b.coverMediaId = null; b.coverSvg = null;
      await saveBook(b, true); await releaseMedia(old); renderEdit();
    }],
  ]);
}
function pageMenu(b, i){
  const p = b.pages[i];
  menuBox(`${i + 1} ページめ`, [
    i > 0 && ['まえへ いどう', () => { b.pages.splice(i, 1); b.pages.splice(i - 1, 0, p); ed.sel = i - 1; saveBook(b); renderEdit(); }],
    i < b.pages.length - 1 && ['うしろへ いどう', () => { b.pages.splice(i, 1); b.pages.splice(i + 1, 0, p); ed.sel = i + 1; saveBook(b); renderEdit(); }],
    ['この ページを ふくせい', () => {
      const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.items.forEach(it => it.id = uid());
      b.pages.splice(i + 1, 0, c); ed.sel = i + 1; saveBook(b); renderEdit();
    }],
    ['この ページを けす', async () => {
      if (!await confirmBox('本当に削除しますか？', `${i + 1} ページめを けします。`)) return;
      b.pages.splice(i, 1); ed.sel = Math.max(0, Math.min(i, b.pages.length - 1));
      await saveBook(b, true); await releaseMedia(p.mediaId); renderEdit();
    }, 'danger'],
  ]);
}

async function choosePhoto(b, p){
  const f = await pickFile('image/*'); if (!f) return;
  toast('しゃしんを よみこんでいます…', 20000);
  try{
    const blob = await loadImageFile(f);
    const old = p.mediaId;
    p.mediaId = await addMedia(blob); p.svg = null;
    await saveBook(b, true); await releaseMedia(old); renderEdit();
    toast('しゃしんを いれました');
  }catch(e){ toast('しゃしんを よみこめませんでした'); }
}
async function bulkPhotos(b){
  const files = (await pickFiles('image/*')).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name));
  if (!files.length) return;
  const overwrite = b.pages.slice(0, files.length).filter(p => p.mediaId).length;
  if (overwrite && !await confirmBox('しゃしんを いれかえますか？', `${overwrite} ページの しゃしんが あたらしい しゃしんに かわります。`, {yes: 'いれかえる', no: 'やめる', danger: false})) return;
  const olds = [];
  for (let k = 0; k < files.length; k++){
    toast(`しゃしんを いれています… ${k + 1} / ${files.length}`, 60000);
    try{
      const blob = await loadImageFile(files[k]);
      if (!b.pages[k]) b.pages.push(newPage());
      const p = b.pages[k];
      if (p.mediaId) olds.push(p.mediaId);
      p.mediaId = await addMedia(blob); p.svg = null;
    }catch(e){}
  }
  await saveBook(b, true);
  for (const id of olds) await releaseMedia(id);
  ed.sel = 0; renderEdit();
  toast(`${files.length} まいの しゃしんを いれました`);
}
function pageEditor(b, p){
  const i = ed.sel;
  const cards = el('div', {class: 'items'});
  const tl = el('div', {class: 'timeline'});
  let previewing = false;
  const prevBtn = el('button', {class: 'btn fill', onclick: async () => {
    if (previewing){ stopAudio(); return; }
    previewing = true; prevBtn.textContent = '■ とめる';
    const mark = (it, on) => {
      const c = cards.querySelector(`[data-id="${it.id}"]`), t = tl.querySelector(`[data-id="${it.id}"]`);
      for (const n of [c, t]) if (n) n.classList.toggle(n === c ? 'reading' : 'now', on);
      if (on && c) c.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    };
    await playItems(p.items, {onStart: it => mark(it, true), onEnd: it => mark(it, false)});
    cards.querySelectorAll('.reading').forEach(n => n.classList.remove('reading'));
    tl.querySelectorAll('.now').forEach(n => n.classList.remove('now'));
    previewing = false; prevBtn.textContent = '▶ この ページを きいてみる';
  }}, '▶ この ページを きいてみる');

  const changed = () => { saveBook(b); drawCards(); };
  function drawTimeline(){
    const durs = p.items.map(itemDur), tot = durs.reduce((a, x) => a + x, 0);
    tl.replaceChildren(
      p.items.length ? el('div', {class: 'tl-bar'}, p.items.map((it, k) => {
        const cls = it.type === 'pause' ? 'pause' : (clipById(it.clipId) ? 'voice' : 'novoice');
        return el('button', {class: 'tl-blk ' + cls, 'data-id': it.id, style: `flex:${Math.max(durs[k], 0.15)} 1 0`, onclick: () => {
          const n = cards.querySelector(`[data-id="${it.id}"]`); if (n) n.scrollIntoView({behavior: 'smooth', block: 'center'});
        }}, it.type === 'pause' ? '' : (it.text || '').slice(0, 8));
      })) : el('p', {class: 'empty'}, 'ことばを ついかしてください'),
      el('div', {class: 'tl-meta'}, `ぜんぶで やく ${fmtSec(tot)}`,
        el('span', {class: 'legend'}, el('i', {class: 'voice'}), 'こえあり', el('i', {class: 'novoice'}), 'こえなし', el('i', {class: 'pause'}), 'ま')));
  }
  function ctrl(k){
    const it = p.items[k];
    return el('div', {class: 'it-ctrl'},
      el('button', {'aria-label': 'うえへ', disabled: k === 0, onclick: () => { p.items.splice(k, 1); p.items.splice(k - 1, 0, it); changed(); }}, '▲'),
      el('button', {'aria-label': 'したへ', disabled: k === p.items.length - 1, onclick: () => { p.items.splice(k, 1); p.items.splice(k + 1, 0, it); changed(); }}, '▼'),
      el('button', {'aria-label': 'けす', onclick: async () => {
        if (it.type === 'text' && (it.text.trim() || it.clipId) && !await confirmBox('本当に削除しますか？', 'この ことばを けします。（こえは ライブラリに のこります）')) return;
        p.items.splice(k, 1); changed();
      }}, '✕'));
  }
  function drawCards(){
    let n = 0;
    cards.replaceChildren(...p.items.map((it, k) => {
      if (it.type === 'pause'){
        const val = el('input', {class: 'sec-input', type: 'number', step: '0.1', min: '0.1', max: '10', inputmode: 'decimal', value: it.sec.toFixed(1),
          onchange: e => set(parseFloat(e.target.value))});
        const set = v => {
          if (!isFinite(v)) v = 0.5;
          it.sec = Math.round(Math.min(10, Math.max(0.1, v)) * 10) / 10;
          val.value = it.sec.toFixed(1); saveBook(b); drawTimeline();
        };
        return el('div', {class: 'it-card pause', 'data-id': it.id},
          el('span', {class: 'it-tag'}, 'ま'),
          el('button', {class: 'btn tiny', onclick: () => set(it.sec - 0.1)}, '−0.1'), val, el('span', {}, '秒'),
          el('button', {class: 'btn tiny', onclick: () => set(it.sec + 0.1)}, '+0.1'),
          ctrl(k));
      }
      n++;
      const c = clipById(it.clipId);
      const ta = el('textarea', {rows: '2', placeholder: 'ここに ことばを いれる', oninput: e => { it.text = e.target.value; saveBook(b); drawTimeline(); }});
      ta.value = it.text;
      const choose = async () => {
        const r = await openPicker({cat: 'other'});
        if (r && r !== 'none'){ it.clipId = r; changed(); }
      };
      return el('div', {class: 'it-card text', 'data-id': it.id},
        el('div', {class: 'it-top'}, el('span', {class: 'it-tag'}, `ことば ${n}`), ctrl(k)),
        ta,
        el('div', {class: 'it-voice'}, c
          ? [playBtn(c), el('span', {class: 'it-clip'}, `${c.name}（${fmtSec(c.dur)}）`),
             el('button', {class: 'btn tiny', onclick: choose}, 'かえる'),
             el('button', {class: 'btn tiny ghost', onclick: () => { it.clipId = null; changed(); }}, 'はずす')]
          : el('button', {class: 'btn tiny fill', onclick: choose}, '＋ こえを つける')));
    }));
    drawTimeline();
  }
  drawCards();

  return [el('section', {class: 'card'},
    el('div', {class: 'pe-head'}, el('h3', {}, `${i + 1} ページめ`), el('button', {class: 'icon-btn', onclick: () => pageMenu(b, i)}, '⋯ ページの そうさ')),
    el('div', {class: 'pe-pic' + (p.mediaId ? '' : ' empty-pic'), style: 'margin-top:10px', role: 'button', onclick: () => choosePhoto(b, p)},
      pictureNode(p), p.mediaId ? null : el('div', {class: 'pick-hint'}, el('b', {}, '＋'), 'タップして しゃしんを えらぶ')),
    el('div', {class: 'row-btns'},
      el('button', {class: 'btn small' + (p.mediaId ? '' : ' fill'), onclick: () => choosePhoto(b, p)}, p.mediaId ? 'しゃしんを かえる' : 'スマホの しゃしんを えらぶ'),
      (p.mediaId || p.svg) ? el('button', {class: 'btn small ghost', onclick: async () => {
        const old = p.mediaId; p.mediaId = null; p.svg = null;
        await saveBook(b, true); await releaseMedia(old); renderEdit();
      }}, 'しゃしんを はずす') : null),
    p.mediaId ? el('div', {class: 'fit-row'}, el('span', {}, 'みせかた'),
      el('div', {class: 'chips'},
        el('button', {class: 'chip' + (p.fit !== 'cover' ? ' on' : ''), onclick: () => { p.fit = 'contain'; saveBook(b); renderEdit(); }}, 'しゃしん ぜんたい'),
        el('button', {class: 'chip' + (p.fit === 'cover' ? ' on' : ''), onclick: () => { p.fit = 'cover'; saveBook(b); renderEdit(); }}, 'わく いっぱい'))) : null
  ), el('section', {class: 'card'},
    el('div', {class: 'pe-head'}, el('h3', {}, `${i + 1} ページめ の ことば`)),
    el('h4', {}, 'タイムライン（ことば と ま）'),
    tl,
    el('p', {class: 'note'}, '「ことば」に こえを つけると、さいせいの とき その もじが いろつきに なります。「ま」で ことばの あいだに じかんを あけられます（0.1秒 たんい）。'),
    cards,
    el('div', {class: 'row-btns'},
      el('button', {class: 'btn small', onclick: () => { p.items.push({id: uid(), type: 'text', text: '', clipId: null}); changed(); }}, '＋ ことば'),
      el('button', {class: 'btn small', onclick: () => { p.items.push({id: uid(), type: 'pause', sec: 0.5}); changed(); }}, '＋ ま'),
      el('button', {class: 'btn small ghost', onclick: async () => {
        const cur = p.items.filter(x => x.type === 'text').map(x => x.text).join('');
        const t = await promptBox('ぶんしょうを まとめて にゅうりょく', cur, {multiline: true, placeholder: '「。」や かいぎょうで じどうで くぎります'});
        if (t == null) return;
        if (p.items.some(x => x.clipId) && !await confirmBox('ことばを つくりなおしますか？', 'いまの ことばと こえの くみあわせは リセットされます。', {yes: 'つくりなおす', no: 'やめる'})) return;
        p.items = textToItems(t); changed();
      }}, 'ぶんしょうを まとめて にゅうりょく')),
    el('div', {class: 'preview-row'}, prevBtn)
  )];
}

/* =========================================================
   さいせい
   ========================================================= */
let pl = null, wake = null;
async function requestWake(){ try{ if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); }catch(e){} }
function releaseWake(){ if (wake){ wake.release().catch(() => {}); wake = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && pl) requestWake(); });

function showPlay(b){
  const v = $('#vPlay'); v.hidden = false;
  pl = {book: b, entries: [{kind: 'cover'}, ...b.pages.map(p => ({kind: 'page', p})), {kind: 'end'}], idx: 0, reading: false, anim: false, land: isLand()};
  const stage = el('div', {class: 'stage'});
  const readBtn = el('button', {class: 'read-btn', onclick: readCurrent}, 'おんどく');
  const prev = el('button', {class: 'nav prev', 'aria-label': 'もどる', onclick: () => turn(-1)}, el('span', {}, '‹'), el('small', {}, 'もどる'));
  const next = el('button', {class: 'nav next', 'aria-label': 'つぎへ', onclick: () => turn(1)}, el('span', {}, '›'), el('small', {}, 'つぎへ'));
  const ind = el('div', {class: 'p-ind'});
  v.replaceChildren(el('div', {class: 'player'},
    el('div', {class: 'p-top'},
      el('button', {class: 'icon-btn', 'aria-label': 'とじる', onclick: () => history.length > 1 ? history.back() : go('#/')}, '✕'),
      el('div', {class: 'p-title'}, b.title),
      orientBtn(),
      el('label', {class: 'auto'}, el('input', {type: 'checkbox', checked: !!prefs.autoTurn, onchange: e => setPref('autoTurn', e.target.checked)}), 'じどうで めくる')),
    el('div', {class: 'p-main'}, prev, stage, next),
    el('div', {class: 'p-bottom'}, readBtn, ind)));
  Object.assign(pl, {stage, readBtn, prev, next, ind});
  renderCurrent();
  updateNav();
  // スワイプでも めくれる
  let sx = 0, sy = 0;
  stage.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
  });
  requestWake();
  applyOrientation(true);
}
/* 絵（ひだり）と 文字（みぎ）を べつべつに つくる */
function picPart(en){
  const b = pl.book;
  if (en.kind === 'cover') return pictureNode(coverSrc(b), '');
  if (en.kind === 'end'){ const cs = coverSrc(b); return pictureNode(cs.mediaId ? cs : {svg: sceneSVG(END_SCENE)}); }
  return pictureNode(en.p);
}
function textPart(en){
  const b = pl.book;
  if (en.kind === 'cover') return el('div', {class: 'sheet-text'}, el('div', {class: 'cover-title'}, b.title || 'えほん'),
    el('div', {class: 'phrases'}, el('span', {class: 'ph', 'data-id': '__open'}, 'はじまり はじまり')));
  if (en.kind === 'end') return el('div', {class: 'sheet-text'}, el('div', {class: 'phrases big'}, el('span', {class: 'ph', 'data-id': '__end'}, 'おしまい')));
  const texts = en.p.items.filter(i => i.type === 'text' && i.text.trim());
  return el('div', {class: 'sheet-text'}, el('div', {class: 'phrases'}, texts.map(i => el('span', {class: 'ph', 'data-id': i.id}, i.text))));
}
const kcls = en => 'k-' + en.kind;
function buildSheet(en){ return el('div', {class: 'sheet ' + kcls(en)}, picPart(en), textPart(en)); }
const half = (side, en, part) => el('div', {class: `half ${side} ${kcls(en)}`}, part);
function buildSpread(L, R){
  return el('div', {class: 'spread'}, half('left', L, picPart(L)), half('right', R, textPart(R)));
}
function renderCurrent(){
  const en = pl.entries[pl.idx];
  pl.stage.classList.toggle('land', pl.land);
  pl.stage.replaceChildren(pl.land ? buildSpread(en, en) : buildSheet(en));
}
const landMQ = matchMedia('(orientation: landscape) and (min-width: 560px)');
const isLand = () => landMQ.matches;
landMQ.addEventListener('change', () => {
  if (!pl || pl.land === isLand()) return;
  if (pl.reading){ stopAudio(); setReading(false); }
  pl.land = isLand();
  if (!pl.anim) renderCurrent();
});
function entryItems(en){
  const b = pl.book;
  if (en.kind === 'cover') return [{id: '__open', type: 'text', text: 'はじまり はじまり', clipId: b.openingClipId}];
  if (en.kind === 'end') return [{id: '__end', type: 'text', text: 'おしまい', clipId: b.endingClipId}];
  return en.p.items;
}
function updateNav(){
  const last = pl.entries.length - 1;
  pl.prev.disabled = pl.idx === 0;
  pl.next.disabled = pl.idx === last;
  pl.ind.textContent = pl.idx === 0 ? 'ひょうし' : pl.idx === last ? 'おしまい' : `${pl.idx} / ${last - 1}`;
}
function setReading(on){
  pl.reading = on;
  pl.readBtn.disabled = on;
  pl.readBtn.textContent = on ? 'よんでいるよ…' : 'おんどく';
}
async function readCurrent(){
  if (!pl || pl.reading || pl.anim) return;
  const me = pl, idx = pl.idx;
  setReading(true);
  const find = id => pl && pl.stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const ok = await playItems(entryItems(pl.entries[idx]), {
    onStart: it => { const s = find(it.id); if (s){ s.classList.add('now'); s.scrollIntoView({block: 'nearest', behavior: 'smooth'}); } },
    onEnd: it => { const s = find(it.id); if (s) s.classList.remove('now'); },
  });
  if (pl !== me) return;
  pl.stage.querySelectorAll('.ph.now').forEach(s => s.classList.remove('now'));
  setReading(false);
  if (ok && prefs.autoTurn && idx < pl.entries.length - 1){
    await sleep(900);
    if (pl === me && pl.idx === idx && !pl.reading && prefs.autoTurn){ await turn(1); readCurrent(); }
  }
}
async function turn(dir){
  if (!pl || pl.anim) return;
  const ni = pl.idx + dir;
  if (ni < 0 || ni >= pl.entries.length) return;
  if (pl.reading){ stopAudio(); setReading(false); }
  pl.anim = true;
  const cur = pl.entries[pl.idx], nx = pl.entries[ni];
  if (pl.land){
    /* 見開き：紙を 1まい めくる（おもて＝いまのページ、うら＝つぎのページ） */
    let base, leaf;
    if (dir > 0){
      base = el('div', {class: 'spread'}, half('left', cur, picPart(cur)), half('right', nx, textPart(nx)));
      leaf = el('div', {class: 'leaf to-left'},
        el('div', {class: `face front half right ${kcls(cur)}`}, textPart(cur)),
        el('div', {class: `face back half left ${kcls(nx)}`}, picPart(nx)));
    } else {
      base = el('div', {class: 'spread'}, half('left', nx, picPart(nx)), half('right', cur, textPart(cur)));
      leaf = el('div', {class: 'leaf to-right'},
        el('div', {class: `face front half left ${kcls(cur)}`}, picPart(cur)),
        el('div', {class: `face back half right ${kcls(nx)}`}, textPart(nx)));
    }
    pl.stage.replaceChildren(base, leaf);
    pl.idx = ni; updateNav();
    await sleep(850);
    if (!pl) return;
    pl.anim = false;
    renderCurrent();
    return;
  }
  const old = pl.stage.querySelector('.sheet');
  const nw = buildSheet(nx);
  if (dir > 0){ pl.stage.insertBefore(nw, old); old.classList.add('turn-out'); }
  else { pl.stage.append(nw); nw.classList.add('turn-in'); }
  pl.idx = ni; updateNav();
  await sleep(720);
  if (!pl) return;
  old.remove(); nw.classList.remove('turn-in');
  pl.anim = false;
  if (pl.land) renderCurrent();
}

/* ===== 画面の向き（じぶんで えらぶ） ===== */
const wantLand = () => prefs.orient === 'landscape';
async function applyOrientation(allowFs){
  const so = screen.orientation;
  if (!so || !so.lock) return false;
  const o = wantLand() ? 'landscape' : 'portrait';
  try{ await so.lock(o); return true; }catch(e){}
  if ((allowFs || wantLand()) && !document.fullscreenElement && document.documentElement.requestFullscreen){
    try{ await document.documentElement.requestFullscreen({navigationUI: 'hide'}); }catch(e){ return false; }
    try{ await so.lock(o); return true; }catch(e){}
  }
  return false;
}
const orientLabel = () => wantLand() ? '↻ たてに する' : '↻ よこに する';
function orientBtn(){ return el('button', {class: 'orient-btn', onclick: toggleOrientation}, orientLabel()); }
async function toggleOrientation(){
  setPref('orient', wantLand() ? 'portrait' : 'landscape');
  document.querySelectorAll('.orient-btn').forEach(x => x.textContent = orientLabel());
  const ok = await applyOrientation(true);
  if (!ok && wantLand() !== isLand()) toast(`スマホを ${wantLand() ? 'よこ' : 'たて'}に むけてください`, 3000);
}
document.addEventListener('fullscreenchange', () => {
  // もどる そうさで 全画面が おわったら、たてに もどる
  if (!document.fullscreenElement && wantLand()){
    setPref('orient', 'portrait');
    document.querySelectorAll('.orient-btn').forEach(x => x.textContent = orientLabel());
  }
});

/* =========================================================
   せってい（バックアップ）
   ========================================================= */
async function openSettings(){
  let usage = '';
  try{
    const est = await navigator.storage.estimate();
    usage = `つかっている ようりょう：やく ${(est.usage / 1048576).toFixed(1)}MB`;
  }catch(e){}
  modal(close => el('div', {class: 'pad'},
    el('h2', {}, 'せってい'),
    el('p', {class: 'note'}, `えほん ${books.length}さつ・こえ ${clips.length}こ。${usage}`),
    el('p', {class: 'note'}, 'データは この スマホの 中だけに ほぞんされます。きしゅへんこうに そなえて、ときどき バックアップを かきだしておくと あんしんです。'),
    el('div', {class: 'menu'},
      el('button', {class: 'btn', onclick: exportAll}, 'バックアップを かきだす'),
      el('button', {class: 'btn', onclick: async () => { close(); await importAll(); }}, 'バックアップから もどす')),
    el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn ghost', onclick: () => close()}, 'とじる'))));
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function exportAll(){
  toast('じゅんびしています…', 60000);
  const media = await DB.all('media');
  const data = {
    app: 'ehon', version: 1, exported: new Date().toISOString(), books,
    clips: await Promise.all(clips.map(async c => ({...c, blob: await blobToDataUrl(c.blob)}))),
    media: await Promise.all(media.map(async m => ({id: m.id, blob: await blobToDataUrl(m.blob)}))),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], {type: 'application/json'}));
  const d = new Date();
  const a = el('a', {href: url, download: `ehon-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('バックアップを かきだしました');
}
async function importAll(){
  const f = await pickFile('application/json,.json');
  if (!f) return;
  let data;
  try{ data = JSON.parse(await f.text()); if (data.app !== 'ehon') throw 0; }
  catch(e){ toast('バックアップファイルを よみこめませんでした', 3000); return; }
  if (!await confirmBox('バックアップから もどしますか？', 'いまの えほんと こえは すべて おきかわります。', {yes: 'もどす', no: 'やめる'})) return;
  toast('もどしています…', 60000);
  const toBlob = u => fetch(u).then(r => r.blob());
  for (const s of ['books', 'clips', 'media']) await DB.clear(s);
  for (const m of data.media || []) await DB.put('media', {id: m.id, blob: await toBlob(m.blob)});
  for (const c of data.clips || []) await DB.put('clips', {...c, blob: await toBlob(c.blob)});
  for (const b of data.books || []) await DB.put('books', b);
  mediaUrls.forEach(u => URL.revokeObjectURL(u)); mediaUrls.clear();
  books = await DB.all('books'); clips = await DB.all('clips');
  go('#/'); toast('もどしました');
}

/* ===== 起動 ===== */
(async () => {
  db = await openDB();
  books = await DB.all('books');
  clips = await DB.all('clips');
  route();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
