'use strict';
/* =========================================================
   どうが（MP4）書き出し
   ・絵本を じどうで よみきかせした ようすを キャンバスに えがき、
     こえと いっしょに MediaRecorder で ろくがする（ネット不要）
   ========================================================= */
const VIDEO_MIMES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
function pickVideoMime(){
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const m of VIDEO_MIMES){ try{ if (MediaRecorder.isTypeSupported(m)) return m; }catch(e){} }
  return null;
}
const V_FONT = '"Hiragino Maru Gothic ProN","Zen Maru Gothic","M PLUS Rounded 1c",system-ui,sans-serif';
const V_LEAD = 0.7, V_TAIL = 1.0, V_TURN = 0.9;
const fmtClock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function vEntries(b){ return [{kind: 'cover'}, ...b.pages.map(p => ({kind: 'page', p})), {kind: 'end'}]; }
function vItems(b, en){
  if (en.kind === 'cover') return [{id: '__open', type: 'text', text: 'はじまり はじまり', clipId: b.openingClipId}];
  if (en.kind === 'end') return [{id: '__end', type: 'text', text: 'おしまい', clipId: b.endingClipId}];
  return en.p.items;
}
/* じかんの ながれ（どのページを・いつ・どの ことばを よむか）を さきに きめる */
function buildVideoTimeline(b, entries){
  const spans = [], hls = [], plays = [], turns = [];
  let t = 0.4;
  entries.forEach((en, k) => {
    if (k > 0){ turns.push({from: k - 1, to: k, start: t, dur: V_TURN}); t += V_TURN; }
    const s = t; t += V_LEAD;
    for (const it of vItems(b, en)){
      if (it.type === 'pause'){ t += it.sec; continue; }
      const c = clipById(it.clipId);
      if (!c && !(it.text || '').trim()) continue;
      const d = c ? c.dur : estDur(it.text);
      hls.push({k, id: it.id, start: t, end: t + d});
      if (c) plays.push({clip: c, start: t});
      t += d;
    }
    t += en.kind === 'end' ? 2.2 : V_TAIL;
    spans.push({k, start: s, end: t});
  });
  return {spans, hls, plays, turns, total: t + 0.3};
}

