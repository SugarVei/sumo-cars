import {readBestLap} from './lap-ghost.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const text=v=>String(v??'');
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=v=>typeof v==='number'?'#'+v.toString(16).padStart(6,'0'):v;
const place=n=>`第 ${n} 名`;
const STAT_LABELS={speed:'速度',accel:'加速',handling:'操控',weight:'重量',punch:'拳力'};
const DIFFICULTY={easy:'简单',normal:'普通',hard:'困难'};

const ICONS={
  tour:'<svg viewBox="0 0 48 48"><path d="M15 9h18v8a9 9 0 0 1-18 0zM15 12H9a6 6 0 0 0 7 7M33 12h6a6 6 0 0 1-7 7M24 26v7m-7 6h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  race:'<svg viewBox="0 0 48 48"><path d="M12 40V9m0 2h22l-4 6 4 6H12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sumo:'<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  crown:'<svg viewBox="0 0 48 48"><path d="M10 34 8 16l9 7 7-11 7 11 9-7-2 18z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  meltdown:'<svg viewBox="0 0 48 48"><path d="m24 8 7 4v8l-7 4-7-4v-8zM15 24l7 4v8l-7 4-7-4v-8zM33 24l7 4v8l-7 4-7-4v-8z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>',
};

const GLOVE_ICONS={
  spring:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h10l2-5-2-4H7l-3 4z"/><path d="M7 17v3m4-3v3m4-3v3"/></svg>',
  hook:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-4m5 4 5-4M6 19h12"/></svg>',
  hammer:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="7" rx="2"/><path d="M12 12v9"/></svg>',
  rocket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11z"/><path d="M8 13l-3 3v3l4-2m7-4 3 3v3l-4-2"/></svg>',
};

const GLOVE_SHORT={
  spring:'直线击退 · 冷却最短',
  hook:'远距钩锁 · 双向拉近',
  hammer:'横扫120° · 震碎地块',
  rocket:'脱手飞拳 · 25米狙击',
};

