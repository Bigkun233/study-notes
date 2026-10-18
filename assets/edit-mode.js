/* ===== 笔记编辑模式 v3 =====
 * 页面内直接改内容：文字所见即所得，公式点一下弹 LaTeX 编辑器。
 * 自动存本机（localStorage），可导出 HTML 发回发布。
 * 数学 / 英语 / 408 三本笔记通用。
 */
(function () {
  if (window.__EM_LOADED) return;
  window.__EM_LOADED = 1;

  var PATH = location.pathname;
  var KEY_BODY = "em:body:" + PATH;
  var KEY_ON = "em:on:" + PATH;

  var SEL = "h1,h2,h3,h4,p,li,td,th,.note,.warn";
  var HOT = "#em-bar,#em-hint,#em-src,#em-tex,#em-toast,#em-out";

  var editing = false, srcMode = false, bound = false, silent = false;
  var undoStack = [], redoStack = [];
  var savedRange = null, texTarget = null;

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function mk(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function posts() { return $$(SEL).filter(function (n) { return !n.closest(HOT); }); }

  function toast(msg) {
    var t = $("#em-toast"); if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove("on"); }, 2000);
  }

  /* ---------- KaTeX ---------- */
  function katexHTML(tex, disp) {
    try {
      return window.katex.renderToString(tex, {
        displayMode: !!disp, throwOnError: false
      });
    } catch (e) { return null; }
  }

  function rerender() {
    if (!window.renderMathInElement) return;
    try {
      renderMathInElement(document.body, {
        delimiters: [
          { left: "\\[", right: "\\]", display: true },
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false,
        ignoredClasses: ["em-tex-in"],
        ignoreTags: ["script", "noscript", "style", "textarea", "pre", "code"]
      });
    } catch (e) { }
  }

  /* 源码 → 公式岛（编辑态用） */
  function toIslands(root) {
    $$(".katex", root).forEach(function (k) {
      if (k.closest(".em-tex-in")) return;
      var a = k.querySelector('annotation[encoding="application/x-tex"]');
      var holder = k.closest(".katex-display") || k;
      if (!holder.parentNode) return;
      var disp = !!k.closest(".katex-display");
      var tex = a ? a.textContent : "";
      if (!tex) return;
      holder.parentNode.replaceChild(island(tex, disp), holder);
    });
  }

  /* 公式岛 → 直接渲染好的公式节点（退出编辑用，避免包裹层越套越多） */
  function settleIslands(root) {
    $$(".em-tex-in", root).forEach(function (s) {
      var tex = s.getAttribute("data-tex") || "";
      var disp = s.getAttribute("data-disp") === "1";
      var tmp = document.createElement("span");
      tmp.innerHTML = katexHTML(tex, disp) || "";
      var node = tmp.firstElementChild;
      if (!node) node = document.createTextNode(disp ? "\\[" + tex + "\\]" : "\\(" + tex + "\\)");
      if (s.parentNode) s.parentNode.replaceChild(node, s);
    });
  }

  function island(tex, disp) {
    var s = document.createElement("span");
    s.className = "em-tex-in";
    s.setAttribute("contenteditable", "false");
    s.setAttribute("data-tex", tex);
    s.setAttribute("data-disp", disp ? "1" : "0");
    s.title = "点我编辑公式";
    s.innerHTML = katexHTML(tex, disp) || "";
    if (disp) s.classList.add("em-tex-disp");
    return s;
  }

  /* 全部还原成源码文本（保存 / 导出用） */
  function toSource(root) {
    settleIslands(root);
    $$(".katex", root).forEach(function (k) {
      var a = k.querySelector('annotation[encoding="application/x-tex"]');
      var holder = k.closest(".katex-display") || k;
      if (!holder.parentNode) return;
      var disp = !!k.closest(".katex-display");
      var tex = a ? a.textContent : "";
      var txt = document.createTextNode(disp ? "\\[" + tex + "\\]" : "\\(" + tex + "\\)");
      var P = holder.parentNode;
      P.replaceChild(txt, holder);
      // auto-render 会包一层空 class 的 span，导出时顺手拆掉，保持源码干净
      if (P && P.tagName === "SPAN" && !P.getAttribute("class") && P.childNodes.length === 1) {
        P.parentNode.replaceChild(txt, P);
      }
    });
  }

  /* ---------- 存取 ---------- */
  function cleanBody() {
    var clone = document.body.cloneNode(true);
    $$(HOT, clone).forEach(function (n) { n.remove(); });
    toSource(clone);
    $$("[contenteditable]", clone).forEach(function (n) {
      n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck");
    });
    return clone.innerHTML;
  }

  function persist() {
    try { localStorage.setItem(KEY_BODY, cleanBody()); }
    catch (e) { toast("本机存储满了，先导出一份"); }
    updateBar();
  }

  function hasSaved() {
    try { return !!localStorage.getItem(KEY_BODY); } catch (e) { return false; }
  }

  function loadSaved() {
    var html;
    try { html = localStorage.getItem(KEY_BODY); } catch (e) { return false; }
    if (!html) return false;
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    $$(HOT, tmp).forEach(function (n) { n.remove(); });
    document.body.innerHTML = tmp.innerHTML;
    return true;
  }

  /* ---------- 撤销 / 重做 ---------- */
  function pushUndo(node) {
    if (!node) return;
    undoStack.push({ n: node, html: node.innerHTML });
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    var s = undoStack.pop();
    if (!s || !document.body.contains(s.n)) return toast("没有可撤销的了");
    redoStack.push({ n: s.n, html: s.n.innerHTML });
    setInner(s.n, s.html);
    persist(); toast("已撤销");
  }

  function redo() {
    var s = redoStack.pop();
    if (!s || !document.body.contains(s.n)) return toast("没有可重做的了");
    undoStack.push({ n: s.n, html: s.n.innerHTML });
    setInner(s.n, s.html);
    persist(); toast("已重做");
  }

  // 写入快照并让公式重新变成可点编辑的岛
  function setInner(node, html) {
    node.innerHTML = html;
    if (editing) toIslands(node);
    else rerender();
  }

  /* ---------- UI ---------- */
  function buildUI() {
    $$(HOT).forEach(function (n) { n.remove(); });

    var bar = mk("div"); bar.id = "em-bar";
    bar.innerHTML =
      '<button class="em-b" data-em="edit">✏️ 编辑</button>' +
      '<button class="em-b" data-em="tex">∑ 公式</button>' +
      '<button class="em-b" data-em="src">&lt;/&gt;</button>' +
      '<button class="em-b" data-em="undo">↶</button>' +
      '<button class="em-b" data-em="redo">↷</button>' +
      '<button class="em-b" data-em="revert">还原</button>' +
      '<button class="em-b primary" data-em="export">⤓ 导出</button>';
    document.body.appendChild(bar);

    var hint = mk("div"); hint.id = "em-hint";
    hint.textContent = "编辑中：点文字直接改 · 点公式改 LaTeX · 完事点「✓ 保存」";
    document.body.appendChild(hint);

    var src = mk("div"); src.id = "em-src";
    var top = mk("div", "em-src-top");
    top.innerHTML = '<span style="flex:1">整页源码（可大段改，慎动标签）</span>';
    var bc = mk("button", "em-b", "取消");
    var ba = mk("button", "em-b on", "应用");
    top.appendChild(bc); top.appendChild(ba);
    var area = mk("textarea"); area.spellcheck = false;
    src.appendChild(top); src.appendChild(area);
    document.body.appendChild(src);
    bc.onclick = function () { setSrc(false); };
    ba.onclick = applySrc;

    var tex = mk("div"); tex.id = "em-tex";
    tex.innerHTML =
      '<div class="em-tex-box">' +
        '<div class="em-tex-t">编辑公式（LaTeX）</div>' +
        '<textarea spellcheck="false" placeholder="例如：\\frac{\\partial z}{\\partial x}"></textarea>' +
        '<div class="em-tex-btns">' +
          '<button data-em-tex="cancel">取消</button>' +
          '<button class="ok" data-em-tex="ok">确定</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(tex);
    tex.addEventListener("click", function (e) {
      var b = e.target.closest("[data-em-tex]");
      if (!b) { if (e.target === tex) closeTex(); return; }
      if (b.getAttribute("data-em-tex") === "ok") commitTex(); else closeTex();
    });

    var t = mk("div"); t.id = "em-toast";
    document.body.appendChild(t);

    bar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bar.addEventListener("click", onBar);
    updateBar();
  }

  function updateBar() {
    var bar = $("#em-bar"); if (!bar) return;
    var eb = bar.querySelector('[data-em="edit"]');
    eb.classList.toggle("on", editing);
    eb.textContent = editing ? "✓ 保存" : "✏️ 编辑";
    bar.querySelector('[data-em="revert"]').disabled = !hasSaved() && !editing;
  }

  function onBar(e) {
    var b = e.target.closest("[data-em]"); if (!b) return;
    var a = b.getAttribute("data-em");
    if (a === "edit") return setEdit(!editing);
    if (a === "export") return exportHTML();
    if (!editing) setEdit(true);
    if (a === "tex") return openTex();
    if (a === "src") return setSrc(true);
    if (a === "undo") return undo();
    if (a === "redo") return redo();
    if (a === "revert") return revertAll();
  }

  /* ---------- 编辑开关 ---------- */
  function setEdit(on) {
    if (srcMode) setSrc(false);
    editing = on;
    document.body.classList.toggle("em-editing", on);
    silent = true;
    if (on) {
      toIslands(document.body);
      posts().forEach(function (n) {
        n.setAttribute("contenteditable", "true");
        n.spellcheck = false;
      });
      undoStack.length = 0; redoStack.length = 0;
      updateBar();
    } else {
      posts().forEach(function (n) {
        n.removeAttribute("contenteditable");
        n.removeAttribute("spellcheck");
      });
      settleIslands(document.body);
      persist();
      rerender();
      silent = false;
      toast("已存到本机 · 点「导出」发回发布");
    }
    try { localStorage.setItem(KEY_ON, on ? "1" : "0"); } catch (e) { }
    updateBar();
  }

  /* ---------- 事件 ---------- */
  function bindOnce() {
    if (bound) return;
    bound = true;

    document.addEventListener("input", function (e) {
      if (!editing || srcMode || silent) return;
      var t = e.target;
      if (!t || !t.isContentEditable) return;
      clearTimeout(t._emT);
      t._emT = setTimeout(persist, 500);
    });

    document.addEventListener("focusin", function (e) {
      var t = e.target;
      if (!t || !t.isContentEditable) return;
      if (window.__EM_LAST !== t) {
        window.__EM_LAST = t;
        if (editing) pushUndo(t);
      }
    });

    document.addEventListener("paste", function (e) {
      if (!editing || srcMode) return;
      if (!e.target || !e.target.isContentEditable) return;
      e.preventDefault();
      var txt = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, txt);
    });

    document.addEventListener("keydown", function (e) {
      if (srcMode) return;
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (editing) setEdit(false); else exportHTML();
        return;
      }
    });

    // 点公式岛 → 改 LaTeX
    document.addEventListener("click", function (e) {
      if (!editing || srcMode) return;
      var s = e.target.closest && e.target.closest(".em-tex-in");
      if (!s) return;
      e.preventDefault(); e.stopPropagation();
      var cur = s.getAttribute("data-tex") || "";
      var v = prompt("编辑 LaTeX：", cur);
      if (v == null) return;
      v = v.trim();
      if (!v) return;
      var box = s.closest(SEL);
      pushUndo(box || s.parentNode);
      s.setAttribute("data-tex", v);
      s.innerHTML = katexHTML(v, s.getAttribute("data-disp") === "1") || "";
      persist();
      toast("公式已改");
    }, true);

    // 双击公式岛 → 快速删除
    document.addEventListener("dblclick", function (e) {
      if (!editing || srcMode) return;
      var s = e.target.closest && e.target.closest(".em-tex-in");
      if (!s) return;
      e.preventDefault();
      if (!confirm("删掉这个公式？")) return;
      pushUndo(s.closest(SEL) || s.parentNode);
      s.remove();
      persist();
    }, true);

    document.addEventListener("input", function (e) {
      // 空行补零宽字符，避免退格删不掉块
      if (!editing) return;
      var t = e.target;
      if (t && t.isContentEditable && t.tagName === "P" && !t.textContent.trim() && !t.querySelector(".em-tex-in")) {
        // 保持可聚焦，不做处理
      }
    });

    window.addEventListener("beforeunload", function (e) {
      if (editing && !silent) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ---------- 公式插入 ---------- */
  function openTex() {
    var sel = window.getSelection();
    var cur = document.activeElement;
    if (cur && cur.isContentEditable) window.__EM_LAST = cur;
    texTarget = (window.__EM_LAST && document.body.contains(window.__EM_LAST)) ? window.__EM_LAST : (posts()[0] || null);
    savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    var ta = $("#em-tex textarea");
    ta.value = "";
    $("#em-tex").classList.add("on");
    setTimeout(function () { ta.focus(); }, 50);
  }
  function closeTex() {
    var t = $("#em-tex"); if (t) t.classList.remove("on");
    texTarget = null; savedRange = null;
  }
  function commitTex() {
    var v = $("#em-tex textarea").value.trim();
    if (!v) return closeTex();
    var el = texTarget;
    if (!el || !document.body.contains(el)) { closeTex(); return toast("先点一下要插入的位置"); }
    pushUndo(el);
    var disp = /^\s*\\begin\{(align|gather|equation|cases|pmatrix|bmatrix|vmatrix|array|split)/.test(v) || /\n/.test(v);
    var node = island(v, disp);
    el.focus();
    var s = window.getSelection();
    if (savedRange && el.contains(savedRange.startContainer)) {
      s.removeAllRanges(); s.addRange(savedRange);
    }
    var r = s.rangeCount ? s.getRangeAt(0) : null;
    if (r && el.contains(r.startContainer)) {
      r.deleteContents(); r.insertNode(node);
      r.setStartAfter(node); r.collapse(true);
      s.removeAllRanges(); s.addRange(r);
    } else {
      el.appendChild(document.createTextNode(" "));
      el.appendChild(node);
    }
    closeTex(); persist();
    toast("公式已插入");
  }

  /* ---------- 源码模式 ---------- */
  function setSrc(on) {
    var src = $("#em-src"), area = $("#em-src textarea");
    if (on) {
      if (editing) setEdit(false);
      silent = true;
      area.value = serialize();
      srcMode = true;
      document.body.classList.add("em-src-on");
      setTimeout(function () { area.focus(); }, 60);
    } else {
      srcMode = false;
      document.body.classList.remove("em-src-on");
      silent = false;
    }
  }

  function applySrc() {
    var html = $("#em-src textarea").value;
    var m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    var inner = m ? m[1] : html;
    var tmp = document.createElement("div");
    tmp.innerHTML = inner;
    $$(HOT, tmp).forEach(function (n) { n.remove(); });
    document.body.innerHTML = tmp.innerHTML;
    document.body.classList.remove("em-src-on");
    srcMode = false;
    buildUI(); bindOnce();
    rerender();
    setEdit(true);
    persist();
    toast("源码已应用 · 记得导出");
  }

  /* ---------- 还原 / 导出 ---------- */
  function revertAll() {
    if (!confirm("清空这台设备上的所有修改，回到原始版本？")) return;
    try { localStorage.removeItem(KEY_BODY); localStorage.removeItem(KEY_ON); } catch (e) { }
    document.body.classList.remove("em-editing", "em-src-on");
    location.reload();
  }

  function serialize() {
    var clone = document.documentElement.cloneNode(true);
    $$(HOT, clone).forEach(function (n) { n.remove(); });
    toSource(clone);
    $$("[contenteditable]", clone).forEach(function (n) {
      n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck");
    });
    var b = clone.querySelector("body");
    if (b) b.className = "";
    return "<!DOCTYPE html>\n" + clone.outerHTML;
  }

  function exportHTML() {
    if (editing) setEdit(false);
    var html = serialize();
    var base = (document.title || "笔记").replace(/[\\/:*?"<>|\s]+/g, "_");
    // 微信/App 内置浏览器常拦下载，这里始终给「复制源码」兜底
    openOut(html, base);
    try { dl(html, base + ".html", "text/html;charset=utf-8"); } catch (e) { }
    toast("已导出 · 手机里下载不动就点「复制源码」");
  }

  function openOut(html, base) {
    var box = $("#em-out");
    if (!box) {
      box = mk("div"); box.id = "em-out";
      box.innerHTML =
        '<div class="em-out-box">' +
          '<div class="em-out-t">成品 HTML（已就绪）</div>' +
          '<textarea spellcheck="false" readonly></textarea>' +
          '<div class="em-out-btns">' +
            '<button data-em-out="copy" class="ok">复制源码</button>' +
            '<button data-em-out="close">关闭</button>' +
          '</div>' +
          '<div class="em-out-tip">复制后粘给人家（微信里直接发），人家来发布。</div>' +
        '</div>';
      document.body.appendChild(box);
      box.addEventListener("click", function (e) {
        var b = e.target.closest("[data-em-out]");
        if (!b) { if (e.target === box) box.classList.remove("on"); return; }
        var a = b.getAttribute("data-em-out");
        if (a === "close") box.classList.remove("on");
        if (a === "copy") copyOut(box);
      });
    }
    box.querySelector("textarea").value = html;
    box.classList.add("on");
  }

  function copyOut(box) {
    var ta = box.querySelector("textarea");
    ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
    var done = false;
    try { done = document.execCommand("copy"); } catch (e) { }
    if (!done && navigator.clipboard) {
      navigator.clipboard.writeText(ta.value).then(function () { toast("已复制，粘给人家就行"); },
        function () { toast("长按文本框全选复制"); });
      return;
    }
    toast(done ? "已复制，粘给人家就行" : "长按文本框全选复制");
  }

  function dl(text, name, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var restored = hasSaved() && loadSaved();
    buildUI();
    bindOnce();
    if (restored) rerender();
    var want = false;
    try { want = localStorage.getItem(KEY_ON) === "1"; } catch (e) { }
    if (want) setEdit(true);
    updateBar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 80); });
  } else {
    setTimeout(boot, 80);
  }
})();
