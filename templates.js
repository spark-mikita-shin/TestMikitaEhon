'use strict';
/* ===== テンプレートのイラスト（SVGで描画。画像ファイル不要・オフラインでも表示） ===== */
const SCENE = {
  sun(x, y, s = 1){
    let r = '';
    for (let i = 0; i < 8; i++){
      const a = i * Math.PI / 4;
      r += `<line x1="${x + Math.cos(a) * 38 * s}" y1="${y + Math.sin(a) * 38 * s}" x2="${x + Math.cos(a) * 50 * s}" y2="${y + Math.sin(a) * 50 * s}" stroke="#FFB627" stroke-width="${6 * s}" stroke-linecap="round"/>`;
    }
    return r + `<circle cx="${x}" cy="${y}" r="${30 * s}" fill="#FFC93C"/>`;
  },
  moon(x, y, s = 1, o){
    return `<circle cx="${x}" cy="${y}" r="${30 * s}" fill="#FFE9A8"/><circle cx="${x + 14 * s}" cy="${y - 8 * s}" r="${26 * s}" fill="${o.sky}"/>`;
  },
  star(x, y, s = 1){
    let d = '';
    for (let i = 0; i < 10; i++){
      const r = (i % 2 ? 6 : 14) * s, a = -Math.PI / 2 + i * Math.PI / 5;
      d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
    }
    return `<path d="${d}Z" fill="#FFE066" stroke="#FFD43B" stroke-width="${2 * s}" stroke-linejoin="round"/>`;
  },
  cloud(x, y, s = 1, col = '#ffffff'){
    return `<g fill="${col}"><circle cx="${x}" cy="${y}" r="${22 * s}"/><circle cx="${x + 26 * s}" cy="${y - 12 * s}" r="${27 * s}"/><circle cx="${x + 54 * s}" cy="${y}" r="${21 * s}"/><rect x="${x}" y="${y - 2 * s}" width="${54 * s}" height="${23 * s}" rx="${8 * s}"/></g>`;
  },
  rain(x, y, w = 200){
    let r = '';
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < w / 34; i++){
        const px = x + i * 34 + (row % 2) * 17, py = y + row * 32;
        r += `<line x1="${px}" y1="${py}" x2="${px - 5}" y2="${py + 14}" stroke="#6fa8dc" stroke-width="4" stroke-linecap="round"/>`;
      }
    return r;
  },
  rainbow(x, y, r = 150){
    const cols = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'];
    return cols.map((c, i) => {
      const rr = r - i * 11;
      return `<path d="M${x - rr} ${y} A${rr} ${rr} 0 0 1 ${x + rr} ${y}" fill="none" stroke="${c}" stroke-width="11"/>`;
    }).join('');
  },
  tree(x, y, s = 1){
    return `<rect x="${x - 7 * s}" y="${y - 40 * s}" width="${14 * s}" height="${44 * s}" rx="${4 * s}" fill="#9c6b3f"/>
      <g fill="#5cb85c"><circle cx="${x}" cy="${y - 62 * s}" r="${28 * s}"/><circle cx="${x - 22 * s}" cy="${y - 45 * s}" r="${20 * s}"/><circle cx="${x + 22 * s}" cy="${y - 45 * s}" r="${20 * s}"/></g>`;
  },
  flower(x, y, s = 1, col = '#ff8fab'){
    let r = `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 30 * s}" stroke="#4c9a4c" stroke-width="${4 * s}"/>`;
    for (let i = 0; i < 5; i++){
      const a = i * Math.PI * 2 / 5;
      r += `<circle cx="${x + Math.cos(a) * 9 * s}" cy="${y - 34 * s + Math.sin(a) * 9 * s}" r="${7 * s}" fill="${col}"/>`;
    }
    return r + `<circle cx="${x}" cy="${y - 34 * s}" r="${5 * s}" fill="#ffd43b"/>`;
  },
  house(x, y, s = 1, lit = false){
    return `<rect x="${x - 40 * s}" y="${y - 50 * s}" width="${80 * s}" height="${50 * s}" fill="#fff3d6"/>
      <path d="M${x - 50 * s} ${y - 48 * s} L${x} ${y - 88 * s} L${x + 50 * s} ${y - 48 * s}Z" fill="#e76f51"/>
      <rect x="${x - 28 * s}" y="${y - 28 * s}" width="${18 * s}" height="${28 * s}" rx="${3 * s}" fill="#9c6b3f"/>
      <rect x="${x + 6 * s}" y="${y - 38 * s}" width="${22 * s}" height="${18 * s}" rx="${3 * s}" fill="${lit ? '#ffd43b' : '#a5d8ff'}"/>`;
  },
  bear(x, y, s = 1, mood = 'happy'){
    const B = '#b07a4e', L = '#ecd0a8';
    const eyes = mood === 'sleep'
      ? `<path d="M${x - 15 * s} ${y - 12 * s} q4 ${4 * s} 8 0 M${x + 7 * s} ${y - 12 * s} q4 ${4 * s} 8 0" stroke="#3a2f28" stroke-width="${2.5 * s}" fill="none" stroke-linecap="round"/>`
      : `<circle cx="${x - 11 * s}" cy="${y - 12 * s}" r="${3.8 * s}" fill="#3a2f28"/><circle cx="${x + 11 * s}" cy="${y - 12 * s}" r="${3.8 * s}" fill="#3a2f28"/>`;
    return `<ellipse cx="${x}" cy="${y + 34 * s}" rx="${30 * s}" ry="${32 * s}" fill="${B}"/>
      <ellipse cx="${x}" cy="${y + 38 * s}" rx="${18 * s}" ry="${20 * s}" fill="${L}"/>
      <circle cx="${x - 24 * s}" cy="${y - 30 * s}" r="${11 * s}" fill="${B}"/><circle cx="${x + 24 * s}" cy="${y - 30 * s}" r="${11 * s}" fill="${B}"/>
      <circle cx="${x - 24 * s}" cy="${y - 30 * s}" r="${6 * s}" fill="${L}"/><circle cx="${x + 24 * s}" cy="${y - 30 * s}" r="${6 * s}" fill="${L}"/>
      <circle cx="${x}" cy="${y - 6 * s}" r="${30 * s}" fill="${B}"/>
      <ellipse cx="${x}" cy="${y + 5 * s}" rx="${13 * s}" ry="${10 * s}" fill="${L}"/>
      <ellipse cx="${x}" cy="${y}" rx="${5 * s}" ry="${3.5 * s}" fill="#3a2f28"/>
      <path d="M${x - 5 * s} ${y + 7 * s} q${5 * s} ${5 * s} ${10 * s} 0" stroke="#3a2f28" stroke-width="${2 * s}" fill="none" stroke-linecap="round"/>
      <circle cx="${x - 20 * s}" cy="${y + 2 * s}" r="${5 * s}" fill="#ff9aa2" opacity=".6"/><circle cx="${x + 20 * s}" cy="${y + 2 * s}" r="${5 * s}" fill="#ff9aa2" opacity=".6"/>
      ${eyes}`;
  },
  blanket(x, y, s = 1){
    return `<rect x="${x - 70 * s}" y="${y + 12 * s}" width="${140 * s}" height="${60 * s}" rx="${14 * s}" fill="#a5d8ff"/>
      <g fill="#ffffff" opacity=".7">${[0, 1, 2, 3, 4].map(i => `<circle cx="${x - 50 * s + i * 25 * s}" cy="${y + 40 * s}" r="${4 * s}"/>`).join('')}</g>
      <rect x="${x - 70 * s}" y="${y + 12 * s}" width="${140 * s}" height="${12 * s}" rx="${6 * s}" fill="#ffffff"/>`;
  },
  zzz(x, y){
    return `<text x="${x}" y="${y}" font-size="26" font-weight="700" fill="#ffffff" font-family="sans-serif">Z<tspan font-size="20" dy="-10">z</tspan><tspan font-size="15" dy="-10">z</tspan></text>`;
  },
};