export function createUI(cb={}){
  const {modes,tracks,arenas,hexes,classes,paints,gloves}=cb;
  const root=document.createElement('div');root.id='game-ui';root.dataset.screen='menu';
  const modeOrder=['tour','race','sumo','crown','meltdown'];
  const mixer='<div class="levels">'+[['musicVolume','音乐音量'],['sfxVolume','音效音量']].map(([key,label])=>'<label><span>'+label+'</span><input type="range" min="0" max="100" step="5" data-volume="'+key+'"><output></output></label>').join('')+'</div>';
  root.innerHTML=`
  <div id="edge-danger"></div>
  <div class="name-labels"></div>
  <div id="offscreen"></div>

  <div class="hud">
    <div class="hud-top">
      <div class="hud-tl">
        <div id="race-pos" class="race-only"><small>名次</small><b>4</b><span>/ 6</span></div>
        <section id="board" class="panel"><h3></h3><ol></ol></section>
      </div>
      <section id="clock" class="panel"><div class="big">00:00</div><div class="lines"></div><div class="tag"></div></section>
    </div>
    <canvas id="minimap" class="race-only" width="220" height="220"></canvas>
    <div class="feed"></div>
    <div class="hud-bottom">
      <div id="controls-hint" class="panel">
        <span class="solo-help"><kbd>WASD</kbd> 驾驶　<kbd>Shift</kbd> 漂移攒氮气　<kbd>空格</kbd> 释放氮气　<kbd>J</kbd> 点按出拳/长按蓄力</span>
        <span class="duo-help">1P　WASD 驾驶 · 左 Shift 漂移 · J 出拳 · Q 道具 · 空格氮气</span>
        <span class="duo-help">2P　方向键驾驶 · 右 Shift 漂移 · 回车出拳 · / 道具 · . 氮气</span>
      </div>
      <div class="instruments">
        <div class="hud-bc">
          <button type="button" id="item-slot" class="race-only panel"><span class="item-key">Q</span><b>无道具</b><small>驶过道具箱获取</small></button>
          <button id="punch-btn" class="panel" type="button"><span class="punch-top"><strong>出拳</strong><kbd>J</kbd><em>就绪</em></span><span class="meter"><i></i></span></button>
        </div>
        <section id="speedo" class="panel">
          <div class="speed"><b>0</b><small>km/h</small></div>
          <div class="speed-bar"><i></i></div>
          <div class="nitro">
            <div class="nitro-head"><span class="nitro-label">氮气</span><span class="tanks"><i></i><i></i></span><kbd>空格</kbd></div>
            <div class="nitro-bar"><i></i></div>
            <div class="nitro-hint">按住 Shift 转向漂移，积攒氮气</div>
          </div>
          <div class="effect"></div>
        </section>
      </div>
    </div>
    <div class="duo-instruments"><div class="driver-dash"><b>1P</b> <span></span></div><div class="driver-dash"><b>2P</b> <span></span></div></div>
    <div id="countdown"></div>
    <div id="announce"><strong></strong><span></span></div>
    <div id="respawn" hidden><strong></strong><span></span></div>
    <div id="wrong-way" hidden>方向错误</div>
    <div id="spectate" hidden></div>
    <div id="combo" hidden></div>
    <nav class="touch-controls" aria-label="驾驶控制">
      <div class="drive-stick" aria-label="向上加速、向下倒车、左右转向"><span aria-hidden="true">▲</span><i></i><span aria-hidden="true">▼</span></div>
      <div class="touch-actions">
        <button class="t-drift" data-control="ShiftLeft" aria-label="按住漂移">漂移</button>
        <button class="t-punch" aria-label="点按出拳，按住蓄力">出拳<small>就绪</small></button>
        <button class="t-nitro">氮气</button><button class="t-item race-only">道具</button>
      </div>
    </nav>
  </div>

  <nav class="top-controls">
    <button id="pause-btn" class="icon-btn" type="button" title="暂停（Esc）"><svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zm5 0h3v14h-3z" fill="currentColor"/></svg></button>
    <button id="sound-btn" class="icon-btn" type="button" title="静音"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path class="waves" d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="cross" d="m16 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
    <button id="fs-btn" class="icon-btn" type="button" title="全屏（F）"><svg viewBox="0 0 24 24"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></button>
  </nav>

  <main class="screen menu-screen">
    <header class="brand">
      <div class="eyebrow-row">
        <p class="eyebrow-cn">重拳飞车</p>
        <span class="logo-sticker" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h12l3-6-3-5H9L5 11z"/><path d="M9 17v5m5-5v5m5-5v5"/></svg></span>
      </div>
      <h1 class="logo">PUNCH DRIVE</h1>
      <p class="slogan">竞速 · 乱斗 · 生存</p>
      <p class="blurb">六名车手，四种赢法。每辆美式越野车的保险杠上，都装着一只重拳。</p>
    </header>
    <section class="mode-grid">${modeOrder.map(id=>`<button class="mode-card${id==='tour'?' featured':''}" data-mode="${id}" style="--accent:${modes[id].accent}">
      <span class="icon">${ICONS[id]}</span><span class="names"><strong>${esc(modes[id].name)}</strong><em>${esc(modes[id].en)}</em></span><p>${esc(modes[id].tag)}</p><span class="chips"><b>${esc(modes[id].length)}</b><b>6 名车手</b>${id==='tour'?'<b class="hot">推荐</b>':''}</span></button>`).join('')}</section>
    <footer class="menu-foot">
      <div class="touch-orientation">横屏游玩可看见更宽的赛场</div>
      <div class="hint solo-help"><kbd>WASD</kbd> 驾驶 <kbd>Shift</kbd> 漂移攒氮气 <kbd>空格</kbd> 释放氮气 <kbd>J</kbd> 出拳 <kbd>Q</kbd> 道具</div>
      <div class="quick-settings">
        <span class="seg" data-setting="players"><button type="button" data-value="1">单人</button><button type="button" data-value="2">本地双人</button></span>
        <span class="seg" data-setting="quality"><b>画质</b><button type="button" data-value="low">低</button><button type="button" data-value="medium" class="on">中</button><button type="button" data-value="high">高</button></span>
        <details class="mixer"><summary>音量</summary>${mixer}</details>
        <label class="toggle"><input type="checkbox" id="music-toggle" checked><i></i><b>音乐</b></label>
      </div>
    </footer>
  </main>

  <section class="screen setup-screen" hidden>
    <header class="setup-head">
      <button class="back-btn" type="button">‹ 返回</button>
      <nav class="crumbs" aria-label="比赛设置">
        <button type="button" class="crumb-mode" title="返回模式选择"></button>
        <span class="crumb-box">
          <button type="button" data-step="venue">场地</button>
          <button type="button" data-step="car">赛车</button>
        </span>
      </nav>
    </header>
    <div class="step venue-step">
      <h2>选择场地</h2>
      <div class="venue-list"></div>
      <div class="option-rows"></div>
    </div>
    <div class="garage-stage"><span class="garage-hint">拖动 360° 旋转赏车<span class="wheel-tip"> · 滚轮缩放</span></span></div>
    <div class="step car-step" hidden>
      <h2>改装车库</h2>
      <div class="class-list">${Object.values(classes).map(c=>`<button class="class-card" data-class="${c.id}"><span class="cls-name"><strong>${esc(c.name)}</strong><em>${esc(c.en)}</em></span><p>${esc(c.tagline)}</p>
        <dl>${Object.entries(c.stats).map(([k,v])=>`<div><dt>${STAT_LABELS[k]||k}</dt><dd>${'<i class="on"></i>'.repeat(v)}${'<i></i>'.repeat(5-v)}</dd></div>`).join('')}</dl></button>`).join('')}</div>
      <div class="paints"><b>车身涂装</b><div class="paint-row">${paints.map(p=>`<button class="swatch" data-paint="${p.id}" title="${esc(p.name)}" style="--body:${hex(p.body)};--stripe:${hex(p.stripe)};--glow:${hex(p.glow)}"><i></i><span>${esc(p.name)}</span></button>`).join('')}</div></div>
      <div class="glove-picker">
        <div class="glove-head"><label for="glove-select">前杠武器</label><small id="glove-tip"></small></div>
        <select id="glove-select" class="sr-only" aria-describedby="glove-tip">${Object.entries(gloves).map(([id,g])=>`<option value="${id}">${esc(g.name)}</option>`).join('')}</select>
        <div class="glove-grid">${Object.entries(gloves).map(([id,g])=>`<button type="button" class="glove-card" data-glove="${id}"><span class="glove-ico">${GLOVE_ICONS[id]||''}</span><span class="glove-meta"><strong>${esc(g.name)}</strong><span>${esc(GLOVE_SHORT[id]||g.tip)}</span></span></button>`).join('')}</div>
      </div>
    </div>
    <footer class="setup-foot"><div class="setup-summary"></div><button class="primary next-btn" type="button">下一步</button></footer>
  </section>

  <section class="screen pause-screen" hidden>
    <div class="dialog panel">
      <div class="hazard-bar" aria-hidden="true"></div>
      <div class="dialog-body">
        <h2>已暂停</h2><p class="pause-sub"></p>
        <button class="primary resume-btn" type="button">继续比赛</button>
        <button class="secondary restart-btn" type="button">重新开始</button>
        <button class="secondary quit-btn" type="button">退出到主菜单</button>
        <div class="quick-settings"><span class="seg" data-setting="quality"><b>画质</b><button type="button" data-value="low">低</button><button type="button" data-value="medium" class="on">中</button><button type="button" data-value="high">高</button></span></div>
        ${mixer}
        <details class="pause-guide"><summary>操作说明</summary>
          <p class="solo-help">WASD 或方向键驾驶，Shift / Z 漂移，空格释放氮气。J / X 点按出拳，按住蓄力后松开。Q / K / C 使用道具或小跳，R 复位。</p>
          <p class="duo-help">1P 用 WASD 驾驶，左 Shift 漂移，J 出拳，Q 道具，空格氮气。2P 用方向键驾驶，右 Shift 漂移，回车或小键盘 1 出拳，/ 或小键盘 2 道具，. 或小键盘 0 氮气。</p>
          <p class="pad-help">手柄用左摇杆转向，右扳机加速，左扳机刹车。A 出拳，X 道具，B 氮气，左肩键漂移。</p>
          <p class="touch-help">左拇指向上推加速，向下推倒车，左右拨动转向。右手按住漂移，点按出拳，长按蓄力后松开。</p>
          <p class="hop-help">熔毁中，使用小跳会消耗一罐氮气。</p>
        </details><small class="esc-tip">按 Esc 继续</small>
      </div>
    </div>
  </section>

  <section class="screen results-screen" hidden>
    <div class="results-wrap">
      <header><p class="eyebrow"></p><h2 class="result-title"></h2><p class="result-sub"></p></header>
      <div class="result-cols">
        <section class="panel standings-panel"><h3>最终名次</h3><ol class="final"></ol></section>
        <section class="panel stats-panel"><h3>本场数据</h3><dl class="stats"></dl><div class="tour-panel" hidden><h3>巡回赛积分</h3><ol class="tour-table"></ol><p class="tour-next"></p></div></section>
      </div>
      <footer class="result-actions"><button class="primary next-event-btn" type="button">下一场</button><button class="primary rematch-btn" type="button">再来一局</button><button class="secondary menu-btn" type="button">主菜单</button></footer>
    </div>
  </section>
  <div id="wipe"></div>`;
  document.body.append(root);

  const $=s=>root.querySelector(s),$$=s=>[...root.querySelectorAll(s)];
  const n={
    board:$('#board'),boardTitle:$('#board h3'),boardList:$('#board ol'),racePos:$('#race-pos'),
    clockBig:$('#clock .big'),clockLines:$('#clock .lines'),clockTag:$('#clock .tag'),clock:$('#clock'),
    minimap:$('#minimap'),feed:$('.feed'),item:$('#item-slot'),punch:$('#punch-btn'),punchState:$('#punch-btn em'),punchFill:$('#punch-btn .meter i'),
    speed:$('#speedo .speed b'),speedFill:$('#speedo .speed-bar i'),speedo:$('#speedo'),effect:$('#speedo .effect'),
    nitro:$('#speedo .nitro'),nitroTanks:[...root.querySelectorAll('#speedo .tanks i')],nitroFill:$('#speedo .nitro-bar i'),nitroHint:$('#speedo .nitro-hint'),
    countdown:$('#countdown'),announce:$('#announce'),respawn:$('#respawn'),wrong:$('#wrong-way'),spectate:$('#spectate'),combo:$('#combo'),
    danger:$('#edge-danger'),labels:$('.name-labels'),offscreen:$('#offscreen'),sound:$('#sound-btn'),hint:$('#controls-hint'),
  };
  const labelNodes=new Map(),indicatorNodes=new Map();
  let setup={mode:'race',step:'venue',venue:'neon',classId:'rumbler',paint:'arctic',difficulty:'normal',laps:3,lapGhost:1,format:'classic',crownTarget:60,rounds:3};
  let settings={quality:'medium',music:true,players:1,musicVolume:1,sfxVolume:1};
  try{const saved=JSON.parse(localStorage.getItem('punch-drive-setup')||'{}');setup={...setup,...saved.setup};settings={...settings,...saved.settings};}catch{}
  if(!Object.hasOwn(gloves,setup.glove))setup.glove='spring';
  const save=()=>{try{localStorage.setItem('punch-drive-setup',JSON.stringify({setup:{classId:setup.classId,paint:setup.paint,glove:setup.glove,difficulty:setup.difficulty,lapGhost:setup.lapGhost},settings}));}catch{}};
  let announceTimer=0,countTimer=0,lastBoard='',minimapPath=null,minimapBounds=null,minimapAccent='#38d9f5',hintTimer=0,readyTimer=0;
  const ctx2d=n.minimap.getContext('2d');

  // ------------------------------------------------ menu
  let previewTimer;
  $$('.mode-card').forEach(card=>{
    card.addEventListener('mouseenter',()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(root.dataset.screen==='menu'&&card.matches(':hover')){const id=card.dataset.mode;cb.preview?.({mode:id,venue:modes[id].defaultVenue});}},220);});
    card.addEventListener('mouseleave',()=>clearTimeout(previewTimer));
    card.addEventListener('click',()=>openSetup(card.dataset.mode));
  });
  function syncSettingsUI(){
    $$('.seg[data-setting="quality"] button').forEach(b=>b.classList.toggle('on',b.dataset.value===settings.quality));
    $('#music-toggle').checked=!!settings.music;
    $$('[data-setting="players"] button').forEach(b=>{const chosen=Number(b.dataset.value)===settings.players;b.classList.toggle('on',chosen);b.setAttribute('aria-pressed',String(chosen));});
    if(root.dataset.screen==='menu')root.dataset.localDuo=String(settings.players===2);
    $$('[data-volume]').forEach(input=>{input.value=Math.round(100*settings[input.dataset.volume]);input.nextElementSibling.textContent=input.value+'%';});
  }
  $$('.seg[data-setting="quality"] button').forEach(b=>b.addEventListener('click',()=>{settings.quality=b.dataset.value;syncSettingsUI();save();cb.settings?.({quality:settings.quality});b.blur();}));
  $('#music-toggle').addEventListener('change',e=>{settings.music=e.target.checked;save();cb.settings?.({music:settings.music});});
  $$('[data-setting="players"] button').forEach(b=>b.addEventListener('click',()=>{settings.players=Number(b.dataset.value);save();syncSettingsUI();}));
  $$('[data-volume]').forEach(input=>input.addEventListener('input',()=>{
    const key=input.dataset.volume;settings[key]=Number(input.value)/100;syncSettingsUI();save();cb.settings?.({[key]:settings[key]});
  }));
  syncSettingsUI();
  cb.settings?.({quality:settings.quality,music:settings.music,musicVolume:settings.musicVolume,sfxVolume:settings.sfxVolume});
  cb.configure?.({classId:setup.classId,paint:setup.paint,glove:setup.glove});

  // ------------------------------------------------ setup
  function venuesFor(mode){
    const type=modes[mode]?.venueType;
    if(type==='track')return tracks.map(t=>({id:t.id,name:t.name,sub:t.subtitle,accent:t.accent,meta:`${t.laps} 圈 · 抓地 ${t.grip.toFixed(2)}`}));
    if(type==='hex')return hexes.map(h=>({id:h.id,name:h.name,sub:h.subtitle,accent:h.accent,meta:'169 块地面'}));
    if(type==='arena')return arenas.map(a=>({id:a.id,name:a.name,sub:a.subtitle,accent:a.accent,meta:`抓地 ${a.grip.toFixed(2)}`}));
    return [];
  }
  function optionRows(mode){
    const rows=[];
    if(mode==='race')rows.push(['laps','圈数',[[2,'2 圈'],[3,'3 圈'],[5,'5 圈']]]);
    if(mode==='race'&&settings.players===1&&readBestLap(setup.venue))rows.push(['lapGhost','本机纪录幽灵车',[[1,'开启'],[0,'关闭']]]);
    if(mode==='sumo')rows.push(['format','赛制',[['classic','经典 6×60 秒'],['quick','快速 3×45 秒']]]);
    if(mode==='crown')rows.push(['crownTarget','王冠目标',[[45,'45 秒'],[60,'60 秒'],[90,'90 秒']]]);
    if(mode==='meltdown')rows.push(['rounds','回合数',[[2,'2 回合'],[3,'3 回合'],[5,'5 回合']]]);
    rows.push(['difficulty','对手',[['easy','简单'],['normal','普通'],['hard','困难']]]);
    return rows;
  }
  function renderVenueStep(){
    const list=venuesFor(setup.mode);
    if(!list.some(v=>v.id===setup.venue))setup.venue=modes[setup.mode].defaultVenue||list[0]?.id;
    $('.venue-list').innerHTML=list.map(v=>`<button class="venue-card${v.id===setup.venue?' on':''}" data-venue="${v.id}" style="--accent:${hex(v.accent)}"><span class="venue-top"><strong>${esc(v.name)}</strong><small>${esc(v.meta)}</small></span><p>${esc(v.sub)}</p></button>`).join('');
    $$('.venue-card').forEach(card=>card.addEventListener('click',()=>{setup.venue=card.dataset.venue;$$('.venue-card').forEach(c=>c.classList.toggle('on',c===card));renderOptions();cb.preview?.({mode:setup.mode,venue:setup.venue});summary();card.blur();}));
    renderOptions();
  }
  function renderOptions(){
    $('.option-rows').innerHTML=optionRows(setup.mode).map(([key,label,opts])=>`<div class="seg option" data-key="${key}"><b>${label}</b>${opts.map(([v,t])=>`<button type="button" data-value="${v}" class="${String(setup[key])===String(v)?'on':''}">${t}</button>`).join('')}</div>`).join('');
    $$('.option').forEach(row=>row.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
      const key=row.dataset.key,raw=b.dataset.value;setup[key]=isNaN(Number(raw))?raw:Number(raw);
      row.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));save();summary();b.blur();})));
  }
  function renderCarStep(){
    $('#glove-select').value=setup.glove;
    $('#glove-tip').textContent=gloves[setup.glove].tip;
    $$('.glove-card').forEach(g=>g.classList.toggle('on',g.dataset.glove===setup.glove));
    $$('.class-card').forEach(c=>c.classList.toggle('on',c.dataset.class===setup.classId));
    $$('.swatch').forEach(s=>s.classList.toggle('on',s.dataset.paint===setup.paint));
  }
  $('#glove-select').addEventListener('change',e=>{
    setup.glove=e.target.value;renderCarStep();save();cb.configure?.({glove:setup.glove});e.target.blur();
  });
  $$('.glove-card').forEach(card=>card.addEventListener('click',()=>{
    setup.glove=card.dataset.glove;renderCarStep();save();cb.configure?.({glove:setup.glove});card.blur();
  }));
  $$('.class-card').forEach(card=>card.addEventListener('click',()=>{setup.classId=card.dataset.class;renderCarStep();save();cb.configure?.({classId:setup.classId,paint:setup.paint});summary();card.blur();}));
  $$('.swatch').forEach(s=>s.addEventListener('click',()=>{setup.paint=s.dataset.paint;renderCarStep();save();cb.configure?.({classId:setup.classId,paint:setup.paint});s.blur();}));
  function summary(){
    const m=modes[setup.mode],venue=venuesFor(setup.mode).find(v=>v.id===setup.venue);
    const cls=classes[setup.classId];
    $('.setup-summary').innerHTML=`<i style="background:${m.accent}"></i><b>${esc(m.name)}</b><span>${venue?esc(venue.name):'五场赛事'}</span><span>${esc(cls.name)}</span><span>对手${DIFFICULTY[setup.difficulty]||''}</span>`;
    $('.next-btn').textContent=setup.step==='car'?'开始比赛':'下一步';
  }
  function setStep(step){
    setup.step=step;
    $('.venue-step').hidden=step!=='venue';$('.car-step').hidden=step!=='car';
    $$('.crumbs [data-step]').forEach(c=>{c.classList.toggle('on',c.dataset.step===step);c.hidden=c.dataset.step==='venue'&&!modes[setup.mode].venueType;});
    for(const node of $$('.crumbs [data-step]')){
      if(node.dataset.step===step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');
    }
    root.dataset.step=step;
    cb.garage?.(step==='car');
    if(step==='venue'){renderVenueStep();cb.preview?.({mode:setup.mode,venue:setup.venue});}
    else renderCarStep();
    summary();
  }
  function openSetup(mode){
    setup.mode=mode;root.style.setProperty('--mode-accent',modes[mode].accent);
    $('.crumb-mode').textContent=modes[mode].name;
    showScreen('setup');
    setStep(modes[mode].venueType?'venue':'car');
  }
  $('.crumb-mode').addEventListener('click',()=>{
    cb.garage?.(false);showScreen('menu');cb.preview?.({mode:'race',venue:'neon'});
  });
  $$('.crumbs [data-step]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.step!==setup.step)setStep(b.dataset.step);}));
  $('.back-btn').addEventListener('click',back);
  $('.next-btn').addEventListener('click',confirm);
  function back(){
    if(root.dataset.screen==='setup'){if(setup.step==='car'&&modes[setup.mode].venueType)setStep('venue');else{cb.garage?.(false);showScreen('menu');cb.preview?.({mode:'race',venue:'neon'});}}
  }
  function confirm(){
    if(root.dataset.screen==='menu'){openSetup('race');return;}
    if(root.dataset.screen!=='setup')return;
    if(setup.step==='venue'){setStep('car');return;}
    wipe();
    cb.start?.({...settings,mode:setup.mode,venue:setup.venue,classId:setup.classId,paint:setup.paint,glove:setup.glove,difficulty:setup.difficulty,laps:setup.laps,format:setup.format,crownTarget:setup.crownTarget,rounds:setup.rounds});
  }
  function wipe(){const w=$('#wipe');w.classList.remove('go');void w.offsetWidth;w.classList.add('go');}

  // ------------------------------------------------ pause / results / touch
  $('.resume-btn').addEventListener('click',()=>cb.resume?.());
  $('.restart-btn').addEventListener('click',()=>{wipe();cb.restart?.();});
  $('.quit-btn').addEventListener('click',()=>cb.menu?.());
  $('.rematch-btn').addEventListener('click',()=>{wipe();cb.restart?.();});
  $('.next-event-btn').addEventListener('click',()=>{wipe();cb.next?.();});
  $('.menu-btn').addEventListener('click',()=>cb.menu?.());
  $('#pause-btn').addEventListener('click',e=>{e.currentTarget.blur();cb.pause?.();});
  $('#sound-btn').addEventListener('click',e=>{e.currentTarget.blur();cb.mute?.();});
  $('#fs-btn').addEventListener('click',e=>{e.currentTarget.blur();cb.fullscreen?.();});
  // Pointer capture allows a thumb to slide off a button without leaving it held.
  const cancelTouch=[];
  function hold(element,start,end,cancel=end,move){
    let pointer=null;
    const reset=(released)=>{
      if(pointer===null)return;
      pointer=null;element.classList.remove('pressed');(released?end:cancel)();
    };
    element.addEventListener('pointerdown',e=>{
      if(pointer!==null||e.button!==0||root.dataset.screen!=='playing')return;
      e.preventDefault();pointer=e.pointerId;element.setPointerCapture(pointer);element.classList.add('pressed');start(e);
    });
    if(move)element.addEventListener('pointermove',e=>{if(e.pointerId===pointer)move(e);});
    element.addEventListener('pointerup',e=>{if(e.pointerId===pointer)reset(true);});
    for(const event of ['pointercancel','lostpointercapture'])element.addEventListener(event,e=>{if(e.pointerId===pointer)reset(false);});
    cancelTouch.push(()=>reset(false));
  }
  const touchPunch=$('.t-punch'),touchItem=$('.t-item'),touchNitro=$('.t-nitro');
  for(const button of [n.punch,touchPunch])hold(button,()=>cb.punchStart?.(),()=>cb.punchRelease?.(),()=>cb.punchCancel?.());
  for(const button of [n.item,touchItem])button.addEventListener('click',()=>{if(root.dataset.screen==='playing')cb.item?.();});
  for(const button of [n.nitro,touchNitro])hold(button,()=>{
    if(!n.spectate.hidden)cb.control?.('Space',true);else cb.nitro?.();
  },()=>cb.control?.('Space',false));
  hold($('.t-drift'),()=>cb.control?.('ShiftLeft',true),()=>cb.control?.('ShiftLeft',false));
  const stick=$('.drive-stick'),heldDirections=new Set();
  let stickArea;
  function steer(e){
    const r=stickArea.width*.5,dx=(e.clientX-stickArea.left-r)/r,dy=(e.clientY-stickArea.top-r)/r;
    const scale=r*.60/Math.max(1,Math.hypot(dx,dy));
    stick.style.setProperty('--x',(dx*scale)+'px');stick.style.setProperty('--y',(dy*scale)+'px');
    for(const [key,on] of [['KeyA',dx<-.22],['KeyD',dx>.22],['KeyW',dy<-.16],['KeyS',dy>.22]]){
      if(heldDirections.has(key)===on)continue;
      if(on)heldDirections.add(key);else heldDirections.delete(key);
      cb.control?.(key,on);
    }
  }
  function centerStick(){
    for(const key of heldDirections)cb.control?.(key,false);
    heldDirections.clear();stick.style.removeProperty('--x');stick.style.removeProperty('--y');
  }
  hold(stick,e=>{stickArea=stick.getBoundingClientRect();steer(e);},centerStick,centerStick,steer);

  function showScreen(name,data={}){
    // Never leave a focused button behind: Space/Enter while driving must not press it.
    if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur?.();
    root.dataset.screen=name;
    $('.menu-screen').hidden=name!=='menu';$('.setup-screen').hidden=name!=='setup';
    $('.pause-screen').hidden=name!=='paused';$('.results-screen').hidden=name!=='results';
    if(name!=='playing'){clearTimeout(announceTimer);n.announce.classList.remove('visible');n.countdown.className='';
      cancelTouch.forEach(cancel=>cancel());}
    if(name==='playing'&&!data.resume){
      root.dataset.localDuo=String(!!data.duo);root.dataset.mode=data.mode||'race';root.style.setProperty('--mode-accent',data.info?.accent||'#38d9f5');
      n.feed.replaceChildren();lastBoard='';n.hint.classList.add('show');clearTimeout(hintTimer);
      n.respawn.hidden=true;n.wrong.hidden=true;n.spectate.hidden=true;
    }
    if(name==='paused'){$('.pause-sub').textContent=data.tour?'派对巡回赛进行中':'比赛会在这里等你';syncSettingsUI();}
    if(name==='menu'){syncSettingsUI();}
    if(name==='results')renderResults(data);
    cb.onScreen?.(name);
  }

  function renderResults(data){
    const standings=data.standings||[],rank=standings.findIndex(s=>s.player)+1;
    $('.eyebrow').textContent=`${data.info?.name||''}${data.subtitle?` · ${data.subtitle}`:''}`;
    $('.result-title').textContent=rank===1?(data.title||'冠军'):place(rank);
    $('.result-title').dataset.win=rank===1?'1':'0';
    const medal=standings[rank-1]?.accolade;
    $('.result-sub').textContent=medal?`${medal.name} · ${medal.reason}`:`第 ${rank} 名，共 ${standings.length} 名车手`;
    $('.final').innerHTML=standings.map((s,i)=>{
      const title=s.accolade;
      const badge=title?`<details class="result-medal"><summary title="${esc(title.reason)}">${esc(title.name)}</summary><span>${esc(title.reason)}</span></details>`:'';
      return `<li class="${s.player?'me':''}"><span class="pos">${i+1}</span><i style="background:${esc(s.color)}"></i><div class="result-driver"><b>${esc(s.name)}${s.player?' <small>你</small>':''}</b>${badge}</div><span class="val">${esc(s.value)}</span>${data.tour?`<em>+${s.tourPoints??0}</em>`:''}</li>`;
    }).join('');
    $('.stats').innerHTML=(data.stats||[]).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    const tour=data.tour,tp=$('.tour-panel');tp.hidden=!tour;
    $('.next-event-btn').hidden=!tour||tour.finished;$('.rematch-btn').hidden=!!tour;
    if(tour){
      $('.tour-table').innerHTML=tour.standings.map((s,i)=>`<li class="${s.player?'me':''}"><span class="pos">${i+1}</span><i style="background:${esc(s.color)}"></i><b>${s.player?'你':esc(s.name)}</b><span class="val">${s.points} 分</span></li>`).join('');
      const next=tour.events[tour.index+1];
      $('.tour-next').innerHTML=tour.finished?`<b>巡回赛结束</b> · ${tour.standings[0].player?'你是总冠军':`${esc(tour.standings[0].name)} 赢得了巡回赛`}`:`第 ${tour.index+1}/${tour.total} 场已完成 · 下一场：<b>${esc(next.name)}</b>`;
      if(tour.finished){$('.result-title').textContent=tour.standings[0].player?'总冠军':'巡回赛结束';$('.result-title').dataset.win=tour.standings[0].player?'1':'0';$('.eyebrow').textContent='派对巡回赛 · 最终排名';}
    }
  }

  // ------------------------------------------------ HUD
  const driverDashes=$$('.driver-dash');
  function hud(s){
    root.classList.toggle('boost-streaks',!s.duoStatus&&(s.nitro?.on||s.effect?.type==='boost'));
    for(const driver of s.duoStatus||[]){
      const dash=driverDashes[driver.id];
      dash.style.setProperty('--driver',driver.color);
      const detail=[driver.rank?'第'+driver.rank+'名':'',driver.status||(driver.active?driver.speed+' km/h':'离场'),driver.item,'氮气 ×'+driver.tanks,driver.cooldown>.05?'拳 '+driver.cooldown.toFixed(1)+'s':'拳就绪'].filter(Boolean).join(' · ');
      dash.lastElementChild.textContent=detail;
    }
    if(s.clock){n.clockBig.textContent=s.clock.big;n.clockLines.innerHTML=s.clock.lines.map(l=>`<span>${l}</span>`).join('');n.clockTag.textContent=s.clock.tag||'';
      n.clock.classList.toggle('warn',!!s.clock.warn);n.clock.classList.toggle('hot',!!s.clock.hot);}
    if(s.board){n.boardTitle.textContent=s.board.title;
      const leaderboard=s.board.rows,duo=root.dataset.localDuo==='true';
      const html=leaderboard.map((row,rank)=>{
        const local=duo&&row.id===1,driver=duo&&row.id===0?'1P':local?'2P':row.player?'你':row.name;
        const value=esc(row.value);
        let compact=value;
        if(rank&&(row.player||local)&&s.mode!=='race'){
          const difference=parseFloat(leaderboard[0].value)-parseFloat(row.value);
          if(Number.isFinite(difference))compact=difference>0?'落后 '+difference+(s.mode==='crown'?' 秒':' 分'):'并列';
        }
        const score=compact===value?value:`<span class="full-value">${value}</span><span class="compact-gap">${compact}</span>`;
        return `<li class="${row.player?'me':''}${local?' local-driver':''}${row.out?' out':''}${row.crown?' crowned':''}"><span class="pos">${rank+1}</span><i style="background:${esc(row.color)}"></i><b>${esc(driver)}</b><span class="val">${score}</span>${row.bar!=null?`<u style="--p:${clamp(row.bar,0,1)}"></u>`:''}</li>`;
      }).join('');
      if(html!==lastBoard){n.boardList.innerHTML=html;lastBoard=html;}}
    const race=s.race;
    if(race){
      n.racePos.querySelector('b').textContent=race.place;n.racePos.querySelector('span').textContent=`/ ${race.of}`;
      n.racePos.dataset.place=race.place;
      const item=race.item;n.item.classList.toggle('has',!!item);n.item.style.setProperty('--item',item?.color||'#5c6375');
      n.item.querySelector('b').textContent=item?item.name:'无道具';n.item.querySelector('small').textContent=item?item.hint:'驶过道具箱获取';
      n.wrong.hidden=!race.wrongWay;
    }
    if(s.minimap&&minimapPath)drawMinimap(s.minimap.cars);
    if(s.mode==='meltdown'){
      n.item.querySelector('b').textContent='氮气小跳';
      n.item.querySelector('small').textContent=s.item?.hint||(s.nitro?.tanks?'等待上场':'需要一罐氮气');
      n.item.classList.toggle('has',!!s.item);n.item.style.setProperty('--item',s.item?.color||'#637180');
    }
    touchItem.classList.toggle('ready',!!(s.race?.item||s.item));
    touchItem.textContent=s.mode==='meltdown'?'小跳':s.race?.item?.name||'道具';
    const speed=Math.max(0,Math.round(s.speed||0));n.speed.textContent=speed;
    n.speedFill.style.transform=`scaleX(${clamp(speed/(s.mode==='race'?150:110),0,1)})`;
    // Nitro: gauge fills while drifting; full gauges become tanks fired with Space.
    const nitro=s.nitro||{gauge:0,tanks:0,max:2,on:false};
    n.nitroTanks.forEach((el,i)=>el.classList.toggle('full',i<nitro.tanks));
    n.nitroFill.style.transform=`scaleX(${nitro.on?clamp(nitro.remaining/2.2,0,1):clamp(nitro.gauge,0,1)})`;
    n.speedo.classList.toggle('nitro-on',!!nitro.on);n.speedo.classList.toggle('drifting',!!s.drifting);n.speedo.classList.toggle('nitro-ready',nitro.tanks>0&&!nitro.on);
    n.nitroHint.textContent=nitro.on?'氮气加速中！':s.drifting?'漂移中 · 正在积攒氮气':nitro.tanks>0?`氮气就绪 ×${nitro.tanks} · 按空格释放`:'按住 Shift 转向漂移，积攒氮气';
    const fx=s.effect;n.effect.textContent=fx?`${{boost:'涡轮',power:'强化拳',shield:'护盾'}[fx.type]||fx.type} ${fx.remaining.toFixed(1)} 秒`:'';n.effect.dataset.type=fx?.type||'';
    const cd=Math.max(0,s.cooldown||0),ready=cd<=.02&&s.canPunch;
    const holding=!!s.punchHolding,charge=clamp(s.punchCharge||0,0,1);
    const status=holding?(charge>=.6?'重拳就绪':'蓄力中'):ready?'就绪':cd>.02?`${cd.toFixed(1)} 秒`:'—';
    n.punchState.textContent=status;touchPunch.querySelector('small').textContent=status;
    n.punch.style.setProperty('--punch-fill',(100*(holding?charge:clamp(1-cd/(s.cooldownMax||2.5),0,1)))+'%');
    n.punch.classList.toggle('charging',!ready||holding);
    for(const button of [n.punch,touchPunch])button.classList.toggle('heavy',holding&&charge>=.6);

    n.punchFill.style.transform=`scaleX(${holding?charge:clamp(1-cd/(s.cooldownMax||2.5),0,1)})`;
    n.danger.style.opacity=clamp(s.edgeDanger||0,0,1).toFixed(2);
    const r=s.respawn;n.respawn.hidden=!r;
    if(r){n.respawn.querySelector('strong').textContent=r.cause;n.respawn.querySelector('span').textContent=`${Math.ceil(r.seconds)} 秒后重新上场`;}
    n.spectate.hidden=!s.spectate;if(s.spectate)n.spectate.innerHTML=`观战中 <b>${esc(s.spectate)}</b> · <span class="key-fast">按住空格快进</span><span class="touch-help">按住氮气快进</span>`;
    n.combo.hidden=!(s.combo>=2);if(s.combo>=2)n.combo.textContent=s.combo>=3?`${s.combo} 连击落`:'双杀';
  }
  function nitroReady(tanks){
    n.speedo.classList.remove('flash');void n.speedo.offsetWidth;n.speedo.classList.add('flash');
    clearTimeout(readyTimer);readyTimer=setTimeout(()=>n.speedo.classList.remove('flash'),700);
    feed(`氮气 +1（共 ${tanks} 罐）`);
  }
  function setMinimap(path,accent){
    minimapPath=path;minimapAccent=accent||'#38d9f5';
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const [x,z] of path){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    const span=Math.max(maxX-minX,maxZ-minZ)||1;minimapBounds={cx:(minX+maxX)/2,cz:(minZ+maxZ)/2,scale:176/span};
  }
  function drawMinimap(cars){
    const c=ctx2d,W=220,b=minimapBounds;c.clearRect(0,0,W,W);
    const px=x=>W/2+(x-b.cx)*b.scale,pz=z=>W/2+(z-b.cz)*b.scale;
    c.lineJoin='round';c.lineCap='round';
    c.beginPath();minimapPath.forEach(([x,z],i)=>i?c.lineTo(px(x),pz(z)):c.moveTo(px(x),pz(z)));c.closePath();
    c.strokeStyle='#0b0d15';c.lineWidth=13;c.stroke();
    c.strokeStyle='rgba(255,255,255,.18)';c.lineWidth=8;c.stroke();
    c.strokeStyle=minimapAccent;c.lineWidth=3;c.stroke();
    const [sx,sz]=minimapPath[0];c.fillStyle='#fff';c.fillRect(px(sx)-6,pz(sz)-2,12,4);
    for(const car of [...cars].sort((a,b)=>a.player-b.player)){
      if(!car.active)continue;
      c.beginPath();c.arc(px(car.x),pz(car.z),car.player?7:4.5,0,Math.PI*2);c.fillStyle=car.color;c.fill();
      c.lineWidth=2.4;c.strokeStyle=car.player?'#fff':'#0b0d15';c.stroke();
    }
  }
  function announce(title,subtitle='',duration=2,style=''){
    clearTimeout(announceTimer);
    n.announce.querySelector('strong').textContent=text(title);n.announce.querySelector('span').textContent=text(subtitle);
    n.announce.dataset.style=style;n.announce.classList.remove('visible');void n.announce.offsetWidth;n.announce.classList.add('visible');
    announceTimer=setTimeout(()=>n.announce.classList.remove('visible'),duration*1000);
  }
  function countdown(value){
    if(value==='GO'&&n.hint.classList.contains('show')){
      clearTimeout(hintTimer);hintTimer=setTimeout(()=>n.hint.classList.remove('show'),5000);
    }
    clearTimeout(countTimer);
    n.countdown.textContent=value==='GO'?'开始':String(value);n.countdown.className='';void n.countdown.offsetWidth;n.countdown.className=value==='GO'?'show go':'show';
    countTimer=setTimeout(()=>{n.countdown.className='';},value==='GO'?900:850);
  }
  function feed(message){
    const entry=document.createElement('div');entry.className='feed-entry';entry.textContent=text(message);n.feed.prepend(entry);
    while(n.feed.children.length>4)n.feed.lastElementChild.remove();
    setTimeout(()=>entry.classList.add('leaving'),3800);setTimeout(()=>entry.remove(),4300);
  }
  function setLabels(labels=[]){
    const active=new Set();
    for(const l of labels){active.add(l.id);let el=labelNodes.get(l.id);
      if(!el){el=document.createElement('div');el.className='car-label';n.labels.append(el);labelNodes.set(l.id,el);}
      el.hidden=!l.visible;if(!el.hidden){el.textContent=(l.tag?l.tag+' ':'')+l.name;el.style.setProperty('--c',l.color);el.style.transform=`translate(${l.x}px,${l.y}px)`;}}
    for(const [id,el] of labelNodes)if(!active.has(id))el.hidden=true;
  }
  function setIndicators(list=[]){
    const active=new Set();
    for(const it of list){active.add(it.id);let el=indicatorNodes.get(it.id);
      if(!el){el=document.createElement('div');el.className='indicator';el.innerHTML='<i></i><span></span>';n.offscreen.append(el);indicatorNodes.set(it.id,el);}
      el.hidden=false;el.dataset.type=it.type;el.style.setProperty('--c',it.color);
      // 避开右下角仪表群安全区，避免屏外箭头穿插在速度表上方
      let ix=clamp(it.x,32,innerWidth-32),iy=clamp(it.y,44,innerHeight-48);
      if(ix>innerWidth-480&&iy>innerHeight-185)iy=innerHeight-190;
      el.style.transform=`translate(${ix}px,${iy}px)`;
      el.querySelector('i').style.transform=`rotate(${it.angle}rad)`;el.querySelector('span').textContent=it.name;}
    for(const [id,el] of indicatorNodes)if(!active.has(id))el.hidden=true;
  }
  function setSound(muted){n.sound.classList.toggle('muted',!!muted);n.sound.title=muted?'取消静音':'静音';}
  function setQuality(value){settings.quality=value;save();syncSettingsUI();}

  showScreen('menu');
  return {showScreen,hud,announce,countdown,feed,setLabels,setIndicators,setSound,setMinimap,back,confirm,setQuality,nitroReady,
    set onScreen(fn){cb.onScreen=fn;}};
}
