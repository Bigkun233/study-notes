/* ===== 考研日程 HUD 组件（嵌入笔记页） v1 =====
   用法：
     <link rel="stylesheet" href="assets/schedule.css?v=1">
     <div data-kysch></div>          ← 想放哪就放哪（不写就自动插到 <body> 开头）
     <script src="assets/schedule.js?v=1"></script>
   数据：localStorage  key = kaoyan_schedule_v1
*/
(function () {
  "use strict";
  if (window.__kyschInited) return;
  window.__kyschInited = true;

  var START = "2026-11-03";
  var EXAM = "2026-12-19";
  var KEY = "kaoyan_schedule_v1";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDay(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function spanDays(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  function mmdd(s) { var p = s.split("-"); return (+p[1]) + "/" + (+p[2]); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 数据 ---------- */
  var DB = { tasks: [], tomb: {} };
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.tasks)) {
        DB.tasks = d.tasks.filter(function (t) {
          return t && t.id && t.date && typeof t.text === "string";
        }).map(function (t) {
          var o = { id: t.id, text: t.text, date: t.date, done: !!t.done,
                    doneOn: t.doneOn || null, ts: t.ts || Date.now(),
                    up: t.up || t.ts || Date.now() };
          if (t.type === "week") o.type = "week";
          return o;
        });
      }
      if (d && d.tomb && typeof d.tomb === "object") DB.tomb = d.tomb;
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); }
    catch (e) { toast("保存失败：存储不可用"); }
  }
  function uid() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var todayStr = fmt(new Date());
  var curDay = todayStr;

  function activeOn(day) {
    var out = { today: [], carry: [] };
    for (var i = 0; i < DB.tasks.length; i++) {
      var t = DB.tasks[i];
      if (isWeekTask(t)) continue;
      if (t.date === day) out.today.push(t);
      else if (t.date < day && (!t.done || (t.doneOn && t.doneOn > day))) out.carry.push(t);
    }
    out.all = out.today.concat(out.carry);
    return out;
  }
  function doneAsOf(t, day) { return !!(t.done && t.doneOn && t.doneOn <= day); }
  function dayStat(day) {
    var a = activeOn(day), done = 0;
    for (var i = 0; i < a.all.length; i++) if (doneAsOf(a.all[i], day)) done++;
    return { total: a.all.length, done: done };
  }

  /* ---------- 周任务 ---------- */
  function isWeekTask(t) { return !!(t && t.type === "week"); }
  function weekStartOf(day) {           // 周一为一周起点
    var d = parseDay(day), w = d.getDay();
    d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w));
    return fmt(d);
  }
  function weekEndOf(day) {
    var d = parseDay(weekStartOf(day)); d.setDate(d.getDate() + 6); return fmt(d);
  }
  function weekNo(dayStr) {             // ISO 周数
    var d = parseDay(dayStr);
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
    var f = new Date(t.getFullYear(), 0, 4);
    f.setDate(f.getDate() - ((f.getDay() + 6) % 7) + 3);
    return 1 + Math.round((t - f) / 604800000);
  }
  function weekTasksOf(day) {
    var W = weekStartOf(day), normal = [], carry = [];
    for (var i = 0; i < DB.tasks.length; i++) {
      var t = DB.tasks[i];
      if (!isWeekTask(t)) continue;
      if (t.date === W) normal.push(t);
      else if (t.date < W && (!t.done || weekStartOf(t.doneOn) > W)) carry.push(t);
    }
    return { wk: W, end: weekEndOf(W), normal: normal, carry: carry, all: normal.concat(carry) };
  }
  function weekDoneAsOf(t, day) {
    return !!(t.done && t.doneOn && weekStartOf(t.doneOn) <= weekStartOf(day));
  }

  /* ---------- 骨架 ---------- */
  var host = document.querySelector("[data-kysch]");
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-kysch", "");
    host.className = "kysch-host";
    document.body.insertBefore(host, document.body.firstChild);
  }
  // data-kysch="bare" → 不渲染顶部条和悬浮按钮，只保留全屏面板（供首页入口调用）
  var BARE = (host.getAttribute("data-kysch") || "").toLowerCase() === "bare";
  host.classList.add("kysch-host");

  host.innerHTML =
    '<div class="kysch-strip">' +
      '<div class="kysch-row">' +
        '<div class="kysch-big">' +
          '<div class="lbl">D-DAY</div>' +
          '<div class="num" id="kysch-num">--</div>' +
          '<div class="unit">DAYS LEFT</div>' +
        '</div>' +
        '<div class="kysch-mid">' +
          '<div class="kysch-title"><i></i><b>考研倒计时 · 每日任务</b></div>' +
          '<div class="kysch-meta">' +
            '<span class="kysch-tag">今日 <b id="kysch-todo">0</b></span>' +
            '<span class="kysch-tag">本周 <b id="kysch-week">0</b></span>' +
            '<span class="kysch-tag hot">顺延 <b id="kysch-carry">0</b></span>' +
            '<span class="kysch-tag">完成 <b id="kysch-cdone">0</b>/<b id="kysch-call">0</b></span>' +
          '</div>' +
          '<div class="kysch-prog"><i id="kysch-bar"></i></div>' +
        '</div>' +
        '<button class="kysch-open" id="kysch-open" aria-label="打开日程表"><em>▤</em>日程</button>' +
      '</div>' +
    '</div>';

  var fab = null;
  if (!BARE) {
    fab = document.createElement("button");
    fab.className = "kysch-fab";
    fab.id = "kysch-fab";
    fab.setAttribute("aria-label", "打开日程表");
    fab.innerHTML = '▤<span id="kysch-fabn">0</span>';
    document.body.appendChild(fab);
  } else {
    host.innerHTML = "";
  }

  var ov = document.createElement("div");
  ov.className = "kysch-ov";
  ov.id = "kysch-ov";
  ov.innerHTML =
    '<div class="kysch-hd">' +
      '<div><div class="t">SCHEDULE</div><div class="d" id="kysch-hdsub">考研日程</div></div>' +
      '<button class="kysch-x" id="kysch-x" aria-label="关闭">✕</button>' +
    '</div>' +
    '<div class="kysch-tabs" id="kysch-tabs">' +
      '<button class="on" data-tab="day"><b>日</b><span>每日任务</span></button>' +
      '<button data-tab="week"><b>周</b><span>每周目标</span></button>' +
    '</div>' +
    '<div class="kysch-body">' +
      '<div class="kysch-view" id="kysch-view-day">' +
        '<div class="kysch-card">' +
          '<div class="kysch-calhd">' +
            '<div class="m"><span id="kysch-ym"></span><small id="kysch-ymsub"></small></div>' +
            '<div class="kysch-nav">' +
              '<button id="kysch-prev" aria-label="上个月">‹</button>' +
              '<button id="kysch-today" class="tdy">今天</button>' +
              '<button id="kysch-next" aria-label="下个月">›</button>' +
            '</div>' +
          '</div>' +
          '<div class="kysch-wk"><span class="we">日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span class="we">六</span></div>' +
          '<div class="kysch-grid" id="kysch-grid"></div>' +
          '<div class="kysch-lg">' +
            '<span><i class="a"></i>全完成</span><span><i class="b"></i>部分</span>' +
            '<span><i class="c"></i>有遗漏</span><span><i class="d"></i>考试日</span>' +
          '</div>' +
        '</div>' +
        '<div class="kysch-card">' +
          '<div class="kysch-ptxt" id="kysch-daysub"></div>' +
          '<div id="kysch-list"></div>' +
          '<div class="kysch-add">' +
            '<input id="kysch-input" type="text" maxlength="120" placeholder="写一个今日任务…" enterkeyhint="done" autocomplete="off">' +
            '<button id="kysch-addbtn" aria-label="添加">＋</button>' +
          '</div>' +
        '</div>' +
        '<div class="kysch-ptxt" style="text-align:center;padding:2px 0 6px">未完成的任务会自动顺延到下一天 · 长按任务文字可修改</div>' +
      '</div>' +
      '<div class="kysch-view" id="kysch-view-week" style="display:none">' +
        '<div class="kysch-card">' +
          '<div class="kysch-calhd">' +
            '<div class="m"><span id="kysch-wkno"></span><small id="kysch-wksub"></small></div>' +
            '<div class="kysch-nav">' +
              '<button id="kysch-wprev" aria-label="上一周">‹</button>' +
              '<button id="kysch-wtoday" class="tdy">本周</button>' +
              '<button id="kysch-wnext" aria-label="下一周">›</button>' +
            '</div>' +
          '</div>' +
          '<div class="kysch-wprog"><i id="kysch-wbar"></i></div>' +
          '<div class="kysch-ptxt" id="kysch-wrange" style="padding:7px 6px 0"></div>' +
          '<div id="kysch-wlist" style="margin-top:4px"></div>' +
          '<div class="kysch-add">' +
            '<input id="kysch-winput" type="text" maxlength="120" placeholder="写一个本周目标…" enterkeyhint="done" autocomplete="off">' +
            '<button id="kysch-waddbtn" aria-label="添加">＋</button>' +
          '</div>' +
        '</div>' +
        '<div class="kysch-ptxt" style="text-align:center;padding:2px 0 6px">周任务按「周一到周日」结算 · 没做完的会自动滚到下一周 · 长按可修改</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  var toastEl = document.createElement("div");
  toastEl.className = "kysch-toast";
  document.body.appendChild(toastEl);
  var tid = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(tid);
    tid = setTimeout(function () { toastEl.classList.remove("on"); }, 1800);
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 顶部条 ---------- */
  var statsCache = null, onStats = null;
  function renderStrip() {
    var left = spanDays(todayStr, EXAM);
    if (!BARE) $("kysch-num").textContent = left >= 0 ? left : "0";

    var a = activeOn(todayStr), todo = 0, carry = 0;
    for (var i = 0; i < a.all.length; i++) if (!doneAsOf(a.all[i], todayStr)) todo++;
    for (var j = 0; j < a.carry.length; j++) if (!doneAsOf(a.carry[j], todayStr)) carry++;

    var wks = weekTasksOf(todayStr), wkTodo = 0;
    for (var w = 0; w < wks.all.length; w++) if (!weekDoneAsOf(wks.all[w], todayStr)) wkTodo++;

    var doneAll = 0;
    for (var k = 0; k < DB.tasks.length; k++) if (DB.tasks[k].done) doneAll++;

    var tTodo = $("kysch-todo"), tCarry = $("kysch-carry");
    var tDone = $("kysch-cdone"), tAll = $("kysch-call"), tBar = $("kysch-bar");
    var tWeek = $("kysch-week");
    if (tWeek) tWeek.textContent = wkTodo;
    if (tTodo) tTodo.textContent = todo;
    if (tCarry) tCarry.textContent = carry;
    if (tDone) tDone.textContent = doneAll;
    if (tAll) tAll.textContent = DB.tasks.length;

    if (tBar) {
      var span = Math.max(1, spanDays(START, EXAM));
      var pct = Math.max(0, Math.min(100, (spanDays(START, todayStr) / span) * 100));
      if (left < 0) pct = 100;
      tBar.style.width = pct.toFixed(1) + "%";
    }

    var badgeN = todo + wkTodo;
    statsCache = { days: (left >= 0 ? left : 0), todo: todo, carry: carry, week: wkTodo,
                   done: doneAll, total: DB.tasks.length };
    if (fab) {
      var fabN = $("kysch-fabn");
      if (badgeN > 0) { fab.classList.remove("zero"); fabN.textContent = badgeN > 99 ? "99+" : badgeN; }
      else fab.classList.add("zero");
    }
    if (typeof onStats === "function") { try { onStats(statsCache); } catch (e) {} }
  }

  /* ---------- 日历 ---------- */
  var viewY, viewM;
  (function () {
    var base = parseDay(todayStr);
    if (todayStr < START) base = parseDay(START);
    if (todayStr > EXAM) base = parseDay(EXAM);
    viewY = base.getFullYear(); viewM = base.getMonth();
  })();
  function mi(y, m) { return y * 12 + m; }
  var minIdx = mi(parseDay(START).getFullYear(), parseDay(START).getMonth());
  var maxIdx = mi(parseDay(EXAM).getFullYear(), parseDay(EXAM).getMonth());

  function renderCal() {
    $("kysch-ym").textContent = viewY + "." + pad(viewM + 1);
    var sub = [];
    if (todayStr >= START && todayStr <= EXAM &&
        mi(viewY, viewM) === mi(parseDay(todayStr).getFullYear(), parseDay(todayStr).getMonth())) sub.push("本月");
    if (viewY === 2026 && viewM === 11) sub.push("冲刺");
    $("kysch-ymsub").textContent = sub.join(" · ");

    var idx = mi(viewY, viewM);
    $("kysch-prev").disabled = idx <= minIdx;
    $("kysch-next").disabled = idx >= maxIdx;

    var startWk = new Date(viewY, viewM, 1).getDay();
    var dim = new Date(viewY, viewM + 1, 0).getDate();
    var html = "";
    for (var i = 0; i < startWk; i++) html += '<div class="kd pad"></div>';

    for (var d = 1; d <= dim; d++) {
      var ds = viewY + "-" + pad(viewM + 1) + "-" + pad(d);
      var dow = new Date(viewY, viewM, d).getDay();
      var cls = "kd";
      if (dow === 0 || dow === 6) cls += " we";

      if (ds < START || ds > EXAM) {
        cls += " out";
        html += '<div class="' + cls + '"><span class="n">' + d + "</span></div>";
        continue;
      }
      var st = dayStat(ds);
      if (ds === EXAM) cls += " exam";
      else if (st.total > 0) {
        if (st.done >= st.total) cls += " full";
        else if (st.done === 0) cls += " zero";
        else cls += " part";
      }
      if (ds === todayStr) cls += " today";
      var txt = ds === EXAM ? "" : (st.total > 0 ? st.done + "/" + st.total : "");
      html += '<button class="' + cls + '" data-d="' + ds + '"><span class="n">' + d + "</span>" +
              (txt ? '<span class="c">' + txt + "</span>" : "") + "</button>";
    }
    $("kysch-grid").innerHTML = html;
  }

  /* ---------- 当天列表 ---------- */
  var WK = "日一二三四五六";
  function renderList() {
    var a = activeOn(curDay);
    var left = spanDays(curDay, EXAM);
    var sub = [];
    if (curDay === todayStr) sub.push("今天");
    if (left > 0) sub.push("距考试 " + left + " 天");
    else if (left === 0) sub.push("考试日 · 稳住");
    $("kysch-daysub").innerHTML = "<b>" + mmdd(curDay) + " " + "周" + WK[parseDay(curDay).getDay()] +
      "</b> · " + sub.join(" · ");
    $("kysch-hdsub").textContent = curDay.replace(/-/g, ".") + " · 周" + WK[parseDay(curDay).getDay()];

    var html = "";
    if (a.carry.length) {
      var cd = 0;
      for (var i = 0; i < a.carry.length; i++) if (doneAsOf(a.carry[i], curDay)) cd++;
      html += '<div class="kysch-sec">⟳ 顺延任务 <em>' + cd + "/" + a.carry.length + "</em></div>";
      html += a.carry.map(function (t) { return row(t, true); }).join("");
    }
    html += '<div class="kysch-sec">✍ 今日任务 <em>' + a.today.length + "</em></div>";
    if (a.today.length) html += a.today.map(function (t) { return row(t, false); }).join("");
    else html += '<div class="kysch-empty">今天还没写任务<br>下面输入框加一条 ↓</div>';

    if (!a.carry.length && !a.today.length) {
      html = '<div class="kysch-empty">🧘 这一天是空白的<br>想好要做什么，就写下来</div>';
    }
    $("kysch-list").innerHTML = html;
  }

  /* ---------- 周视图 ---------- */
  var curWeek = weekStartOf(todayStr);

  function renderWeek() {
    var d = weekTasksOf(curWeek);
    var nowW = weekStartOf(todayStr);
    var wno = weekNo(d.wk);
    $("kysch-wkno").textContent = d.wk.slice(5).replace("-", ".") + " 起";
    var sub = [];
    if (d.wk === nowW) sub.push("本周");
    else if (d.wk < nowW) sub.push("已过");
    sub.push("第 " + wno + " 周");
    $("kysch-wksub").textContent = sub.join(" · ");
    $("kysch-wrange").innerHTML = "<b>" + mmdd(d.wk) + " – " + mmdd(d.end) + "</b> · 共 " +
      d.all.length + " 项，已完成 " + d.all.filter(function (t) { return weekDoneAsOf(t, curWeek); }).length;

    var done = 0;
    for (var i = 0; i < d.all.length; i++) if (weekDoneAsOf(d.all[i], curWeek)) done++;
    $("kysch-wbar").style.width = (d.all.length ? Math.round(done / d.all.length * 100) : 0) + "%";

    var html = "";
    if (d.carry.length) {
      var cd = 0;
      for (var j = 0; j < d.carry.length; j++) if (weekDoneAsOf(d.carry[j], curWeek)) cd++;
      html += '<div class="kysch-sec">⟳ 上周遗留 <em>' + cd + "/" + d.carry.length + "</em></div>";
      html += d.carry.map(function (t) { return wrow(t, true); }).join("");
    }
    html += '<div class="kysch-sec">◎ 本周目标 <em>' + d.normal.length + "</em></div>";
    if (d.normal.length) html += d.normal.map(function (t) { return wrow(t, false); }).join("");
    else html += '<div class="kysch-empty">这周还没定目标<br>下面输入框加一条 ↓</div>';
    if (!d.carry.length && !d.normal.length) {
      html = '<div class="kysch-empty">🗓 这一周是空白的<br>先定几个能验收的目标</div>';
    }
    $("kysch-wlist").innerHTML = html;

    // 周翻页按钮状态
    var minW = weekStartOf(START), maxW = weekStartOf(EXAM);
    $("kysch-wprev").disabled = curWeek <= minW;
    $("kysch-wnext").disabled = curWeek >= maxW;
  }

  function wrow(t, isCarry) {
    var ok = weekDoneAsOf(t, curWeek);
    var badge = isCarry ? '<span class="kysch-badge">⟳ ' + mmdd(t.date) + " 周</span>" : "";
    var doneon = (ok && weekStartOf(t.doneOn) !== curWeek)
      ? '<span class="kysch-done">' + mmdd(t.doneOn) + " 完成</span>" : "";
    return '<div class="kysch-task' + (ok ? " ok" : "") + '" data-wid="' + t.id + '">' +
      '<button class="kysch-ck" data-act="wtoggle" aria-label="完成">' + (ok ? "✓" : "") + "</button>" +
      '<div class="kysch-tx" data-act="wtoggle">' + badge + esc(t.text) + doneon + "</div>" +
      '<button class="kysch-del" data-act="wdel" aria-label="删除">✕</button>' +
      "</div>";
  }

  function toggleWeek(id) {
    var t = find(id);
    if (!t) return;
    if (t.done) { t.done = false; t.doneOn = null; }
    else { t.done = true; t.doneOn = todayStr; }
    t.up = Date.now();
    save(); renderAll();
    if (ov.classList.contains("on") && curTab === "week") renderWeek();
    toast(t.done ? "本周目标达成 ✓" : "已取消");
  }

  function addWeek() {
    var inp = $("kysch-winput");
    var v = inp.value.replace(/\s+/g, " ").trim();
    if (!v) return;
    if (isDup(v, "week")) return;
    DB.tasks.push({ id: uid(), text: v, type: "week", date: curWeek,
                    done: false, doneOn: null, ts: Date.now(), up: Date.now() });
    inp.value = "";
    save(); renderAll(); renderWeek();
    toast("已加入本周");
  }

  function row(t, isCarry) {
    var ok = doneAsOf(t, curDay);
    var badge = isCarry ? '<span class="kysch-badge">⟳ ' + mmdd(t.date) + "</span>" : "";
    var doneon = (ok && t.doneOn !== curDay) ? '<span class="kysch-done">' + mmdd(t.doneOn) + " 完成</span>" : "";
    return '<div class="kysch-task' + (ok ? " ok" : "") + '" data-id="' + t.id + '">' +
      '<button class="kysch-ck" data-act="toggle" aria-label="完成">' + (ok ? "✓" : "") + "</button>" +
      '<div class="kysch-tx" data-act="toggle">' + badge + esc(t.text) + doneon + "</div>" +
      '<button class="kysch-del" data-act="del" aria-label="删除">✕</button>' +
      "</div>";
  }

  function find(id) {
    for (var i = 0; i < DB.tasks.length; i++) if (DB.tasks[i].id === id) return DB.tasks[i];
    return null;
  }
  function toggle(id) {
    var t = find(id);
    if (!t) return;
    if (t.done) { t.done = false; t.doneOn = null; }
    else { t.done = true; t.doneOn = curDay; }
    t.up = Date.now();
    save(); renderAll();
  }
  function del(id) {
    var t = find(id);
    if (!t) return;
    if (!window.confirm(isWeekTask(t) ? "删掉这条周目标？" : "删掉这条任务？")) return;
    DB.tasks = DB.tasks.filter(function (x) { return x.id !== id; });
    DB.tomb[id] = Date.now();
    save(); renderAll(); toast("已删除");
  }
  function edit(id) {
    var t = find(id);
    if (!t) return;
    var v = window.prompt("修改任务内容：", t.text);
    if (v === null) return;
    v = v.replace(/\s+/g, " ").trim();
    if (!v || v === t.text) return;
    t.text = v; t.up = Date.now(); save(); renderAll(); toast("已修改");
  }
  var lastAdd = { text: "", scope: "", ts: 0 };
  function isDup(v, scope) {
    var now = Date.now();
    if (lastAdd.text === v && lastAdd.scope === scope && (now - lastAdd.ts) < 1500) return true;
    lastAdd = { text: v, scope: scope, ts: now };
    return false;
  }

  function add() {
    var inp = $("kysch-input");
    var v = inp.value.replace(/\s+/g, " ").trim();
    if (!v) return;
    if (isDup(v, "day")) return;
    DB.tasks.push({ id: uid(), text: v, date: curDay, done: false, doneOn: null,
                    ts: Date.now(), up: Date.now() });
    inp.value = "";
    save(); renderAll();
    var b = document.querySelector(".kysch-body");
    if (b) b.scrollTop = b.scrollHeight;
  }

  /* ---------- Tab 切换 ---------- */
  var curTab = "day";
  function setTab(tab) {
    curTab = (tab === "week") ? "week" : "day";
    var bs = document.querySelectorAll("#kysch-tabs button");
    for (var i = 0; i < bs.length; i++) {
      bs[i].classList.toggle("on", bs[i].getAttribute("data-tab") === curTab);
    }
    $("kysch-view-day").style.display = curTab === "day" ? "" : "none";
    $("kysch-view-week").style.display = curTab === "week" ? "" : "none";
    document.querySelector(".kysch-body").scrollTop = 0;
    if (curTab === "week") renderWeek();
  }

  /* ---------- 打开 / 关闭 ---------- */
  function open(day) {
    if (day) curDay = day;
    else curDay = (todayStr < START ? START : (todayStr > EXAM ? EXAM : todayStr));
    curWeek = weekStartOf(curDay);
    renderList(); renderCal(); renderWeek();
    ov.classList.add("on");
    document.documentElement.style.overflow = "hidden";
  }
  function close() {
    ov.classList.remove("on");
    document.documentElement.style.overflow = "";
  }

  /* ---------- 事件 ---------- */
  var openBtn = $("kysch-open");
  if (openBtn) openBtn.addEventListener("click", function () { open(); });
  if (fab) fab.addEventListener("click", function () { open(); });
  $("kysch-x").addEventListener("click", close);

  $("kysch-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]");
    if (!b) return;
    setTab(b.getAttribute("data-tab"));
  });

  /* 周视图事件 */
  var wlistEl = $("kysch-wlist");
  wlistEl.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var r = el.closest(".kysch-task");
    if (!r) return;
    var id = r.getAttribute("data-wid");
    if (pressFiredW && el.getAttribute("data-act") === "wtoggle") { pressFiredW = false; return; }
    var act = el.getAttribute("data-act");
    if (act === "wdel") del(id);
    else toggleWeek(id);
  });
  var pressTimerW = null, pressFiredW = false;
  wlistEl.addEventListener("pointerdown", function (e) {
    var tx = e.target.closest(".kysch-tx");
    if (!tx) return;
    var r = tx.closest(".kysch-task");
    if (!r) return;
    pressFiredW = false;
    clearTimeout(pressTimerW);
    var id = r.getAttribute("data-wid");
    pressTimerW = setTimeout(function () {
      pressFiredW = true;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      edit(id);
    }, 550);
  });
  ["pointerup", "pointercancel", "pointerleave", "pointermove", "scroll"].forEach(function (ev) {
    wlistEl.addEventListener(ev, function () { clearTimeout(pressTimerW); }, { passive: true });
  });

  $("kysch-waddbtn").addEventListener("click", addWeek);
  $("kysch-winput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addWeek(); }
  });

  $("kysch-wprev").addEventListener("click", function () {
    if (curWeek <= weekStartOf(START)) return;
    var d = parseDay(curWeek); d.setDate(d.getDate() - 7); curWeek = fmt(d); renderWeek();
  });
  $("kysch-wnext").addEventListener("click", function () {
    if (curWeek >= weekStartOf(EXAM)) return;
    var d = parseDay(curWeek); d.setDate(d.getDate() + 7); curWeek = fmt(d); renderWeek();
  });
  $("kysch-wtoday").addEventListener("click", function () {
    curWeek = weekStartOf(todayStr); renderWeek();
  });

  $("kysch-grid").addEventListener("click", function (e) {
    var el = e.target.closest("button.kd");
    if (!el || el.classList.contains("pad") || el.classList.contains("out")) return;
    var ds = el.getAttribute("data-d");
    if (!ds) return;
    curDay = ds;
    renderList();
    document.querySelector(".kysch-body").scrollTop = 0;
  });

  var pressTimer = null, pressFired = false;
  var listEl = $("kysch-list");
  listEl.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var r = el.closest(".kysch-task");
    if (!r) return;
    var id = r.getAttribute("data-id");
    if (pressFired && el.getAttribute("data-act") === "toggle") { pressFired = false; return; }
    if (el.getAttribute("data-act") === "del") del(id);
    else toggle(id);
  });
  listEl.addEventListener("pointerdown", function (e) {
    var tx = e.target.closest(".kysch-tx");
    if (!tx) return;
    var r = tx.closest(".kysch-task");
    if (!r) return;
    pressFired = false;
    clearTimeout(pressTimer);
    var id = r.getAttribute("data-id");
    pressTimer = setTimeout(function () {
      pressFired = true;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
      edit(id);
    }, 550);
  });
  ["pointerup", "pointercancel", "pointerleave", "pointermove", "scroll"].forEach(function (ev) {
    listEl.addEventListener(ev, function () { clearTimeout(pressTimer); }, { passive: true });
  });

  $("kysch-addbtn").addEventListener("click", add);
  $("kysch-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); add(); }
  });

  $("kysch-prev").addEventListener("click", function () {
    if (mi(viewY, viewM) - 1 < minIdx) return;
    viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderCal();
  });
  $("kysch-next").addEventListener("click", function () {
    if (mi(viewY, viewM) + 1 > maxIdx) return;
    viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderCal();
  });
  $("kysch-today").addEventListener("click", function () {
    var base = parseDay(todayStr);
    if (todayStr < START) base = parseDay(START);
    if (todayStr > EXAM) base = parseDay(EXAM);
    viewY = base.getFullYear(); viewM = base.getMonth();
    curDay = todayStr < START ? START : (todayStr > EXAM ? EXAM : todayStr);
    renderCal(); renderList();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && ov.classList.contains("on")) close();
  });

  function renderAll() {
    renderStrip(); renderCal();
    if (ov.classList.contains("on")) { renderList(); renderWeek(); }
  }

  load();
  renderAll();

  /* ---------- 跨设备同步 API ---------- */
  function snapshot() {
    return { v: 1, ts: Date.now(), tasks: DB.tasks, tomb: DB.tomb || {} };
  }
  function mergeRemote(remote) {
    if (!remote || !Array.isArray(remote.tasks)) return 0;
    var byId = {}, tomb = {};
    var t0 = DB.tomb || {}, t1 = remote.tomb || {};
    for (var a in t0) tomb[a] = t0[a];
    for (var b in t1) if (!tomb[b] || t1[b] > tomb[b]) tomb[b] = t1[b];

    for (var i = 0; i < DB.tasks.length; i++) byId[DB.tasks[i].id] = DB.tasks[i];

    var changed = 0;
    for (var j = 0; j < remote.tasks.length; j++) {
      var r = remote.tasks[j];
      if (!r || !r.id || !r.date || typeof r.text !== "string") continue;
      var c = byId[r.id];
      if (!c) {
        var o = { id: r.id, text: r.text, date: r.date, done: !!r.done,
                  doneOn: r.doneOn || null, ts: r.ts || Date.now(),
                  up: r.up || r.ts || Date.now() };
        if (r.type === "week") o.type = "week";
        byId[r.id] = o;
        changed++;
        continue;
      }
      var cu = c.up || c.ts || 0, ru = r.up || r.ts || 0;
      if (ru > cu) {
        c.text = r.text;
        c.date = r.date;
        c.done = !!r.done;
        c.doneOn = r.doneOn || null;
        c.ts = r.ts || c.ts;
        c.up = ru;
        if (r.type === "week") c.type = "week"; else delete c.type;
        changed++;
      }
    }

    var list = [];
    for (var id in byId) {
      var t = byId[id];
      if (tomb[id] && tomb[id] >= (t.up || t.ts || 0)) continue;
      list.push(t);
    }
    DB.tasks = list;
    DB.tomb = tomb;
    if (changed) { save(); renderAll(); }
    return changed;
  }

  window.KySch = {
    snapshot: snapshot,
    merge: mergeRemote,
    reload: function () { load(); renderAll(); },
    open: open,
    close: close,
    stats: function () { return statsCache; },
    openWeek: function () { open(); setTab("week"); },
    setTab: setTab,
    onStats: function (fn) { onStats = fn; if (statsCache) { try { fn(statsCache); } catch (e) {} } },
    refresh: renderAll
  };

  setInterval(function () {
    var now = fmt(new Date());
    if (now !== todayStr) { todayStr = now; renderAll(); }
  }, 60000);
})();