function sceneSVG(o){
  if (!o) return null;
  const parts = [`<rect width="400" height="300" fill="${o.sky || '#cfeaff'}"/>`];
  if (o.ground) parts.push(`<path d="M0 232 Q100 202 200 224 T400 216 V300 H0Z" fill="${o.ground}"/>`);
  for (const [type, ...args] of (o.items || [])) parts.push(SCENE[type](...args, o));
  return `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">${parts.join('')}</svg>`;
}

/* ===== テンプレート（オリジナルのおはなし） ===== */
const TEMPLATES = [
  {
    id: 'kuma', title: 'くまくんの おさんぽ', desc: 'はれ・あめ・にじ。5ページの おはなし',
    cover: {sky: '#bfe6ff', ground: '#9bd57a', items: [['sun', 330, 60, .9], ['cloud', 50, 60, .8], ['tree', 70, 228, 1], ['bear', 200, 190, 1.3]]},
    pages: [
      {text: 'あさです。くまくんは げんきに めを さましました。', scene: {sky: '#ffe8c2', ground: '#a7d88a', items: [['sun', 80, 70, 1], ['house', 305, 228, 1.1], ['bear', 185, 195, 1.2]]}},
      {text: 'おそとへ でかけよう！ おはなが いっぱい さいています。', scene: {sky: '#bfe6ff', ground: '#9bd57a', items: [['sun', 330, 55, .8], ['flower', 60, 262, 1, '#ff8fab'], ['flower', 105, 272, .8, '#ffd43b'], ['flower', 300, 270, .9, '#b197fc'], ['flower', 345, 262, 1, '#ff8fab'], ['bear', 205, 195, 1.2]]}},
      {text: 'あれれ、くもが でてきたよ。ぽつぽつ あめが ふってきました。', scene: {sky: '#cfd8e3', ground: '#8fc27a', items: [['cloud', 60, 60, 1.2, '#eef1f5'], ['cloud', 230, 50, 1.1, '#eef1f5'], ['rain', 50, 105, 320], ['tree', 330, 232, 1.1], ['bear', 170, 200, 1.2]]}},
      {text: 'あめが やむと、おそらに おおきな にじが かかりました。', scene: {sky: '#c7ecff', ground: '#9bd57a', items: [['rainbow', 200, 235, 170], ['cloud', 20, 210, .9], ['cloud', 330, 210, .9], ['bear', 200, 205, 1.1]]}},
      {text: 'くまくんは にっこり。また あした、おさんぽ しようね。', scene: {sky: '#ffd2a8', ground: '#94c973', items: [['sun', 200, 215, 1.2], ['house', 325, 232, 1], ['tree', 70, 232, 1], ['bear', 190, 200, 1.2]]}},
    ],
  },
  {
    id: 'tsuki', title: 'おつきさまと おほしさま', desc: 'ねるまえに よみたい 4ページ',
    cover: {sky: '#2b3a67', ground: '#3d5a80', items: [['moon', 300, 80, 1.1], ['star', 80, 60, 1], ['star', 150, 110, .7], ['star', 220, 45, .8], ['house', 150, 238, 1.2, true]]},
    pages: [
      {text: 'よるに なりました。おそらに おつきさまが のぼります。', scene: {sky: '#3b4a7a', ground: '#41618a', items: [['moon', 290, 85, 1.2], ['house', 130, 238, 1.1, true], ['tree', 320, 238, 1]]}},
      {text: 'ひとつ、ふたつ、みっつ。おほしさまが きらきら ひかります。', scene: {sky: '#26335c', items: [['star', 90, 90, 1.3], ['star', 200, 60, 1.1], ['star', 310, 110, 1.4], ['star', 150, 185, .9], ['star', 275, 205, 1], ['moon', 70, 235, .8]]}},
      {text: 'くまくんも あったかい おふとんに はいりました。', scene: {sky: '#2f3d6b', items: [['moon', 335, 60, .8], ['star', 60, 50, .7], ['bear', 200, 140, 1.4, 'sleep'], ['blanket', 200, 150, 1.4], ['zzz', 250, 80]]}},
      {text: 'みんな ぐっすり。おやすみなさい。', scene: {sky: '#1f2a4d', ground: '#33507a', items: [['moon', 200, 80, 1.2], ['star', 80, 60, .8], ['star', 320, 70, .8], ['house', 95, 238, .9, true], ['house', 300, 242, .8, true]]}},
    ],
  },
  {
    id: 'ichinichi', title: 'ぼく・わたしの いちにち', desc: 'しゃしんを いれて つくる 4ページ',
    cover: {sky: '#ffe3ec', ground: '#b5e48c', items: [['sun', 320, 70, .9], ['house', 120, 236, 1.2], ['flower', 260, 272, 1, '#ff8fab'], ['flower', 300, 278, .8, '#ffd43b']]},
    pages: [
      {text: 'あさ、○○は げんきに おきました。', scene: {sky: '#fff0c9', ground: '#b5e48c', items: [['sun', 90, 80, 1.1], ['house', 270, 236, 1.2]]}},
      {text: 'ひるは こうえんで あそびました。たのしかったね。', scene: {sky: '#c5f0ff', ground: '#9bd57a', items: [['sun', 330, 55, .8], ['tree', 90, 236, 1.2], ['tree', 300, 240, 1], ['flower', 190, 275, 1, '#ff8fab']]}},
      {text: 'よるごはんは ○○。おいしかったね。', scene: {sky: '#ffbe98', ground: '#94c973', items: [['sun', 200, 225, 1.1], ['house', 200, 238, 1.3, true]]}},
      {text: 'おふろに はいって、おやすみなさい。', scene: {sky: '#2f3d6b', items: [['moon', 320, 70, .9], ['star', 80, 70, .8], ['bear', 190, 140, 1.4, 'sleep'], ['blanket', 190, 150, 1.4], ['zzz', 240, 80]]}},
    ],
  },
  {
    id: 'blank', title: 'あたらしい えほん', desc: 'しろい ページから じゆうに つくる',
    cover: null,
    pages: [{text: ''}, {text: ''}, {text: ''}],
  },
];

const END_SCENE = {sky: '#fff1d6', items: [['star', 70, 70, 1], ['star', 330, 80, 1.1], ['star', 120, 210, .7], ['star', 290, 220, .8], ['bear', 200, 120, 1.4]]};
