/* ===== 跨设备同步（日程数据） v1 =====
   原理：用 ntfy.sh 公共消息总线当“信箱”，设备各自把整份快照压成一条消息发上去，
         另一台设备拉取后按时间戳合并。双向、无需账号、纯前端。
   依赖：schedule.js 暴露的 window.KySch（snapshot / merge）
   数据：localStorage  key = kysch_sync_room / kysch_sync_hash / kysch_sync_last
*/
(function () {
  "use strict";
  if (window.__kyschSyncInited) return;
  if (!window.KySch || typeof window.KySch.merge !== "function") return;
  window.__kyschSyncInited = true;

  var BASE = "https://ntfy.sh";
  var K_ROOM = "kysch_sync_room";
  var K_HASH = "kysch_sync_hash";
  var K_LAST = "kysch_sync_last";
  var MAX_MSG = 3800;          // ntfy 单条消息 4KB 上限，留点余量

  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function room() { return get(K_ROOM); }

  function newRoom() {
    var abc = "abcdefghijkmnpqrstuvwxyz23456789";
    var s = "";
    var buf = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (var i = 0; i < 12; i++) buf[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < 12; j++) s += abc[buf[j] % abc.length];
    return "kysch-" + s;
  }

  /* ---------- 编码：gzip + base64（不支持就退回纯 JSON） ---------- */
  function b64enc(bytes) {
    var s = "", i;
    for (i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(s);
  }
  function b64dec(str) {
    var bin = atob(str), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function canZip() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  }
  function encode(obj) {
    var json = JSON.stringify(obj);
    if (!canZip()) return Promise.resolve("j:" + json);
    try {
      var st = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Response(st).arrayBuffer().then(function (ab) {
        return "z:" + b64enc(new Uint8Array(ab));
      });
    } catch (e) { return Promise.resolve("j:" + json); }
  }
  function decode(msg) {
    if (typeof msg !== "string" || msg.length < 3) return Promise.resolve(null);
    var tag = msg.slice(0, 2), body = msg.slice(2);
    if (tag === "j:") {
      try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.resolve(null); }
    }
    if (tag !== "z:") return Promise.resolve(null);
    try {
      var st = new Blob([b64dec(body)]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Response(st).text().then(function (t) {
        try { return JSON.parse(t); } catch (e) { return null; }
      });
    } catch (e) { return Promise.resolve(null); }
  }

  /* ---------- 状态 ---------- */
  var state = { busy: false, last: 0, msg: "未开启" };
  var listeners = [];
  function emit() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](state); } catch (e) {} }
  }
  function setState(m) { state.msg = m; emit(); }

  /* ---------- 推 ---------- */
  function hashOf(snap) {
    var t = snap.tasks || [], s = "";
    for (var i = 0; i < t.length; i++) {
      s += t[i].id + ":" + (t[i].up || t[i].ts || 0) + ":" + (t[i].done ? 1 : 0) + ":" + t[i].text + "|";
    }
    var tomb = snap.tomb || {};
    for (var k in tomb) s += "x" + k + tomb[k];
    return s;
  }

  var lastPushAt = 0;
  function push(force) {
    var r = room();
    if (!r) return Promise.resolve(false);
    var snap = window.KySch.snapshot();
    var h = hashOf(snap);
    if (!force && h === get(K_HASH)) return Promise.resolve(false);
    var wait = 15000 - (Date.now() - lastPushAt);
    if (!force && wait > 0) {
      setTimeout(function () { push(true); }, wait);
      return Promise.resolve(false);
    }
    lastPushAt = Date.now();
    return encode(snap).then(function (body) {
      if (body.length > MAX_MSG) {
        setState("数据太大，先清理旧任务");
        return false;
      }
      return fetch(BASE + "/" + encodeURIComponent(r), {
        method: "POST",
        body: body,
        headers: { "X-Title": "kysch" }
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        set(K_HASH, h);
        set(K_LAST, String(Date.now()));
        setState("已上传 · " + nowStr());
        return true;
      });
    }).catch(function (e) {
      setState("上传失败（检查网络）");
      return false;
    });
  }

  /* ---------- 拉 ---------- */
  var pullChain = Promise.resolve();
  function pull() {
    pullChain = pullChain.then(doPull, doPull);
    return pullChain;
  }
  function doPull() {
    var r = room();
    if (!r) return Promise.resolve(false);
    var url = BASE + "/" + encodeURIComponent(r) + "/json?poll=1&since=all";
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }).then(function (text) {
      var lines = text.split("\n"), jobs = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var m;
        try { m = JSON.parse(line); } catch (e) { continue; }
        if (!m || m.event !== "message" || !m.message) continue;
        jobs.push(m.message);
      }
      if (!jobs.length) return false;

      var merged = 0;
      var seq = Promise.resolve();
      jobs.forEach(function (raw) {
        seq = seq.then(function () {
          return decode(raw).then(function (payload) {
            if (!payload || !payload.tasks) return;
            var n = window.KySch.merge(payload);
            if (n) merged += n;
          });
        });
      });
      return seq.then(function () {
        set(K_LAST, String(Date.now()));
        set(K_HASH, hashOf(window.KySch.snapshot()));
        if (merged) setState("已同步 · 收到 " + merged + " 条更新");
        else setState("已同步 · " + nowStr());
        return merged > 0;
      });
    }).catch(function (e) {
      setState("同步失败（检查网络）");
      return false;
    });
  }

  function nowStr() {
    var d = new Date();
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  /* ---------- 自动跑 ---------- */
  var lastHash = "";
  function tick() {
    if (!room()) return;
    if (document.hidden) return;
    var h = hashOf(window.KySch.snapshot());
    if (h !== lastHash) {
      lastHash = h;
      if (h !== get(K_HASH)) push(false);
    }
  }

  function start() {
    var r = room();
    if (!r) { emit(); return; }
    pull();
    setInterval(tick, 2500);
    setInterval(function () { if (!document.hidden) pull(); }, 25000);
    setInterval(function () {
      var c = document.getElementById("kysch-sync");
      if (!document.hidden && c && c.style.display !== "none") pull();
    }, 8000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { pull().then(function (ch) { if (ch) lastHash = hashOf(window.KySch.snapshot()); }); }
    });
    window.addEventListener("focus", function () { pull(); });
  }

  /* ---------- UI ---------- */
  var CSS = "" +
    ".kysch-sync{position:relative;z-index:2;margin:0 12px 10px;padding:12px 13px;border-radius:14px;" +
      "background:linear-gradient(160deg,rgba(34,211,238,.10),rgba(168,85,247,.10));" +
      "border:1px solid rgba(120,190,255,.22);color:#cfe4ff;font-size:12.5px;line-height:1.6}" +
    ".kysch-sync h4{margin:0 0 8px;font-size:12px;letter-spacing:.12em;color:#7fdbff;font-weight:800}" +
    ".kysch-sync .ks-code{font-family:ui-monospace,Menlo,monospace;font-size:15px;letter-spacing:.08em;" +
      "color:#9ef;background:rgba(0,0,0,.35);border-radius:9px;padding:8px 10px;margin:6px 0;word-break:break-all}" +
    ".kysch-sync .ks-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}" +
    ".kysch-sync button{flex:1 1 auto;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;" +
      "padding:8px 10px;border-radius:9px;border:1px solid rgba(120,190,255,.28);" +
      "background:rgba(255,255,255,.06);color:#cfe4ff}" +
    ".kysch-sync button.pri{background:linear-gradient(135deg,#22d3ee,#60a5fa);color:#04121f;border-color:transparent}" +
    ".kysch-sync input{width:100%;box-sizing:border-box;margin-top:8px;padding:9px 10px;border-radius:9px;" +
      "border:1px solid rgba(120,190,255,.28);background:rgba(0,0,0,.3);color:#dff;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}" +
    ".kysch-sync .ks-st{color:#8fb4d8;font-size:11.5px;margin-top:7px}" +
    ".kysch-sync .ks-st b{color:#7fdbff;font-weight:700}" +
    ".kysch-syncbtn{width:38px;height:38px;border-radius:11px;border:1px solid rgba(120,190,255,.25);" +
      "background:rgba(255,255,255,.05);color:#9ef;font-size:15px;cursor:pointer;display:flex;" +
      "align-items:center;justify-content:center;margin-right:8px}" +
    ".kysch-syncbtn.on{background:linear-gradient(135deg,#22d3ee,#60a5fa);color:#04121f;border-color:transparent}";

  function injectUI() {
    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    var hd = document.querySelector(".kysch-hd");
    var body = document.querySelector(".kysch-body");
    if (!body) return;

    var btn = document.createElement("button");
    btn.className = "kysch-syncbtn";
    btn.id = "kysch-syncbtn";
    btn.setAttribute("aria-label", "跨设备同步");
    btn.textContent = "⇅";
    var closeBtn = document.getElementById("kysch-x");
    if (hd && closeBtn) hd.insertBefore(btn, closeBtn);

    var card = document.createElement("div");
    card.className = "kysch-sync";
    card.id = "kysch-sync";
    card.style.display = "none";
    card.innerHTML =
      '<h4>⇅ 跨设备同步</h4>' +
      '<div>把房间码在另一台设备填一次，两台就共享同一份日程。</div>' +
      '<div class="ks-code" id="ks-code">未开启</div>' +
      '<div class="ks-row">' +
        '<button id="ks-new" class="pri">开启同步</button>' +
        '<button id="ks-copy">复制房间码</button>' +
        '<button id="ks-now">立即同步</button>' +
      '</div>' +
      '<input id="ks-input" type="text" placeholder="粘贴另一台设备的房间码…" autocomplete="off">' +
      '<div class="ks-row"><button id="ks-join">加入这个房间</button>' +
        '<button id="ks-off">关闭同步</button></div>' +
      '<div class="ks-st" id="ks-st">未开启</div>' +
      '<div class="ks-st" style="opacity:.75">日程内容会经过第三方公共通道（ntfy.sh）中转，房间码就相当于钥匙，别外传；不放心就手动用导出/导入。</div>';
    body.insertBefore(card, body.firstChild);

    btn.addEventListener("click", function () {
      var on = card.style.display === "none";
      card.style.display = on ? "" : "none";
      btn.classList.toggle("on", on);
      if (on) { render(); if (room()) pull(); }
    });

    document.getElementById("ks-new").addEventListener("click", function () {
      if (room() && !window.confirm("已经有房间码了，重新开启会生成新的（旧数据不会丢，只是另一台要重新填）。继续？")) return;
      set(K_ROOM, newRoom());
      set(K_HASH, "");
      render();
      push(true).then(function () { pull(); });
      start();
      alert("房间码已生成，复制它去另一台设备填一次即可。");
    });

    document.getElementById("ks-copy").addEventListener("click", function () {
      var c = room();
      if (!c) { alert("还没开启同步"); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c).then(function () { alert("已复制：" + c); },
          function () { alert("复制失败，请手动记下：" + c); });
      } else { alert("房间码：" + c); }
    });

    document.getElementById("ks-now").addEventListener("click", function () {
      if (!room()) { alert("先开启同步，或填别人的房间码加入"); return; }
      setState("同步中…");
      pull().then(function () { return push(false); }).then(function () {
        var s = window.KySch.stats && window.KySch.stats();
        if (s) setState("已同步 · 今日 " + s.todo + " 项 / 本周 " + (s.week || 0) + " 项 · " + nowStr());
      });
    });

    document.getElementById("ks-join").addEventListener("click", function () {
      var v = document.getElementById("ks-input").value.trim().toLowerCase();
      if (!v) { alert("先粘贴房间码"); return; }
      if (!/^kysch-[a-z0-9]{6,40}$/.test(v)) { alert("房间码格式不对，应该是 kysch-xxxxxx 这样"); return; }
      if (room() && room() !== v &&
          !window.confirm("本机已有房间码 " + room() + "，改成 " + v + " 后会以对方的数据合并。继续？")) return;
      set(K_ROOM, v);
      set(K_HASH, "");
      document.getElementById("ks-input").value = "";
      render();
      setState("正在拉取…");
      pull().then(function () { return push(false); }).then(function () { start(); });
    });

    document.getElementById("ks-off").addEventListener("click", function () {
      if (!window.confirm("关闭后本机不再上传/接收，本地数据保留。继续？")) return;
      set(K_ROOM, ""); set(K_HASH, ""); set(K_LAST, "");
      render();
      setState("未开启");
    });

    listeners.push(function (s) {
      var st1 = document.getElementById("ks-st");
      var btn2 = document.getElementById("kysch-syncbtn");
      if (st1) st1.innerHTML = "<b>" + s.msg + "</b>";
      if (btn2) btn2.classList.toggle("on", !!room());
    });
  }

  function render() {
    var c = document.getElementById("ks-code");
    if (c) c.textContent = room() || "未开启";
  }

  function boot() {
    injectUI();
    render();
    emit();
    start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.KySync = {
    room: room,
    pull: pull,
    push: push,
    status: function () { return state; }
  };
})();
