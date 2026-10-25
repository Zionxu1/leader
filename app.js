/* 月光账本 · 应用逻辑 */
(function () {
  'use strict';

  var C = window.LedgerCore;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function alpha(hex, a) {
    var h = String(hex).replace('#', '');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ---------------- 存储 ---------------- */

  var LS_KEY = 'ledger.v1.entries';
  var LS_PREFS = 'ledger.v1.prefs';
  var storeOk = true;

  function readEntries() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.map(C.normalizeEntry).filter(function (e) { return e && e.amount > 0; });
    } catch (e) { storeOk = false; return []; }
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); storeOk = true; return true; }
    catch (e) { storeOk = false; return false; }
  }

  function readPrefs() {
    var def = {
      lastChannel: { expense: 'wechat', income: 'bankcard' },
      lastCat: { expense: 'food', income: 'salary' },
      lastExport: 0
    };
    try {
      var raw = localStorage.getItem(LS_PREFS);
      var p = raw ? JSON.parse(raw) : {};
      if (!p || typeof p !== 'object') p = {};
      p.lastChannel = Object.assign({}, def.lastChannel, p.lastChannel || {});
      p.lastCat = Object.assign({}, def.lastCat, p.lastCat || {});
      p.lastExport = p.lastExport || 0;
      return p;
    } catch (e) { return def; }
  }

  function savePrefs() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) { } }

  /* ---------------- 状态 ---------------- */

  var entries = readEntries();
  var prefs = readPrefs();
  var state = {
    view: 'ledger',
    month: C.currentMonthKey(),
    q: '',
    draft: null,
    detailId: null,
    pasteFromEntry: false
  };
  var openSheets = [];
  var toastTimer = null;

  /* ---------------- 启动 ---------------- */

  document.addEventListener('DOMContentLoaded', function () {
    handleParams();
    bindEvents();
    render();
    registerSW();
    if (!storeOk) toast('浏览器禁用了本地存储，数据可能无法保存');
  });

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }

  function handleParams() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }

    if (p.get('demo') === '1' && !entries.length) {
      entries = demoData();
      return;
    }

    var amt = p.get('add') || p.get('amount');
    if (!amt) return;

    var d = newDraft(null);
    var v = parseFloat(amt);
    if (isFinite(v) && v > 0) d.amountStr = String(C.round2(v));
    if (p.get('m')) { d.merchant = p.get('m'); d.category = C.guessCategory(d.merchant, d.type); }
    var ch = p.get('c');
    if (ch && C.channelOf(ch).id === ch) d.channel = ch;
    if (p.get('t')) d.time = p.get('t').slice(0, 16);
    d.source = 'paste';

    setTimeout(function () { showEntry(d); }, 60);
    try { history.replaceState(null, '', location.pathname); } catch (e) { }
  }

  /* ---------------- 视图 ---------------- */

  function render() {
    $('#monthLabel').textContent = C.monthLabel(state.month);
    $('#topbar').classList.toggle('no-month', state.view === 'settings');

    var html = state.view === 'ledger' ? viewLedger()
      : state.view === 'report' ? viewReport()
        : viewSettings();
    $('#view').innerHTML = html;

    $$('#tabbar .tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === state.view);
    });
    $('#fab').classList.toggle('show', state.view === 'ledger');
    $('#btnSearch').classList.toggle('on', !!state.q);
  }

  function visibleEntries(q) {
    if (!q) return entries;
    var k = q.toLowerCase();
    return entries.filter(function (e) {
      var cat = C.catOf(e.type, e.category);
      var ch = C.channelOf(e.channel);
      return (e.merchant || '').toLowerCase().indexOf(k) >= 0
        || (e.note || '').toLowerCase().indexOf(k) >= 0
        || cat.name.indexOf(k) >= 0
        || ch.name.indexOf(k) >= 0
        || String(e.amount).indexOf(k) >= 0;
    });
  }

  function viewLedger() {
    var agg = C.aggregateMonth(entries, state.month);
    var list = visibleEntries(state.q).filter(function (e) { return C.monthKeyOf(e.time) === state.month; });
    list.sort(function (a, b) { return b.time.localeCompare(a.time) || b.createdAt - a.createdAt; });

    var html = summaryCard(agg);

    if (!list.length) {
      html += state.q
        ? '<div class="empty"><div class="e-ico">🔍</div><div class="e-t">没有匹配的记录</div><div class="e-s">换个关键词试试</div></div>'
        : '<div class="empty"><div class="e-ico">🧾</div><div class="e-t">这个月还没有记账</div><div class="e-s">点右下角的 ＋ 记第一笔<br>或用「粘贴识别」从支付结果里提取金额</div>' +
          '<div style="margin-top:18px"><button class="btn ghost" data-act="new" style="max-width:200px;margin:0 auto">＋ 记一笔</button></div></div>';
    } else {
      html += listHTML(list);
    }

    if (!state.q && agg.count <= 2) html += hintCard();
    return html;
  }

  function summaryCard(agg) {
    var chs = C.channelRank(agg).filter(function (c) { return c.expense > 0; });
    return '<div class="summary card">' +
      '<div class="label">' + (state.month === C.currentMonthKey() ? '本月支出' : '当月支出') + '</div>' +
      '<div class="big"><span class="cur">¥</span>' + C.money(agg.expense) + '</div>' +
      '<div class="sub">' +
      '<span>收入 <b>¥' + C.money(agg.income) + '</b></span>' +
      '<span>结余 <b>¥' + C.money(agg.balance) + '</b></span>' +
      '<span><b>' + agg.count + '</b> 笔</span>' +
      '</div>' +
      (chs.length ? '<div class="channel-strip">' + chs.map(function (c) {
        return '<span class="ch-mini"><span class="dot" style="background:' + c.color + '">' + esc(c.short) + '</span>'
          + esc(c.name) + ' ¥' + C.money(c.expense) + '</span>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  function listHTML(list) {
    var groups = [];
    list.forEach(function (e) {
      var day = e.time.slice(0, 10);
      var g = groups[groups.length - 1];
      if (!g || g.day !== day) { g = { day: day, items: [], expense: 0, income: 0 }; groups.push(g); }
      g.items.push(e);
      if (e.type === 'income') g.income += e.amount; else g.expense += e.amount;
    });

    var cats = C.catsOf('expense');
    function catIndex(id, type) {
      var list2 = C.catsOf(type);
      for (var i = 0; i < list2.length; i++) if (list2[i].id === id) return i;
      return 0;
    }

    return groups.map(function (g) {
      return '<div class="day-head"><span>' + C.dayLabel(g.day + 'T12:00') + '</span><span>' +
        (g.expense > 0 ? '−¥' + C.money(g.expense) : '') +
        (g.expense > 0 && g.income > 0 ? ' · ' : '') +
        (g.income > 0 ? '+¥' + C.money(g.income) : '') +
        '</span></div>' +
        '<div class="list">' + g.items.map(function (e) {
          var cat = C.catOf(e.type, e.category);
          var ch = C.channelOf(e.channel);
          var color = C.catColor(catIndex(e.category, e.type));
          var title = e.merchant || cat.name;
          var sub = cat.name + ' · ' + ch.name + ' · ' + C.timeLabel(e.time);
          if (e.source !== 'manual') sub += ' · ' + (e.source === 'ocr' ? '截图' : e.source === 'import' ? '导入' : '识别');
          return '<button class="item" data-act="open" data-id="' + esc(e.id) + '">' +
            '<span class="ico" style="background:' + alpha(color, 0.14) + '">' + cat.icon + '</span>' +
            '<span class="meta"><span class="t">' + esc(title) + '</span><span class="s">' + esc(sub) + '</span></span>' +
            '<span class="amt ' + (e.type === 'income' ? 'income' : '') + '">' +
            (e.type === 'income' ? '+' : '−') + '¥' + C.money(e.amount) + '</span></button>';
        }).join('') + '</div>';
    }).join('');
  }

  function hintCard() {
    return '<div class="hint-card">' +
      '<b>怎么记最快？</b><br>' +
      '付完钱截个图 → 打开 App 点 ＋ → 「截图识字」，金额和商户会自动填好，确认就行。' +
      '</div>';
  }

  function viewReport() {
    var agg = C.aggregateMonth(entries, state.month);
    if (!agg.count) {
      return '<div class="empty"><div class="e-ico">📊</div><div class="e-t">这个月还没有数据</div><div class="e-s">记几笔之后这里会有分类占比和月度趋势</div></div>';
    }

    var cats = C.categoryRank(agg, 'expense');
    var chs = C.channelRank(agg);
    var months = C.lastMonths(entries, state.month, 6);
    var maxM = 1;
    months.forEach(function (m) { if (m.expense > maxM) maxM = m.expense; });

    var dayCount = state.month === C.currentMonthKey() ? new Date().getDate() : C.daysInMonth(state.month);
    var perDay = agg.expense / dayCount;
    var maxOne = agg.maxExpense ? agg.maxExpense.amount : 0;

    var html = '<div class="stat-grid">' +
      '<div class="stat"><div class="k">日均支出</div><div class="v">¥' + C.money(perDay) + '</div></div>' +
      '<div class="stat"><div class="k">支出笔数</div><div class="v">' + cats.reduce(function (a, b) { return a + b.count; }, 0) + '</div></div>' +
      '<div class="stat"><div class="k">最大单笔</div><div class="v">¥' + C.money(maxOne) + '</div></div>' +
      '</div>';

    var top = cats.length ? cats[0].amount : 1;

    html += '<div class="sec-title">支出分类</div><div class="panel">' +
      cats.map(function (c) {
        var color = C.catColor(C.catsOf('expense').findIndex(function (x) { return x.id === c.id; }));
        return '<div class="bar-row">' +
          '<div class="bar-top"><span class="nm"><span>' + c.icon + '</span><span class="t2">' + esc(c.name) + '</span></span>' +
          '<span class="val"><b>¥' + C.money(c.amount) + '</b>' + c.pct.toFixed(0) + '%</span></div>' +
          '<div class="track"><div class="fill" style="width:' + Math.max(2, (c.amount / top) * 100) + '%;background:' + color + '"></div></div>' +
          '</div>';
      }).join('') + '</div>';

    if (chs.length) {
      var topCh = chs[0].expense || 1;
      html += '<div class="sec-title">支付方式</div><div class="panel">' +
        chs.map(function (c) {
          var val = c.expense > 0 ? c.expense : c.income;
          return '<div class="bar-row">' +
            '<div class="bar-top"><span class="nm"><span class="dot" style="background:' + c.color + '">' + esc(c.short) + '</span>' +
            '<span class="t2">' + esc(c.name) + '</span></span>' +
            '<span class="val"><b>¥' + C.money(val) + '</b>' + c.count + ' 笔</span></div>' +
            '<div class="track"><div class="fill" style="width:' + Math.max(2, (val / topCh) * 100) + '%;background:' + c.color + '"></div></div>' +
            '</div>';
        }).join('') + '</div>';
    }

    html += '<div class="sec-title">近 6 个月支出</div><div class="panel"><div class="trend">' +
      months.map(function (m) {
        var h = Math.max(3, Math.round((m.expense / maxM) * 100));
        var isCur = m.key === state.month;
        return '<div class="col' + (isCur ? ' is-cur' : '') + '">' +
          '<div class="num">' + (m.expense > 0 ? Math.round(m.expense) : '') + '</div>' +
          '<div class="bar" style="height:' + h + '%"></div>' +
          '<div class="cap">' + esc(m.label) + '</div></div>';
      }).join('') + '</div></div>';

    html += '<div class="footnote" style="margin-top:14px">日均 = 当月支出 ÷ ' + dayCount + ' 天</div>';
    return html;
  }

  function viewSettings() {
    var oldest = entries.slice().sort(function (a, b) { return a.time.localeCompare(b.time); })[0];
    var info = entries.length
      ? '共 ' + entries.length + ' 笔 · 从 ' + oldest.time.slice(0, 10) + ' 开始'
      : '还没有记录';
    var days = prefs.lastExport ? Math.floor((Date.now() - prefs.lastExport) / 86400000) : null;
    var backupText = prefs.lastExport
      ? (days === 0 ? '今天已备份' : days + ' 天前备份')
      : '还没备份过';

    return '<div class="sec-title">数据</div>' +
      '<div class="group">' +
      '<button class="row" data-act="import-bill"><span>导入微信 / 支付宝账单 <span class="desc">CSV</span></span><span class="chev">›</span></button>' +
      '<button class="row" data-act="export-json"><span>导出备份 <span class="desc">JSON</span></span><span class="chev">' + backupText + ' ›</span></button>' +
      '<button class="row" data-act="export-csv"><span>导出表格 <span class="desc">CSV / Excel</span></span><span class="chev">›</span></button>' +
      '<button class="row" data-act="import"><span>导入备份</span><span class="chev">›</span></button>' +
      '</div>' +
      '<div class="bill-note" style="margin:-8px 6px 18px">微信：我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单（用于个人对账）。' +
      '支付宝：我的 → 账单 → 右上角 … → 开具交易流水证明。邮箱收到的是压缩包，解压出 CSV 再从这里导入。</div>' +

      '<div class="sec-title">记录</div>' +
      '<div class="group">' +
      '<div class="row"><span>账目</span><span class="desc">' + esc(info) + '</span></div>' +
      '<button class="row danger" data-act="clear"><span>清空所有记录</span><span class="chev">›</span></button>' +
      '</div>' +

      '<div class="sec-title">关于识别</div>' +
      '<div class="hint-card" style="margin-top:0">' +
      '<b>为什么不能全自动？</b><br>' +
      'iOS 不允许任何第三方 App 读取微信、支付宝、银行 App 的通知或交易数据，也没有短信读取权限。' +
      '所以金额只能来自你的输入、截图文字识别，或者以后导入账单。<br><br>' +
      '<b>想最省事：</b>用「快捷指令」把截图转成文字（README 里的「姿势 B」），' +
      '再在 App 里点「粘贴识别」，完全不用等语言包。<br><br>' +
      '截图识字第一次要下载语言包（约 10MB），之后每次约 2–4 秒。' +
      '</div>' +

      '<div class="sec-title">安装到桌面</div>' +
      '<div class="hint-card" style="margin-top:0">' +
      'Safari 打开本页 → 点底部「分享」→「添加到主屏幕」。之后从桌面图标进入，和普通 App 一样。<br>' +
      '本页所有数据只存在这台手机上，不会上传。换手机或清理 Safari 数据前，记得先导出备份。' +
      '</div>' +

      '<div class="footnote">月光账本 v1.0 · 本地优先 · 无需登录</div>';
  }

  /* ---------------- 记账面板 ---------------- */

  function newDraft(entry) {
    if (entry) {
      return {
        id: entry.id,
        type: entry.type,
        amountStr: String(C.round2(entry.amount)),
        category: entry.category,
        channel: entry.channel,
        merchant: entry.merchant || '',
        time: entry.time,
        source: entry.source || 'manual',
        editing: true
      };
    }
    return {
      id: null,
      type: 'expense',
      amountStr: '',
      category: prefs.lastCat.expense,
      channel: prefs.lastChannel.expense,
      merchant: '',
      time: C.nowLocalIso(),
      source: 'manual',
      editing: false
    };
  }

  function showEntry(draft) {
    state.draft = draft;
    paintEntry();
    openSheet('#entrySheet');
  }

  function openNewEntry() {
    showEntry(newDraft(null));
  }

  function paintEntry() {
    var d = state.draft;
    if (!d) return;
    $('#entryTitle').textContent = d.editing ? '编辑' : '记一笔';
    $$('#typeSeg button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === d.type);
    });
    renderCats();
    renderChannels();
    $('#merchantInput').value = d.merchant || '';
    $('#timeInput').value = (d.time || C.nowLocalIso()).slice(0, 16);
    $('#saveBtn').textContent = d.editing ? '保存修改' : '保存';
    var delBtn = $('#btnDeleteFromEdit');
    if (delBtn) delBtn.style.display = d.editing ? 'block' : 'none';
    renderAmount();
    renderSide();
    var sheet = $('#entrySheet');
    if (sheet) sheet.scrollTop = 0;
  }

  function renderCats() {
    var d = state.draft;
    var cats = C.catsOf(d.type);
    $('#cats').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c.id === d.category ? ' on' : '') + '" data-act="cat" data-id="' + c.id + '">' +
        '<span class="ci">' + c.icon + '</span>' + esc(c.name) + '</button>';
    }).join('');
  }

  function renderChannels() {
    var d = state.draft;
    $('#channels').innerHTML = C.CHANNELS.map(function (c) {
      return '<button class="chip' + (c.id === d.channel ? ' on' : '') + '" data-act="ch" data-id="' + c.id + '">' +
        '<span class="ci" style="display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;background:' +
        c.color + ';color:#fff;font-size:10px;font-weight:700">' + esc(c.short) + '</span>' + esc(c.name) + '</button>';
    }).join('');
  }

  function renderAmount() {
    var d = state.draft;
    if (!d) return;
    $('#amountVal').innerHTML = '<span class="cur">¥</span>' + esc(C.amountDisplay(d.amountStr));
    var v = parseFloat(d.amountStr || '0');
    $('#saveBtn').disabled = !(v > 0);
  }

  function renderSide() {
    var d = state.draft;
    if (!d) return;
    var iso = $('#timeInput').value || d.time || C.nowLocalIso();
    $('#amountSide').textContent = sideLabel(iso);
  }

  function sideLabel(iso) {
    var dd = new Date(iso);
    if (isNaN(dd.getTime())) return '';
    var now = new Date();
    var y = new Date(); y.setDate(y.getDate() - 1);
    var head;
    if (dd.toDateString() === now.toDateString()) head = '今天';
    else if (dd.toDateString() === y.toDateString()) head = '昨天';
    else head = (dd.getMonth() + 1) + '/' + dd.getDate();
    return head + ' ' + C.timeLabel(iso);
  }

  function pressKey(k) {
    if (!state.draft) return;
    state.draft.amountStr = C.pushDigit(state.draft.amountStr, k);
    renderAmount();
    if (navigator.vibrate) { try { navigator.vibrate(6); } catch (e) { } }
  }

  function switchType(type) {
    var d = state.draft;
    if (!d || d.type === type) return;
    d.type = type;
    var cats = C.catsOf(type);
    if (!cats.some(function (c) { return c.id === d.category; })) d.category = prefs.lastCat[type];
    d.channel = prefs.lastChannel[type];
    paintEntry();
  }

  async function saveEntry() {
    var d = state.draft;
    if (!d) return;
    var amount = C.round2(parseFloat(d.amountStr || '0'));
    if (!(amount > 0)) { toast('请先输入金额'); return; }

    var time = ($('#timeInput').value || d.time || C.nowLocalIso()).slice(0, 16);
    var merchant = $('#merchantInput').value.trim();
    var entry = C.normalizeEntry({
      id: d.id || undefined,
      type: d.type,
      amount: amount,
      category: d.category,
      channel: d.channel,
      merchant: merchant,
      time: time,
      source: d.source || 'manual',
      createdAt: Date.now()
    });

    if (d.id) {
      var idx = entries.findIndex(function (e) { return e.id === d.id; });
      if (idx >= 0) {
        entry.createdAt = entries[idx].createdAt;
        entries[idx] = entry;
      } else {
        entries.unshift(entry);
      }
      toast('已保存修改');
    } else {
      var dup = C.findDuplicate(entries, entry, 10);
      if (dup) {
        var okDup = await askConfirm({
          title: '可能重复',
          message: '10 分钟内已经有一笔 ¥' + C.money(dup.amount) + ' 的' + C.channelOf(dup.channel).name +
            (dup.type === 'income' ? '收入' : '支出') + '，仍然保存吗？',
          okText: '仍然保存',
          danger: false
        });
        if (!okDup) return;
        if (state.draft !== d) return;
      }
      entries.unshift(entry);
      toast('已记账 ' + (entry.type === 'income' ? '+' : '−') + '¥' + C.money(entry.amount));
    }

    prefs.lastChannel[d.type] = d.channel;
    prefs.lastCat[d.type] = d.category;
    savePrefs();

    if (entry.time.slice(0, 7) !== state.month) {
      state.month = entry.time.slice(0, 7);
    }
    if (!persist()) toast('保存失败：浏览器存储不可用');
    closeSheet('#entrySheet');
    state.draft = null;
    render();
  }

  /* ---------------- 详情 ---------------- */

  function findEntry(id) {
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
    return null;
  }

  function openDetail(id) {
    var e = findEntry(id);
    if (!e) return;
    state.detailId = id;
    var cat = C.catOf(e.type, e.category);
    var ch = C.channelOf(e.channel);
    var srcMap = { manual: '手动记账', paste: '粘贴识别', ocr: '截图识别', import: '导入' };
    var kv = function (k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + esc(v) + '</span></div>'; };

    $('#detailBody').innerHTML =
      '<div class="detail-amount">' +
      '<div class="v ' + (e.type === 'income' ? 'income' : '') + '">' +
      (e.type === 'income' ? '+' : '−') + '¥' + C.money(e.amount) + '</div>' +
      '<div class="n">' + cat.icon + ' ' + esc(e.merchant || cat.name) + '</div>' +
      '</div>' +
      '<div class="group" style="margin-bottom:0">' +
      kv('分类', cat.name) +
      kv('支付方式', ch.name) +
      kv('时间', e.time.slice(0, 10) + ' ' + C.timeLabel(e.time)) +
      (e.note ? kv('备注', e.note) : '') +
      kv('来源', srcMap[e.source] || '手动记账') +
      '</div>';

    openSheet('#detailSheet');
  }

  /* ---------------- 识别 ---------------- */

  function openPaste() {
    state.pasteFromEntry = $('#entrySheet').classList.contains('open');
    openSheet('#pasteSheet');
    hideProgress();
    var ta = $('#pasteText');
    ta.value = '';
    setTimeout(function () { ta.focus(); }, 320);
  }

  function doParse(text) {
    var r = C.parsePaymentText(String(text || ''));
    if (!(r.amount > 0)) {
      toast('没识别出金额，检查一下文字是否完整');
      return false;
    }
    var d = state.draft || newDraft(null);
    d.type = r.type;
    d.amountStr = String(r.amount);
    if (r.merchant) {
      d.merchant = r.merchant;
      var guess = C.guessCategory(r.merchant, r.type);
      if (guess !== 'other') d.category = guess;
    }
    if (r.channel) d.channel = r.channel;
    if (r.time) d.time = r.time;
    d.source = 'paste';

    paintEntry();
    closeSheet('#pasteSheet');
    openSheet('#entrySheet');
    toast('已识别 ¥' + C.money(r.amount) + (r.merchant ? ' · ' + r.merchant : ''));
    return true;
  }

  function showProgress(t) {
    $('#progressText').textContent = t || '识别中…';
    $('#pasteProgress').classList.add('show');
  }

  function hideProgress() {
    $('#pasteProgress').classList.remove('show');
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(message || 'timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /* 只裁掉状态栏和底部，缩小到 1100px 宽：更快，也少读到无关文字 */
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var top = Math.round(img.height * 0.06);
          var bottom = Math.round(img.height * 0.02);
          var h = Math.max(1, img.height - top - bottom);
          var scale = Math.min(1, 1100 / img.width);
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(h * scale);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, top, img.width, h, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      img.src = url;
    });
  }

  /* 语言包只加载一次，之后复用同一个 worker */
  var ocrWorker = null;

  async function ensureOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) {
      showProgress('正在加载识别引擎…');
      await withTimeout(
        loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'),
        60000, 'engine timeout'
      );
    }
    var firstTime = !ocrWorker;
    if (firstTime) {
      showProgress('首次使用：正在下载中文语言包（约 10MB，只需一次）…');
    }
    ocrWorker = await window.Tesseract.createWorker('chi_sim', 1, {
      logger: function (m) {
        if (m.status === 'recognizing text') showProgress('识别中 ' + Math.round(m.progress * 100) + '%');
      }
    });
    return ocrWorker;
  }

  async function startOcr(file) {
    if (!file) return;
    openSheet('#pasteSheet');
    $('#pasteText').value = '';
    showProgress('正在准备图片…');
    try {
      var canvas = await prepareImage(file);
      var worker = await ensureOcrWorker();
      showProgress('识别中…');
      var res = await withTimeout(worker.recognize(canvas), 120000, 'recognize timeout');
      hideProgress();
      var text = res && res.data ? res.data.text : '';
      $('#pasteText').value = text;
      if (!text || text.replace(/\s/g, '').length < 2) { toast('没识别出文字，换个清楚点的截图'); return; }
      doParse(text);
    } catch (e) {
      hideProgress();
      if (ocrWorker) {
        try { ocrWorker.terminate(); } catch (x) { }
        ocrWorker = null;
      }
      toast('截图识别失败，可以改用「粘贴识别」或快捷指令');
    }
  }

  /* ---------------- 导入导出 ---------------- */

  function stamp() {
    var d = new Date();
    return d.getFullYear() + C.pad2(d.getMonth() + 1) + C.pad2(d.getDate()) + '-' + C.pad2(d.getHours()) + C.pad2(d.getMinutes());
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
  }

  function exportJSON() {
    if (!entries.length) { toast('还没有记录可导出'); return; }
    var payload = {
      app: 'ledger',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: entries
    };
    download('账本备份-' + stamp() + '.json', JSON.stringify(payload, null, 2));
    prefs.lastExport = Date.now();
    savePrefs();
    toast('已导出 ' + entries.length + ' 笔记录');
    render();
  }

  function exportCSV() {
    if (!entries.length) { toast('还没有记录可导出'); return; }
    var sorted = entries.slice().sort(function (a, b) { return b.time.localeCompare(a.time); });
    download('账本-' + stamp() + '.csv', '\ufeff' + C.csv(sorted), 'text/csv;charset=utf-8');
    prefs.lastExport = Date.now();
    savePrefs();
    toast('已导出 CSV，可用 Excel 打开');
    render();
  }

  function importJSON(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('文件不是有效的 JSON'); return; }
      var arr = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
      if (!arr) { toast('备份文件格式不对'); return; }
      var added = 0, replaced = 0;
      arr.forEach(function (raw) {
        var e = C.normalizeEntry(raw);
        if (!e || !(e.amount > 0)) return;
        var idx = entries.findIndex(function (x) { return x.id === e.id; });
        if (idx >= 0) { entries[idx] = e; replaced++; }
        else { entries.push(e); added++; }
      });
      entries.sort(function (a, b) { return b.time.localeCompare(a.time); });
      persist();
      toast('导入完成：新增 ' + added + ' 笔' + (replaced ? '，更新 ' + replaced + ' 笔' : ''));
      render();
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* ---------------- 微信 / 支付宝账单导入 ---------------- */

  var pendingImport = null;

  function decodeBillBuffer(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length > 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { }
    try { return new TextDecoder('gbk').decode(bytes); } catch (e) { }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function handleBillFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var res;
      try { res = C.parseBillCSV(decodeBillBuffer(reader.result)); }
      catch (e) { toast('解析失败，文件可能不是 CSV'); return; }
      if (res.error === 'no-header' || res.error === 'columns') {
        toast('没找到账单表头，请确认是微信 / 支付宝导出的 CSV');
        return;
      }
      if (!res.rows.length) { toast('没有可导入的记录'); return; }

      var added = [], dup = 0;
      res.rows.forEach(function (r) {
        var e = C.normalizeEntry({
          type: r.type,
          amount: r.amount,
          category: r.category,
          channel: r.channel,
          merchant: r.merchant,
          time: r.time,
          source: 'import'
        });
        if (C.findDuplicate(entries.concat(added), e, 15)) { dup++; return; }
        added.push(e);
      });

      pendingImport = added;
      renderBillPreview(res, added, dup);
      openSheet('#billSheet');
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsArrayBuffer(file);
  }

  function renderBillPreview(res, added, dup) {
    var exp = added.filter(function (a) { return a.type === 'expense'; });
    var inc = added.filter(function (a) { return a.type === 'income'; });
    var sum = function (arr) { return arr.reduce(function (s, e) { return s + e.amount; }, 0); };
    var name = res.format === 'alipay' ? '支付宝账单' : '微信支付账单';
    var times = res.rows.map(function (r) { return r.time; }).sort();
    var rng = times.length
      ? times[0].slice(0, 10) + ' ~ ' + times[times.length - 1].slice(0, 10)
      : '';
    var kv = function (k, v) {
      return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + esc(v) + '</span></div>';
    };

    $('#billSummary').innerHTML =
      '<div class="bill-name">' + name + '<span class="sub">共 ' + res.total + ' 行</span></div>' +
      '<div class="stat-grid">' +
      '<div class="stat"><div class="k">将导入</div><div class="v">' + added.length + ' 笔</div></div>' +
      '<div class="stat"><div class="k">已存在</div><div class="v">' + dup + ' 笔</div></div>' +
      '<div class="stat"><div class="k">已忽略</div><div class="v">' + res.skipped + ' 笔</div></div>' +
      '</div>' +
      '<div class="group" style="margin-top:14px">' +
      kv('支出', exp.length + ' 笔 · ¥' + C.money(sum(exp))) +
      kv('收入', inc.length + ' 笔 · ¥' + C.money(sum(inc))) +
      (rng ? kv('时间范围', rng) : '') +
      '</div>' +
      '<div class="bill-note">重复判断：同金额、同渠道、时间相差 15 分钟内视为同一笔。' +
      '「不计收支」「已关闭」「退款」的行会自动忽略。</div>';

    $('#btnDoImport').textContent = added.length ? '导入 ' + added.length + ' 笔' : '没有新记录';
    $('#btnDoImport').disabled = !added.length;
  }

  function doImport() {
    if (!pendingImport || !pendingImport.length) return;
    var list = pendingImport;
    pendingImport = null;
    entries = entries.concat(list).sort(function (a, b) { return b.time.localeCompare(a.time); });
    persist();
    var latest = list.reduce(function (m, e) {
      var k = e.time.slice(0, 7);
      return k > m ? k : m;
    }, list[0].time.slice(0, 7));
    state.month = latest;
    state.view = 'ledger';
    state.q = '';
    var si = $('#searchInput');
    if (si) si.value = '';
    $('#searchbar').classList.remove('show');
    closeSheet('#billSheet');
    toast('已导入 ' + list.length + ' 笔');
    render();
  }

  async function clearAll() {
    if (!entries.length) { toast('没有记录'); return; }
    var ok = await askConfirm({
      title: '清空全部记录？',
      message: '共 ' + entries.length + ' 笔，清空后无法恢复。建议先导出备份。',
      okText: '清空',
      danger: true
    });
    if (!ok) return;
    entries = [];
    persist();
    state.month = C.currentMonthKey();
    toast('已清空');
    render();
  }

  /* ---------------- 弹层 ---------------- */

  function openSheet(sel) {
    var el = $(sel);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    $('#backdrop').classList.add('show');
    document.body.classList.add('no-scroll');
    if (openSheets.indexOf(sel) < 0) openSheets.push(sel);
  }

  function closeSheet(sel) {
    var el = $(sel);
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    openSheets = openSheets.filter(function (s) { return s !== sel; });
    if (!openSheets.length) {
      $('#backdrop').classList.remove('show');
      document.body.classList.remove('no-scroll');
    }
  }

  function closeAllSheets() {
    openSheets.slice().forEach(closeSheet);
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- 自绘确认框（iOS 主屏模式下系统 confirm 会被吞掉） ---------------- */

  var dlgResolve = null;

  function askConfirm(opts) {
    return new Promise(function (resolve) {
      if (dlgResolve) { var prev = dlgResolve; dlgResolve = null; prev(false); }
      dlgResolve = resolve;
      $('#dlgTitle').textContent = opts.title || '确认';
      $('#dlgMsg').textContent = opts.message || '';
      $('#dlgOk').textContent = opts.okText || '确定';
      $('#dlgOk').classList.toggle('danger', opts.danger !== false);
      $('#dlgBackdrop').classList.add('show');
      $('#dialog').classList.add('show');
      $('#dialog').setAttribute('aria-hidden', 'false');
    });
  }

  function closeDialog(val) {
    $('#dlgBackdrop').classList.remove('show');
    $('#dialog').classList.remove('show');
    $('#dialog').setAttribute('aria-hidden', 'true');
    var r = dlgResolve;
    dlgResolve = null;
    if (r) r(val);
  }

  function dialogOpen() {
    return $('#dialog').classList.contains('show');
  }

  /* ---------------- 事件 ---------------- */

  function bindEvents() {
    $('#prevMonth').addEventListener('click', function () { state.month = C.shiftMonth(state.month, -1); render(); });
    $('#nextMonth').addEventListener('click', function () { state.month = C.shiftMonth(state.month, 1); render(); });
    $('#monthLabel').addEventListener('click', function () {
      var cur = C.currentMonthKey();
      if (state.month === cur) { toast(C.monthLabel(cur)); return; }
      state.month = cur;
      render();
      toast('回到本月');
    });

    $('#btnSearch').addEventListener('click', function () {
      var bar = $('#searchbar');
      var show = !bar.classList.contains('show');
      bar.classList.toggle('show', show);
      this.classList.toggle('on', show);
      if (show) setTimeout(function () { $('#searchInput').focus(); }, 40);
      else { $('#searchInput').value = ''; state.q = ''; render(); }
    });

    $('#searchInput').addEventListener('input', function () {
      state.q = this.value.trim();
      render();
    });

    $('#fab').addEventListener('click', openNewEntry);

    $$('#tabbar .tab').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-view');
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
      });
    });

    $('#backdrop').addEventListener('click', function () {
      if (!openSheets.length) return;
      closeSheet(openSheets[openSheets.length - 1]);
      if (!openSheets.length && state.draft && !state.draft.editing) state.draft = null;
    });

    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sheet = b.closest('.sheet');
        if (sheet) closeSheet('#' + sheet.id);
      });
    });

    $('#typeSeg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-type]');
      if (b) switchType(b.getAttribute('data-type'));
    });

    $('#keypad').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-k]');
      if (b) pressKey(b.getAttribute('data-k'));
    });

    $('#saveBtn').addEventListener('click', saveEntry);
    $('#merchantInput').addEventListener('input', function () { if (state.draft) state.draft.merchant = this.value; });
    $('#timeInput').addEventListener('change', function () {
      if (state.draft) state.draft.time = this.value.slice(0, 16);
      renderSide();
    });
    $('#timeInput').addEventListener('input', renderSide);

    $('#btnNow').addEventListener('click', function () {
      state.draft.time = C.nowLocalIso();
      $('#timeInput').value = state.draft.time;
      renderSide();
      toast('时间已设为现在');
    });

    $('#btnPaste').addEventListener('click', openPaste);
    $('#btnScan').addEventListener('click', function () { $('#ocrFile').click(); });
    $('#ocrFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) startOcr(f);
    });

    $('#btnReadClip').addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('当前环境不支持自动读取，请长按输入框手动粘贴'); return; }
      navigator.clipboard.readText().then(function (t) {
        if (!t) { toast('剪贴板是空的'); return; }
        $('#pasteText').value = t;
        toast('已读取剪贴板');
      }).catch(function () {
        toast('读取剪贴板被拒绝，请长按输入框手动粘贴');
      });
    });

    $('#btnParse').addEventListener('click', function () {
      var t = $('#pasteText').value;
      if (!t.trim()) { toast('先粘贴或识别一段文字'); return; }
      doParse(t);
    });

    $('#btnEditEntry').addEventListener('click', function () {
      var e = findEntry(state.detailId);
      if (!e) return;
      closeSheet('#detailSheet');
      showEntry(newDraft(e));
    });

    $('#btnDeleteEntry').addEventListener('click', async function () {
      var e = findEntry(state.detailId);
      if (!e) return;
      var ok = await askConfirm({
        title: '删除这笔记录？',
        message: '¥' + C.money(e.amount) + ' · ' + (e.merchant || C.catOf(e.type, e.category).name) + '，删除后无法恢复。',
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      entries = entries.filter(function (x) { return x.id !== e.id; });
      persist();
      closeSheet('#detailSheet');
      toast('已删除');
      render();
    });

    $('#btnDeleteFromEdit').addEventListener('click', async function () {
      var d = state.draft;
      if (!d || !d.id) return;
      var e = findEntry(d.id);
      if (!e) return;
      var ok = await askConfirm({
        title: '删除这笔记录？',
        message: '¥' + C.money(e.amount) + '，删除后无法恢复。',
        okText: '删除',
        danger: true
      });
      if (!ok) return;
      entries = entries.filter(function (x) { return x.id !== e.id; });
      persist();
      state.draft = null;
      closeSheet('#entrySheet');
      toast('已删除');
      render();
    });

    $('#dlgOk').addEventListener('click', function () { closeDialog(true); });
    $('#dlgCancel').addEventListener('click', function () { closeDialog(false); });
    $('#dlgBackdrop').addEventListener('click', function () { closeDialog(false); });

    $('#billFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) handleBillFile(f);
    });

    $('#btnDoImport').addEventListener('click', doImport);

    $('#importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) importJSON(f);
    });

    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'open') openDetail(t.getAttribute('data-id'));
      else if (act === 'new') openNewEntry();
      else if (act === 'cat') { if (state.draft) { state.draft.category = t.getAttribute('data-id'); renderCats(); } }
      else if (act === 'ch') { if (state.draft) { state.draft.channel = t.getAttribute('data-id'); renderChannels(); } }
      else if (act === 'export-json') exportJSON();
      else if (act === 'export-csv') exportCSV();
      else if (act === 'import') $('#importFile').click();
      else if (act === 'import-bill') $('#billFile').click();
      else if (act === 'clear') clearAll();
    });

    window.addEventListener('scroll', function () {
      $('#topbar').classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (dialogOpen()) { closeDialog(false); return; }
      if (openSheets.length) closeSheet(openSheets[openSheets.length - 1]);
    });
  }

  /* ---------------- 演示数据（?demo=1） ---------------- */

  function demoData() {
    var now = new Date();
    var mk = function (dayOffset, h, m, amt, cat, ch, merchant, type) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, h, m);
      return C.normalizeEntry({
        type: type || 'expense', amount: amt, category: cat, channel: ch,
        merchant: merchant, time: C.isoFromDate(d), source: 'manual', createdAt: Date.now() - dayOffset * 1000
      });
    };
    return [
      mk(0, 8, 12, 4, 'transport', 'alipay', '上海地铁'),
      mk(0, 9, 5, 28, 'food', 'wechat', '瑞幸咖啡(国贸店)'),
      mk(0, 12, 30, 32, 'food', 'wechat', '老乡鸡'),
      mk(1, 13, 20, 26, 'food', 'alipay', '麦当劳'),
      mk(1, 18, 40, 45, 'food', 'wechat', '海底捞火锅'),
      mk(2, 8, 5, 4, 'transport', 'alipay', '上海地铁'),
      mk(2, 10, 0, 168, 'shopping', 'bankcard', '京东商城'),
      mk(3, 10, 10, 59, 'daily', 'wechat', '盒马鲜生'),
      mk(3, 20, 15, 88, 'fun', 'alipay', '万达影城'),
      mk(4, 11, 30, 39, 'food', 'wechat', '星巴克'),
      mk(4, 21, 0, 12, 'transport', 'other', '滴滴出行'),
      mk(5, 9, 0, 129, 'health', 'bankcard', '市第一医院'),
      mk(6, 12, 0, 23, 'food', 'wechat', '沙县小吃'),
      mk(7, 15, 30, 256, 'shopping', 'alipay', '优衣库'),
      mk(8, 19, 0, 68, 'food', 'wechat', '太二酸菜鱼'),
      mk(9, 10, 0, 100, 'telecom', 'bankcard', '中国移动'),
      mk(10, 9, 30, 12000, 'salary', 'bankcard', '工资', 'income'),
      mk(12, 20, 0, 45, 'fun', 'alipay', '网易云音乐'),
      mk(15, 8, 40, 4, 'transport', 'alipay', '上海地铁'),
      mk(18, 12, 20, 36, 'food', 'wechat', '老乡鸡')
    ];
  }

})();