/* ===== 文字の レイアウト ===== */
function vParas(b, en){
  if (en.kind === 'cover') return [
    {segs: [{t: b.title || 'えほん', id: null}], size: 1.35, align: 'center'},
    {segs: [{t: 'はじまり はじまり', id: '__open'}], size: 0.8, align: 'center', color: '#8a7d72', gap: 0.5},
  ];
  if (en.kind === 'end') return [{segs: [{t: 'おしまい', id: '__end'}], size: 1.8, align: 'center'}];
  return [{segs: en.p.items.filter(i => i.type === 'text' && i.text.trim()).map(i => ({t: i.text, id: i.id})), size: 1, align: 'left'}];
}
function vLayout(ctx, paras, w, h, maxF){
  const NO_HEAD = /[。、！？!?」』）・ー〜ぁぃぅぇぉっゃゅょ]/;
  const fit = f => {
    const lines = []; let total = 0, maxW = 0, orphan = false;
    for (const pa of paras){
      const fs = f * pa.size, lh = fs * 1.7;
      ctx.font = `700 ${fs}px ${V_FONT}`;
      const mk = () => ({chars: [], w: 0, fs, lh, align: pa.align, color: pa.color, gapBefore: 0});
      let line = mk();
      if (pa.gap){ line.gapBefore = fs * pa.gap; total += line.gapBefore; }
      const push = () => { lines.push(line); total += lh; maxW = Math.max(maxW, line.w); line = mk(); };
      for (const sg of pa.segs) for (const ch of [...sg.t]){
        if (ch === '\n'){ push(); continue; }
        const cw = ctx.measureText(ch).width;
        if (line.w + cw > w && line.chars.length && !NO_HEAD.test(ch)) push();
        line.chars.push({ch, id: sg.id, w: cw}); line.w += cw;
      }
      if (line.chars.length || !lines.length) push();
      const mine = lines.slice(-1)[0];
      if (mine && mine.chars.length === 1 && lines.length > 1 && lines[lines.length - 2].fs === fs) orphan = true;
    }
    return {lines, total, maxW, orphan};
  };
  let lo = 10, hi = maxF, best = fit(lo);
  for (let i = 0; i < 12; i++){
    const mid = (lo + hi) / 2, r = fit(mid);
    if (r.total <= h && r.maxW <= w * 1.04 && (!r.orphan || mid < 22)){ best = r; lo = mid; } else hi = mid;
  }
  return best;
}
function vRound(ctx, x, y, w, h, r){
  ctx.beginPath();
  if (ctx.roundRect){ ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function vDrawText(ctx, lay, x, y, w, h, hl, middle){
  let cy = y + (middle ? Math.max(0, (h - lay.total) / 2) : 0);
  ctx.textBaseline = 'middle';
  for (const ln of lay.lines){
    cy += ln.gapBefore;
    ctx.font = `700 ${ln.fs}px ${V_FONT}`;
    const cx = x + (ln.align === 'center' ? (w - ln.w) / 2 : 0), base = cy + ln.lh / 2;
    let rx = null, rw = 0, xx = cx;
    const flush = () => {
      if (rx === null) return;
      ctx.fillStyle = '#ffe066';
      vRound(ctx, rx - ln.fs * 0.12, base - ln.fs * 0.66, rw + ln.fs * 0.24, ln.fs * 1.32, ln.fs * 0.22); ctx.fill();
      rx = null; rw = 0;
    };
    for (const c of ln.chars){ if (hl && c.id === hl){ if (rx === null) rx = xx; rw += c.w; } else flush(); xx += c.w; }
    flush();
    xx = cx;
    for (const c of ln.chars){
      ctx.fillStyle = hl && c.id === hl ? '#c2410c' : (ln.color || '#3a2f28');
      ctx.fillText(c.ch, xx, base); xx += c.w;
    }
    cy += ln.lh;
  }
}
function vDrawFit(ctx, img, x, y, w, h, fit){
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  if (!iw || !ih) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}
async function vLoadImage(src){
  try{
    if (src && src.mediaId){
      const m = await DB.get('media', src.mediaId);
      if (m) return await createImageBitmap(m.blob, {imageOrientation: 'from-image'});
    } else if (src && src.svg){
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src.svg.replace('<svg ', '<svg width="800" height="600" '));
      await img.decode();
      return img;
    }
  }catch(e){}
  return null;
}
function vPicSrc(b, en){
  if (en.kind === 'cover') return coverSrc(b);
  if (en.kind === 'end'){ const cs = coverSrc(b); return cs.mediaId ? cs : {svg: sceneSVG(END_SCENE), fit: 'cover'}; }
  return {mediaId: en.p.mediaId, svg: en.p.svg, fit: en.p.fit};
}
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/* ===== 1まいずつの ページ画像を じゅんび ===== */
async function prepareVideo(b, orient, onStep){
  const land = orient !== 'portrait';
  const G = land
    ? {W: 1280, H: 720, bx: 56, by: 44, bw: 1168, bh: 632}
    : {W: 720, H: 1280, bx: 36, by: 56, bw: 648, bh: 1168};
  const entries = vEntries(b);
  const tl = buildVideoTimeline(b, entries);
  const meas = mkCanvas(10, 10).getContext('2d');
  const pages = [];
  for (let k = 0; k < entries.length; k++){
    onStep && onStep(k, entries.length);
    const en = entries[k], src = vPicSrc(b, en), img = await vLoadImage(src);
    const fit = src.fit || (src.svg ? 'cover' : 'contain');
    const paras = vParas(b, en);
    if (land){
      const hw = G.bw / 2;
      // ひだり（え）
      const L = mkCanvas(hw, G.bh), lc = L.getContext('2d');
      lc.fillStyle = '#fffdf8'; vRound(lc, 0, 0, hw + 20, G.bh, 16); lc.fill();
      if (img) vDrawFit(lc, img, 22, 22, hw - 44, G.bh - 44, fit);
      else { lc.fillStyle = '#fbf1e2'; lc.fillRect(22, 22, hw - 44, G.bh - 44); }
      const gL = lc.createLinearGradient(hw - 46, 0, hw, 0);
      gL.addColorStop(0, 'rgba(80,50,20,0)'); gL.addColorStop(1, 'rgba(80,50,20,.28)');
      lc.fillStyle = gL; lc.fillRect(hw - 46, 0, 46, G.bh);
      // みぎ（もじ）
      const Rp = mkCanvas(hw, G.bh), rc = Rp.getContext('2d');
      rc.fillStyle = '#fffdf8'; vRound(rc, -20, 0, hw + 20, G.bh, 16); rc.fill();
      const gR = rc.createLinearGradient(0, 0, 46, 0);
      gR.addColorStop(0, 'rgba(80,50,20,.28)'); gR.addColorStop(1, 'rgba(80,50,20,0)');
      rc.fillStyle = gR; rc.fillRect(0, 0, 46, G.bh);
      const ta = {x: 52, y: 48, w: hw - 52 - 40, h: G.bh - 96};
      const lay = vLayout(meas, paras, ta.w, ta.h, 54);
      const R = mkCanvas(hw, G.bh), rr = R.getContext('2d');
      rr.drawImage(Rp, 0, 0); vDrawText(rr, lay, ta.x, ta.y, ta.w, ta.h, null, true);
      pages.push({L, Rp, R, lay, ta});
    } else {
      const P = mkCanvas(G.bw, G.bh), pc = P.getContext('2d');
      pc.fillStyle = '#fffdf8'; vRound(pc, 0, 0, G.bw, G.bh, 18); pc.fill();
      const pw = G.bw - 48, ph = Math.round(pw * 3 / 4);
      if (img) vDrawFit(pc, img, 24, 24, pw, ph, fit);
      else { pc.fillStyle = '#fbf1e2'; pc.fillRect(24, 24, pw, ph); }
      const gS = pc.createLinearGradient(0, 0, 24, 0);
      gS.addColorStop(0, 'rgba(80,50,20,.22)'); gS.addColorStop(1, 'rgba(80,50,20,0)');
      pc.fillStyle = gS; pc.fillRect(0, 0, 24, G.bh);
      const ta = {x: 44, y: 24 + ph + 36, w: G.bw - 88, h: G.bh - (24 + ph + 36) - 44};
      const lay = vLayout(meas, paras, ta.w, ta.h, 56);
      const F = mkCanvas(G.bw, G.bh), fc = F.getContext('2d');
      fc.drawImage(P, 0, 0); vDrawText(fc, lay, ta.x, ta.y, ta.w, ta.h, null, en.kind !== 'page');
      pages.push({P, F, lay, ta, middle: en.kind !== 'page'});
    }
  }
  return {land, G, entries, tl, pages};
}

/* ===== ある じこくの 1コマを えがく ===== */
function drawVideoFrame(ctx, V, t){
  const {G, tl, pages, land} = V;
  ctx.fillStyle = '#e9d5b5'; ctx.fillRect(0, 0, G.W, G.H);
  const shadow = () => { ctx.save(); ctx.shadowColor = 'rgba(80,50,20,.35)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 8; ctx.fillStyle = '#fffdf8'; vRound(ctx, G.bx, G.by, G.bw, G.bh, 16); ctx.fill(); ctx.restore(); };
  shadow();
  const ease = p => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const turn = tl.turns.find(x => t >= x.start && t < x.start + x.dur);
  if (turn){
    const p = ease((t - turn.start) / turn.dur), a = pages[turn.from], b = pages[turn.to];
    if (land){
      const hw = G.bw / 2, sx = G.bx + hw;
      ctx.drawImage(a.L, G.bx, G.by); ctx.drawImage(b.R, sx, G.by);
      let x, w, img;
      if (p < .5){ w = hw * Math.cos(p * Math.PI); x = sx; img = a.R; }
      else { w = hw * -Math.cos(p * Math.PI); x = sx - w; img = b.L; }
      if (w > 1){
        ctx.drawImage(img, x, G.by, w, G.bh);
        ctx.fillStyle = `rgba(60,40,20,${0.22 * Math.sin(p * Math.PI)})`; ctx.fillRect(x, G.by, w, G.bh);
      }
    } else {
      ctx.drawImage(b.F, G.bx, G.by);
      const w = G.bw * Math.cos(p * Math.PI / 2);
      if (w > 1){
        ctx.save(); ctx.shadowColor = 'rgba(80,50,20,.3)'; ctx.shadowBlur = 20;
        ctx.drawImage(a.F, G.bx, G.by, w, G.bh); ctx.restore();
        ctx.fillStyle = `rgba(60,40,20,${0.25 * p})`; ctx.fillRect(G.bx, G.by, w, G.bh);
      }
    }
    return;
  }
  let span = tl.spans.find(s => t >= s.start && t < s.end) || (t < tl.spans[0].start ? tl.spans[0] : tl.spans[tl.spans.length - 1]);
  const k = span.k, pg = pages[k];
  const h = tl.hls.find(x => x.k === k && t >= x.start && t < x.end);
  if (land){
    const hw = G.bw / 2;
    ctx.drawImage(pg.L, G.bx, G.by);
    if (h){ ctx.drawImage(pg.Rp, G.bx + hw, G.by); ctx.save(); ctx.translate(G.bx + hw, G.by); vDrawText(ctx, pg.lay, pg.ta.x, pg.ta.y, pg.ta.w, pg.ta.h, h.id, true); ctx.restore(); }
    else ctx.drawImage(pg.R, G.bx + hw, G.by);
  } else {
    if (h){ ctx.drawImage(pg.P, G.bx, G.by); ctx.save(); ctx.translate(G.bx, G.by); vDrawText(ctx, pg.lay, pg.ta.x, pg.ta.y, pg.ta.w, pg.ta.h, h.id, pg.middle); ctx.restore(); }
    else ctx.drawImage(pg.F, G.bx, G.by);
  }
}

/* ===== ろくが ===== */
async function recordVideo(V, canvas, {withSound, mime, onProgress, isCancelled}){
  const ctx = canvas.getContext('2d');
  const A = ac();
  const dest = A.createMediaStreamDestination();
  const out = A.createGain(); out.connect(dest);
  if (withSound) out.connect(A.destination);
  const bufs = new Map();
  for (const pl of V.tl.plays) if (!bufs.has(pl.clip.id))
    bufs.set(pl.clip.id, await A.decodeAudioData(await pl.clip.blob.arrayBuffer()));
  drawVideoFrame(ctx, V, 0);
  const vs = canvas.captureStream(30);
  const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 3500000, audioBitsPerSecond: 128000});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const t0 = A.currentTime + 0.3;
  const srcs = V.tl.plays.map(pl => { const s = A.createBufferSource(); s.buffer = bufs.get(pl.clip.id); s.connect(out); s.start(t0 + pl.start); return s; });
  await new Promise(res => {
    const tick = () => {
      if (isCancelled()) return res();
      const t = A.currentTime - t0;
      drawVideoFrame(ctx, V, Math.max(0, t));
      onProgress(Math.min(1, Math.max(0, t) / V.tl.total), Math.max(0, t));
      if (t >= V.tl.total) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  srcs.forEach(s => { try{ s.stop(); }catch(e){} });
  await new Promise(r => { rec.onstop = r; try{ rec.stop(); }catch(e){ r(); } });
  vs.getTracks().forEach(tk => tk.stop());
  try{ out.disconnect(); }catch(e){}
  if (isCancelled()) return null;
  return new Blob(chunks, {type: mime.split(';')[0]});
}

/* ===== がめん ===== */
function openVideoExport(b){
  stopAudio();
  const mime = pickVideoMime();
  const isMp4 = !!mime && mime.startsWith('video/mp4');
  const tl0 = buildVideoTimeline(b, vEntries(b));
  let orient = prefs.videoOrient || 'landscape', withSound = false, cancelled = false, hiddenDuring = false, resultUrl = null;
  return modal((close, d) => {
    const body = el('div', {class: 'pad'});
    const setBody = (...k) => body.replaceChildren(...k.flat().filter(x => x != null && x !== false));
    const onHide = () => { if (document.hidden) hiddenDuring = true; };
    d.addEventListener('cleanup', () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onHide);
      if (resultUrl) setTimeout(() => URL.revokeObjectURL(resultUrl), 60000);
      if (!pl) releaseWake();
    });

    const settings = () => {
      const chips = el('div', {class: 'chips'},
        el('button', {class: 'chip' + (orient === 'landscape' ? ' on' : ''), onclick: () => { orient = 'landscape'; settings(); }}, 'よこ（みひらき）'),
        el('button', {class: 'chip' + (orient === 'portrait' ? ' on' : ''), onclick: () => { orient = 'portrait'; settings(); }}, 'たて'));
      setBody(
        el('h2', {}, 'どうがに かきだす'),
        el('p', {class: 'note'}, `「${b.title}」を じどうで よみきかせした どうがを つくります。こえ・もじの いろつき・ページめくりが はいります。`),
        el('div', {class: 'field'}, el('label', {}, 'むき'), chips),
        el('label', {class: 'chk-row'}, el('input', {type: 'checkbox', checked: withSound, onchange: e => withSound = e.target.checked}), 'つくっている あいだ おとを ながす'),
        el('div', {class: 'vinfo'},
          el('div', {}, `どうがの ながさ：やく ${fmtClock(tl0.total)}`),
          el('div', {}, `ファイルの しゅるい：${!mime ? 'つくれません' : isMp4 ? 'MP4' : 'WebM'}`)),
        !mime ? el('p', {class: 'warn'}, 'この スマホ（ブラウザ）では どうがを つくれません。Chrome や Safari を さいしんに してください。')
          : !isMp4 ? el('p', {class: 'warn'}, 'この スマホでは MP4 が つくれないため、WebM けいしきで ほぞんします。') : null,
        el('p', {class: 'note'}, 'かきだしには どうがと おなじ じかんが かかります。おわるまで この がめんを ひらいたままに してください（ほかの アプリに きりかえると うまく つくれません）。'),
        el('div', {class: 'foot'}, el('span'), el('div', {class: 'r'},
          el('button', {class: 'btn ghost', onclick: () => close()}, 'キャンセル'),
          el('button', {class: 'btn fill', disabled: !mime, onclick: start}, 'かきだす'))));
    };

    async function start(){
      setPref('videoOrient', orient);
      ac();   // タップした ときに おとを ゆるす
      const canvas = el('canvas', {class: 'vcanvas'});
      const bar = el('div', {class: 'vbar-in'});
      const lbl = el('div', {class: 'vtime'}, 'じゅんびちゅう…');
      setBody(el('h2', {}, 'どうがを つくっています'), canvas,
        el('div', {class: 'vbar'}, bar), lbl,
        el('p', {class: 'note'}, 'がめんを けさずに おまちください。'),
        el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn danger', onclick: () => { cancelled = true; close(); }}, 'とめる')));
      document.addEventListener('visibilitychange', onHide);
      requestWake();
      let V;
      try{
        V = await prepareVideo(b, orient, (k, n) => lbl.textContent = `じゅんびちゅう… ${k + 1} / ${n}`);
      }catch(e){ console.error(e); toast('じゅんびに しっぱいしました', 3000); close(); return; }
      if (cancelled) return;
      canvas.width = V.G.W; canvas.height = V.G.H;
      canvas.classList.toggle('tall', !V.land);
      let blob;
      try{
        blob = await recordVideo(V, canvas, {withSound, mime, isCancelled: () => cancelled,
          onProgress: (p, t) => { bar.style.width = `${(p * 100).toFixed(1)}%`; lbl.textContent = `${fmtClock(t)} / ${fmtClock(V.tl.total)}`; }});
      }catch(e){ console.error(e); toast('どうがを つくれませんでした', 3000); close(); return; }
      if (!blob || cancelled) return;
      done(blob);
    }

    function done(blob){
      const ext = blob.type === 'video/mp4' ? 'mp4' : 'webm';
      const name = `${(b.title || 'えほん').replace(/[\\/:*?"<>|\s]+/g, '_')}.${ext}`;
      resultUrl = URL.createObjectURL(blob);
      const file = new File([blob], name, {type: blob.type});
      const canShare = !!(navigator.canShare && navigator.canShare({files: [file]}));
      const video = el('video', {class: 'vprev', src: resultUrl, controls: true, playsinline: true});
      setBody(
        el('h2', {}, 'どうがが できました'),
        video,
        el('div', {class: 'vinfo'}, `${name}（${(blob.size / 1048576).toFixed(1)}MB）`),
        hiddenDuring ? el('p', {class: 'warn'}, 'とちゅうで がめんが きりかわったため、どうがの いちぶが とまっている かもしれません。きになる ときは もういちど かきだしてください。') : null,
        el('div', {class: 'menu'},
          el('a', {class: 'btn fill', href: resultUrl, download: name, style: 'text-align:center;text-decoration:none'}, 'スマホに ほぞんする'),
          canShare ? el('button', {class: 'btn', onclick: async () => {
            try{ await navigator.share({files: [file], title: b.title}); }catch(e){}
          }}, 'きょうゆう／しゃしんアプリに ほぞん') : null),
        el('p', {class: 'note'}, 'iPhone は「きょうゆう」→「ビデオを保存」で しゃしんアプリに はいります。Android の「ほぞん」は「ダウンロード」フォルダに はいります。'),
        el('div', {class: 'foot'}, el('span'), el('button', {class: 'btn ghost', onclick: () => close()}, 'とじる')));
    }

    settings();
    return body;
  }, {cls: 'full'});
}
