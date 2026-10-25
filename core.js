/* 账本核心逻辑：纯函数，无 DOM 依赖，可在 Node 中直接测试 */
(function (root) {
  'use strict';

  var CHANNELS = [
    { id: 'wechat', name: '微信', short: '微', color: '#07C160' },
    { id: 'alipay', name: '支付宝', short: '支', color: '#1677FF' },
    { id: 'bankcard', name: '银行卡', short: '卡', color: '#FF9500' },
    { id: 'cash', name: '现金', short: '现', color: '#8E8E93' },
    { id: 'other', name: '其他', short: '他', color: '#AF52DE' }
  ];

  var EXPENSE_CATS = [
    { id: 'food', name: '餐饮', icon: '🍜' },
    { id: 'transport', name: '交通', icon: '🚇' },
    { id: 'shopping', name: '购物', icon: '🛍️' },
    { id: 'daily', name: '日用', icon: '🧴' },
    { id: 'fun', name: '娱乐', icon: '🎮' },
    { id: 'health', name: '医疗', icon: '💊' },
    { id: 'home', name: '住房', icon: '🏠' },
    { id: 'telecom', name: '通信', icon: '📱' },
    { id: 'social', name: '人情', icon: '🎁' },
    { id: 'study', name: '学习', icon: '📚' },
    { id: 'other', name: '其他', icon: '📦' }
  ];

  var INCOME_CATS = [
    { id: 'salary', name: '工资', icon: '💰' },
    { id: 'bonus', name: '奖金', icon: '🏆' },
    { id: 'refund', name: '退款', icon: '↩️' },
    { id: 'redpacket', name: '红包', icon: '🧧' },
    { id: 'other', name: '其他', icon: '📦' }
  ];

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) { return Math.round(num(n) * 100) / 100; }

  /* 1234.5 -> "1,234.50" */
  function money(n) {
    var v = round2(n);
    var neg = v < 0;
    var parts = Math.abs(v).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts[0] + '.' + parts[1];
  }

  /* 1234.5 -> "¥1,234.50" */
  function sym(n) { return '¥' + money(n); }

  function channelOf(id) {
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === id) return CHANNELS[i];
    return CHANNELS[CHANNELS.length - 1];
  }

  function isIncome(type) { return type === 'income'; }

  function catsOf(type) { return isIncome(type) ? INCOME_CATS : EXPENSE_CATS; }

  function catOf(type, id) {
    var list = catsOf(type);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[list.length - 1];
  }

  function catColor(index) {
    var palette = ['#FF9F0A', '#5E5CE6', '#FF375F', '#30B0C7', '#BF5AF2', '#32ADE6',
      '#FF6482', '#8E8E93', '#34C759', '#A2845E', '#64748B'];
    return palette[index % palette.length];
  }

  function dateOf(iso) { return new Date(iso); }

  function monthKeyOf(iso) { return String(iso || '').slice(0, 7); }

  function currentMonthKey() { return monthKeyOf(nowLocalIso()); }

  function monthLabel(key) {
    var p = String(key || '').split('-');
    return p[0] + '年' + parseInt(p[1], 10) + '月';
  }

  function monthShort(key) {
    var p = String(key || '').split('-');
    return parseInt(p[1], 10) + '月';
  }

  function shiftMonth(key, delta) {
    var p = String(key).split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + delta, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function nowLocalIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function isoFromDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function dayLabel(iso) {
    var d = dateOf(iso);
    if (isNaN(d.getTime())) return '';
    var today = new Date();
    var sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    var y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    var isYesterday = d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
    var base = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
    if (sameDay) return '今天 · ' + base;
    if (isYesterday) return '昨天 · ' + base;
    return base;
  }

  function timeLabel(iso) { return String(iso || '').slice(11, 16); }

  function dateLabel(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p[1] + '/' + p[2];
  }

  /* ---------- 金额输入 ---------- */

  /* 键盘输入串 -> 显示串（保留末尾小数点） */
  function amountDisplay(raw) {
    var s = String(raw || '').replace(/[^0-9.]/g, '');
    if (!s) return '0';
    var dot = s.indexOf('.');
    var intPart, decPart;
    if (dot >= 0) { intPart = s.slice(0, dot); decPart = s.slice(dot + 1); }
    else { intPart = s; decPart = null; }
    intPart = intPart.replace(/^0+(?=\d)/, '');
    intPart = intPart.replace(/^$/, '0');
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart === null ? intPart : intPart + '.' + decPart;
  }

  function pushDigit(raw, key) {
    var s = String(raw || '');
    if (key === 'del') return s.slice(0, -1);
    if (key === 'clear') return '';
    if (key === '.') {
      if (s.indexOf('.') >= 0) return s;
      return (s || '0') + '.';
    }
    var dot = s.indexOf('.');
    if (dot >= 0 && s.length - dot - 1 >= 2) return s;
    if (s.replace('.', '').length >= 9) return s;
    if (s === '0') return key;
    return s + key;
  }

  /* ---------- 支出聚合 ---------- */

  function aggregateMonth(entries, month) {
    var agg = {
      month: month,
      list: [],
      expense: 0,
      income: 0,
      count: 0,
      byCategory: { expense: {}, income: {} },
      byChannel: {},
      byDay: {},
      maxExpense: null
    };
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (monthKeyOf(e.time) !== month) continue;
      agg.list.push(e);
      agg.count++;
      var amt = round2(e.amount);
      var type = isIncome(e.type) ? 'income' : 'expense';
      if (type === 'income') agg.income += amt; else agg.expense += amt;

      var bc = agg.byCategory[type][e.category] || { amount: 0, count: 0 };
      bc.amount += amt; bc.count++;
      agg.byCategory[type][e.category] = bc;

      var ch = agg.byChannel[e.channel] || { expense: 0, income: 0, count: 0 };
      if (type === 'income') ch.income += amt; else ch.expense += amt;
      ch.count++;
      agg.byChannel[e.channel] = ch;

      var day = parseInt(String(e.time).slice(8, 10), 10);
      var dd = agg.byDay[day] || { expense: 0, income: 0 };
      if (type === 'income') dd.income += amt; else dd.expense += amt;
      agg.byDay[day] = dd;

      if (type === 'expense' && (!agg.maxExpense || amt > agg.maxExpense.amount)) agg.maxExpense = e;
    }
    agg.expense = round2(agg.expense);
    agg.income = round2(agg.income);
    agg.balance = round2(agg.income - agg.expense);
    return agg;
  }

  function categoryRank(agg, type) {
    var map = agg.byCategory[isIncome(type) ? 'income' : 'expense'] || {};
    var total = isIncome(type) ? agg.income : agg.expense;
    var rows = Object.keys(map).map(function (id) {
      var c = catOf(type, id);
      return {
        id: id,
        name: c.name,
        icon: c.icon,
        amount: round2(map[id].amount),
        count: map[id].count,
        pct: total > 0 ? (map[id].amount / total) * 100 : 0
      };
    });
    rows.sort(function (a, b) { return b.amount - a.amount; });
    return rows;
  }

  function channelRank(agg) {
    var rows = [];
    for (var i = 0; i < CHANNELS.length; i++) {
      var id = CHANNELS[i].id;
      var c = agg.byChannel[id];
      if (!c) continue;
      rows.push({
        id: id,
        name: CHANNELS[i].name,
        short: CHANNELS[i].short,
        color: CHANNELS[i].color,
        expense: round2(c.expense),
        income: round2(c.income),
        count: c.count
      });
    }
    rows.sort(function (a, b) { return b.expense - a.expense; });
    return rows;
  }

  function lastMonths(entries, endMonth, n) {
    n = n || 6;
    var keys = [];
    for (var i = n - 1; i >= 0; i--) keys.push(shiftMonth(endMonth, -i));
    return keys.map(function (k) {
      var sum = 0;
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j];
        if (monthKeyOf(e.time) === k && !isIncome(e.type)) sum += round2(e.amount);
      }
      return { key: k, label: monthShort(k), expense: round2(sum) };
    });
  }

  function daysInMonth(key) {
    var p = String(key).split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate();
  }

  /* ---------- 去重 ---------- */

  function findDuplicate(entries, cand, withinMinutes) {
    var win = (withinMinutes || 10) * 60000;
    var t = new Date(cand.time).getTime();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (isIncome(e.type) !== isIncome(cand.type)) continue;
      if (round2(e.amount) !== round2(cand.amount)) continue;
      if (e.channel !== cand.channel) continue;
      if (Math.abs(new Date(e.time).getTime() - t) <= win) return e;
    }
    return null;
  }

  /* ---------- 智能分类 ---------- */

  var CAT_RULES = [
    ['transport', /(滴滴|曹操|T3|高德|打车|出租车|地铁|公交|轻轨|高铁|火车|12306|航空|机票|加油|停车|单车|哈啰|青桔|ETC|高速|过路|车费|船票|携程|去哪儿)/],
    ['food', /(餐|饭|食|粉|面|粥|火锅|烧烤|咖啡|奶茶|茶饮|星巴克|瑞幸|库迪|麦当劳|肯德基|必胜客|汉堡|美团|饿了么|外卖|便利|超市|盒马|水果|生鲜|鲜生|菜场|食堂|快餐|甜品|蛋糕|烘焙|酒|零食|喜茶|蜜雪|老乡鸡|真功夫|吉野家|西贝|和府|南城香|烧烤|快餐)/],
    ['shopping', /(淘宝|天猫|京东|拼多多|唯品会|商城|专卖|服饰|服装|鞋|箱包|优衣库|无印|宜家|数码|家电|商场|百货|旗舰店|旗舰)/],
    ['daily', /(日用|洗衣|清洁|纸巾|五金|家居|理发|美发|剪发|快递|洗衣)/],
    ['fun', /(电影|影院|游戏|Steam|KTV|酒吧|演出|门票|景区|旅游|健身|运动|会员|爱奇艺|腾讯视频|网易云|Spotify|B站|哔哩)/],
    ['health', /(医院|药|诊所|体检|挂号|牙科|医疗|卫生|保健)/],
    ['home', /(房租|物业|水费|电费|燃气|取暖|家政|维修|装修)/],
    ['telecom', /(话费|流量|宽带|中国移动|中国联通|中国电信|充值)/],
    ['study', /(书|培训|课程|学费|考试|教育|文具|书店)/],
    ['social', /(礼|份子|人情|红包|转账给)/]
  ];

  function guessCategory(merchant, type) {
    var s = String(merchant || '');
    if (!s) return isIncome(type) ? 'other' : 'other';
    if (isIncome(type)) {
      if (/(工资|薪|代发)/.test(s)) return 'salary';
      if (/(奖金|绩效|提成)/.test(s)) return 'bonus';
      if (/(退款|退货)/.test(s)) return 'refund';
      if (/(红包)/.test(s)) return 'redpacket';
      return 'other';
    }
    for (var i = 0; i < CAT_RULES.length; i++) {
      if (CAT_RULES[i][1].test(s)) return CAT_RULES[i][0];
    }
    return 'other';
  }

  /* ---------- 文本解析（粘贴 / OCR） ---------- */

  var NOISE = /(微信支付|支付宝|云闪付|支付成功|付款成功|交易成功|收款成功|已支付|账单详情|交易单号|商户单号|订单号|付款方式|支付方式|交易时间|创建时间|当前状态|余额|零钱|银行卡|尾号|查看详情|查看更多|完成|返回|账单|明细|客服|投诉|发票|开发票|收银台|扫码|二维码|请核|温馨提示)/;

  function cleanMerchant(s) {
    var t = String(s || '').replace(/[\s\u3000]+/g, ' ').trim();
    t = t.replace(/^[·•\-—:：|]+/, '').replace(/[·•\-—:：|]+$/, '');
    if (t.length > 24) t = t.slice(0, 24);
    return t;
  }

  function buildIso(y, mo, d, h, mi) {
    var dt = new Date(y, mo - 1, d, h, mi);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d ||
      dt.getHours() !== h || dt.getMinutes() !== mi) return null;
    return isoFromDate(dt);
  }

  function parsePaymentText(raw) {
    var text = String(raw == null ? '' : raw).replace(/\r/g, '').replace(/\u00a0/g, ' ');
    var out = { amount: null, channel: null, merchant: '', time: null, type: 'expense' };
    if (!text.trim()) return out;

    /* 金额 */
    var patterns = [
      /[¥￥]\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
      /(?:实付|实收|支付金额|付款金额|消费金额|交易金额|转账金额|支出|消费|付款|转账|金额|合计|总计|应付|收款)\s*[:：]?\s*(?:人民币)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
      /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*元/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) { out.amount = round2(parseFloat(m[1].replace(/,/g, ''))); break; }
    }
    if (out.amount === null) {
      var re = /(?:^|[^0-9.])([0-9]{1,6}\.[0-9]{2})(?![0-9])/g;
      var mm = re.exec(text);
      if (mm) out.amount = round2(parseFloat(mm[1]));
    }

    /* 渠道：先看「支付方式 / 付款方式」这一行的值，比全文关键词更准 */
    var payMatch = text.match(/(?:支付方式|付款方式|收\/付款方式)\s*[:：]?\s*([^\n]{1,24})/);
    if (payMatch) {
      var pw = payMatch[1];
      if (/银行|储蓄卡|信用卡|借记卡/.test(pw)) out.channel = 'bankcard';
      else if (/零钱/.test(pw)) out.channel = 'wechat';
      else if (/余额宝|花呗|借呗|余额/.test(pw)) out.channel = 'alipay';
      else if (/云闪付|银联/.test(pw)) out.channel = 'other';
      else if (/微信/.test(pw)) out.channel = 'wechat';
      else if (/支付宝/.test(pw)) out.channel = 'alipay';
      else if (/现金/.test(pw)) out.channel = 'cash';
    }
    if (!out.channel) {
      if (/微信|零钱|理财通/.test(text)) out.channel = 'wechat';
      else if (/支付宝|花呗|余额宝|借呗/.test(text)) out.channel = 'alipay';
      else if (/云闪付|银联/.test(text)) out.channel = 'other';
      else if (/银行|储蓄卡|信用卡|尾号|借记卡/.test(text)) out.channel = 'bankcard';
      else if (/现金/.test(text)) out.channel = 'cash';
    }

    /* 收支 */
    var incomeHit = /(收到|收款|到账|入账|退款|收入|红包)/.test(text);
    var expenseHit = /(支付成功|付款成功|已支付|支出|消费|扣款|转出|付款给)/.test(text);
    if (incomeHit && !expenseHit) out.type = 'income';

    /* 时间 */
    var t, iso = null;
    t = text.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (t) iso = buildIso(+t[1], +t[2], +t[3], +t[4], +t[5]);
    if (!iso) {
      t = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (t) iso = buildIso(new Date().getFullYear(), +t[1], +t[2], +t[3], +t[4]);
    }
    if (!iso) {
      t = text.match(/(今天|昨天|前天)\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (t) {
        var off = t[1] === '今天' ? 0 : (t[1] === '昨天' ? 1 : 2);
        var d0 = new Date();
        d0.setDate(d0.getDate() - off);
        iso = buildIso(d0.getFullYear(), d0.getMonth() + 1, d0.getDate(), +t[2], +t[3]);
      }
    }
    if (!iso) {
      t = text.match(/(?:^|[^0-9])(\d{1,2})\s*[:：]\s*(\d{2})(?![0-9])/);
      if (t) {
        var dn = new Date();
        iso = buildIso(dn.getFullYear(), dn.getMonth() + 1, dn.getDate(), +t[1], +t[2]);
      }
    }
    out.time = iso;

    /* 商户 */
    t = text.match(/(?:收款方|商户名称|商户名|商户|付款给|收款人|对方|收款账户|收款单位|交易对方)\s*[:：]\s*([^\n]{1,40})/);
    if (t) out.merchant = cleanMerchant(t[1]);
    if (!out.merchant) {
      var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var amountStr = out.amount != null ? String(out.amount) : '';

      /* 找到金额所在行，商户名通常紧跟在金额下面 */
      var amountLine = -1;
      if (amountStr) {
        var compactAmt = amountStr.replace('.', '');
        for (var q = 0; q < lines.length; q++) {
          var dg = lines[q].replace(/[^\d.]/g, '');
          if (!dg) continue;
          if (dg.indexOf(amountStr) >= 0 || dg.replace('.', '').indexOf(compactAmt) >= 0) { amountLine = q; break; }
        }
      }

      var isName = function (line) {
        if (!line) return false;
        if (line.length < 2 || line.length > 24) return false;
        if (NOISE.test(line)) return false;
        if (/^[\d\s.,:：/\\|+\-%¥￥]+$/.test(line)) return false;
        if (/^\d{1,2}\s*[:：]\s*\d{2}/.test(line)) return false;
        if (/^\d{4}\s*[年\-\/.]\s*\d{1,2}/.test(line)) return false;
        if (/(4G|5G|WiFi|WIFI|LTE|中国联通|中国移动|中国电信|信号|电量|电池)/i.test(line)) return false;
        if (/(单号|订单|状态|方式|时间|机构|备注|详情|编号|金额|余额)/.test(line)) return false;
        if (!/[\u4e00-\u9fa5A-Za-z]/.test(line)) return false;
        return true;
      };

      var picked = '';
      var scan = function (from, to) {
        for (var k = from; k < to; k++) {
          if (isName(lines[k])) { picked = lines[k]; return true; }
        }
        return false;
      };

      if (amountLine >= 0) scan(amountLine + 1, Math.min(lines.length, amountLine + 6));
      if (!picked) scan(0, lines.length);
      out.merchant = cleanMerchant(picked);
    }
    return out;
  }

  /* ---------- 账单 CSV 解析（微信 / 支付宝导出） ---------- */

  function parseCSV(text) {
    var s = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [], row = [], field = '', inQuote = false, i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (inQuote) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuote = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuote = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function normalizeBillTime(s) {
    var m = String(s == null ? '' : s).match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m) return null;
    return buildIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
  }

  function parseBillCSV(text) {
    var out = { format: null, rows: [], skipped: 0, total: 0, error: null };
    var rows = parseCSV(text);
    if (!rows.length) { out.error = 'empty'; return out; }

    var headerIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 80); i++) {
      var r = rows[i];
      if (!r || !r.length) continue;
      var first = String(r[0] || '').replace(/^\uFEFF/, '').replace(/\s/g, '');
      if (first === '交易时间') { headerIdx = i; break; }
    }
    if (headerIdx < 0) { out.error = 'no-header'; return out; }

    var header = rows[headerIdx].map(function (h) {
      return String(h == null ? '' : h).replace(/^\uFEFF/, '').trim();
    });
    var col = function () {
      for (var k = 0; k < arguments.length; k++) {
        var idx = header.indexOf(arguments[k]);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    var iTime = col('交易时间');
    var iDir = col('收/支');
    var iAmt = col('金额(元)', '金额（元）', '金额');
    var iWho = col('交易对方');
    var iDesc = col('商品', '商品说明', '交易说明');
    var iStat = col('当前状态', '交易状态');
    var iWay = col('支付方式', '收/付款方式');

    if (iTime < 0 || iDir < 0 || iAmt < 0) { out.error = 'columns'; return out; }

    var isAlipay = header.indexOf('收/付款方式') >= 0 || header.indexOf('交易分类') >= 0 || header.indexOf('交易状态') >= 0;
    out.format = isAlipay ? 'alipay' : 'wechat';

    for (var j = headerIdx + 1; j < rows.length; j++) {
      var row = rows[j];
      if (!row || !row.length) continue;
      var timeRaw = String(row[iTime] == null ? '' : row[iTime]).trim();
      var dir = String(row[iDir] == null ? '' : row[iDir]).trim();
      var amtRaw = String(row[iAmt] == null ? '' : row[iAmt]).trim();
      if (!timeRaw && !dir && !amtRaw) continue;
      out.total++;

      if (dir === '不计收支' || dir === '') { out.skipped++; continue; }

      var status = iStat >= 0 ? String(row[iStat] == null ? '' : row[iStat]) : '';
      if (/(关闭|失败|撤销|取消|退款)/.test(status)) { out.skipped++; continue; }

      var amount = parseFloat(amtRaw.replace(/[¥￥,\s]/g, ''));
      if (!(amount > 0)) { out.skipped++; continue; }

      var time = normalizeBillTime(timeRaw);
      if (!time) { out.skipped++; continue; }

      var who = String(row[iWho] == null ? '' : row[iWho]).trim();
      var desc = iDesc >= 0 ? String(row[iDesc] == null ? '' : row[iDesc]).trim() : '';
      if ((!who || who === '转账' || who === '红包') && desc) who = desc;
      var merchant = cleanMerchant(who || desc);
      var type = dir === '收入' ? 'income' : 'expense';

      out.rows.push({
        time: time,
        type: type,
        amount: round2(amount),
        merchant: merchant,
        desc: desc,
        channel: isAlipay ? 'alipay' : 'wechat',
        category: guessCategory(merchant || desc, type),
        status: status,
        payWay: iWay >= 0 ? String(row[iWay] == null ? '' : row[iWay]).trim() : ''
      });
    }
    return out;
  }

  /* ---------- 导出 ---------- */

  function csv(entries) {
    var head = ['日期', '时间', '类型', '金额', '分类', '支付方式', '商户', '备注'];
    var esc = function (v) {
      var s = String(v == null ? '' : v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    var rows = [head.map(esc).join(',')];
    entries.forEach(function (e) {
      rows.push([
        String(e.time).slice(0, 10),
        timeLabel(e.time),
        isIncome(e.type) ? '收入' : '支出',
        round2(e.amount).toFixed(2),
        catOf(e.type, e.category).name,
        channelOf(e.channel).name,
        e.merchant || '',
        e.note || ''
      ].map(esc).join(','));
    });
    return rows.join('\r\n');
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var type = e.type === 'income' ? 'income' : 'expense';
    var time = String(e.time || '').slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) time = nowLocalIso();
    var ch = channelOf(e.channel).id;
    var cat = catOf(type, e.category).id;
    return {
      id: String(e.id || uid()),
      type: type,
      amount: round2(e.amount),
      category: cat,
      channel: ch,
      merchant: String(e.merchant || '').slice(0, 60),
      note: String(e.note || '').slice(0, 120),
      time: time,
      source: ['manual', 'paste', 'ocr', 'import'].indexOf(e.source) >= 0 ? e.source : 'manual',
      createdAt: num(e.createdAt) || Date.now()
    };
  }

  var api = {
    CHANNELS: CHANNELS,
    EXPENSE_CATS: EXPENSE_CATS,
    INCOME_CATS: INCOME_CATS,
    uid: uid,
    pad2: pad2,
    num: num,
    round2: round2,
    money: money,
    sym: sym,
    channelOf: channelOf,
    catsOf: catsOf,
    catOf: catOf,
    catColor: catColor,
    monthKeyOf: monthKeyOf,
    currentMonthKey: currentMonthKey,
    monthLabel: monthLabel,
    monthShort: monthShort,
    shiftMonth: shiftMonth,
    nowLocalIso: nowLocalIso,
    isoFromDate: isoFromDate,
    dayLabel: dayLabel,
    timeLabel: timeLabel,
    dateLabel: dateLabel,
    amountDisplay: amountDisplay,
    pushDigit: pushDigit,
    aggregateMonth: aggregateMonth,
    categoryRank: categoryRank,
    channelRank: channelRank,
    lastMonths: lastMonths,
    daysInMonth: daysInMonth,
    findDuplicate: findDuplicate,
    guessCategory: guessCategory,
    parsePaymentText: parsePaymentText,
    parseCSV: parseCSV,
    parseBillCSV: parseBillCSV,
    normalizeBillTime: normalizeBillTime,
    csv: csv,
    normalizeEntry: normalizeEntry
  };

  root.LedgerCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
