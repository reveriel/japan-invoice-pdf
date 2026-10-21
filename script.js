/* =========================================================
   適格請求書 作成ツール — script.js
   純粋なフロントエンドのみ。外部通信は行いません。
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     ユーティリティ
     --------------------------------------------------------- */

  // 全角英数字・記号を半角に正規化
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, ' ');
  }

  // 通貨文字列 → 数値
  function parseMoney(str) {
    if (str === null || str === undefined) return 0;
    var cleaned = toHalfWidth(String(str)).replace(/[^\d.-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // 数値 → 千分位カンマ
  function comma(n) {
    var rounded = Math.round(n);
    var neg = rounded < 0;
    var s = String(Math.abs(rounded));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // 数値 → ¥1,234
  function yen(n) {
    return '¥' + comma(n);
  }

  // 元号の開始日（この日以降がその元号）
  var WAREKI_ERAS = [
    { name: '令和', y: 2019, m: 5,  d: 1  },
    { name: '平成', y: 1989, m: 1,  d: 8  },
    { name: '昭和', y: 1926, m: 12, d: 25 },
    { name: '大正', y: 1912, m: 7,  d: 30 },
    { name: '明治', y: 1868, m: 1,  d: 25 }
  ];

  // 西暦日付 → 和暦表記（元年は「1年」ではなく「元年」）
  function toWareki(y, mo, d) {
    for (var i = 0; i < WAREKI_ERAS.length; i++) {
      var era = WAREKI_ERAS[i];
      var started = y > era.y ||
        (y === era.y && (mo > era.m || (mo === era.m && d >= era.d)));
      if (started) {
        var n = y - era.y + 1;
        return era.name + (n === 1 ? '元年' : n + '年') + mo + '月' + d + '日';
      }
    }
    return null; // 明治より前は西暦表記のまま
  }

  // "2026-10-11" → "2026年10月11日" / 和暦選択時 "令和8年10月11日"
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (dateEraMode === 'wareki') {
      var wareki = toWareki(y, mo, d);
      if (wareki) return wareki;
    }
    return y + '年' + mo + '月' + d + '日';
  }

  // 数量は小数第2位まで、整数ならそのまま
  function formatQty(n) {
    if (!isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function $(id) { return document.getElementById(id); }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  /* ---------------------------------------------------------
     状態
     --------------------------------------------------------- */

  var TAX_RATES = { TEN: 10, EIGHT: 8 };

  var dateEraMode = 'seireki'; // 'seireki' | 'wareki'

  var rowSeq = 0;
  var rows = []; // { id, name, qty, price, rate }

  var DEFAULTS = {
    issuerName: '山田 太郎',
    regNumber: 'T1234567890123',
    clientName: '株式会社サンプル',
    clientHonorific: '御中',
    docTitle: '請求書',
    invoiceNo: 'INV-2026-001',
    notes: 'お支払い期限は翌月末日です。\nご不明な点がございましたらお気軽にご連絡ください。',
    bankInfo: 'サンプル銀行 本店営業部\n普通 1234567\nヤマダ タロウ'
  };

  var DEFAULT_ROWS = [
    { name: 'Webサイト デザイン制作費', qty: 1, price: 250000, rate: 10 },
    { name: '商品撮影（出張撮影）', qty: 1, price: 45000, rate: 10 },
    { name: '技術書・書籍販売', qty: 6, price: 1800, rate: 8 }
  ];

  /* ---------------------------------------------------------
     登録番号の検証
     --------------------------------------------------------- */

  function normalizeRegNumber(value) {
    return toHalfWidth(value).replace(/[\s　-]/g, '').toUpperCase();
  }

  // 空なら null、正しければ正規化文字列、誤りなら false
  function validateRegNumber(value) {
    var normalized = normalizeRegNumber(value);
    if (normalized === '') return null;
    return /^T\d{13}$/.test(normalized) ? normalized : false;
  }

  /* ---------------------------------------------------------
     明細行の生成・操作
     --------------------------------------------------------- */

  function createRow(data) {
    rowSeq += 1;
    var row = {
      id: 'r' + rowSeq,
      name: data && data.name != null ? data.name : '',
      qty: data && data.qty != null ? data.qty : 1,
      price: data && data.price != null ? data.price : 0,
      rate: data && data.rate === 8 ? 8 : 10
    };
    rows.push(row);
    return row;
  }

  function buildRowElement(row) {
    var el = document.createElement('div');
    el.className = 'row';
    el.dataset.id = row.id;
    el.innerHTML =
      '<input type="text" class="i-name" aria-label="品目" placeholder="品目・取引内容">' +
      '<input type="text" class="i-qty num" aria-label="数量" inputmode="decimal" placeholder="1">' +
      '<input type="text" class="i-price num" aria-label="単価（税抜）" inputmode="numeric" placeholder="0">' +
      '<select class="i-rate" aria-label="税率">' +
        '<option value="10">10%</option>' +
        '<option value="8">8% 軽減</option>' +
      '</select>' +
      '<button type="button" class="btn btn-icon i-del" aria-label="この行を削除">' +
        '<svg viewBox="0 0 16 16" class="ic" aria-hidden="true">' +
          '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" ' +
          'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
      '</button>';

    el.querySelector('.i-name').value = row.name;
    el.querySelector('.i-qty').value = formatQty(row.qty);
    el.querySelector('.i-price').value = row.price ? comma(row.price) : '';
    el.querySelector('.i-rate').value = String(row.rate);

    return el;
  }

  function addRowToDOM(data) {
    var row = createRow(data);
    var el = buildRowElement(row);
    $('rowsContainer').appendChild(el);
    return el;
  }

  function renderAllRows() {
    var container = $('rowsContainer');
    container.innerHTML = '';
    rows = [];
    rowSeq = 0;
    DEFAULT_ROWS.forEach(function (r) { addRowToDOM(r); });
  }

  function findRow(id) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  /* ---------------------------------------------------------
     計算
     --------------------------------------------------------- */

  function computeTotals() {
    var groups = {};
    groups[TAX_RATES.TEN] = { rate: TAX_RATES.TEN, subtotal: 0, tax: 0, count: 0 };
    groups[TAX_RATES.EIGHT] = { rate: TAX_RATES.EIGHT, subtotal: 0, tax: 0, count: 0 };

    var lines = rows.map(function (row) {
      var amount = Math.round(row.qty * row.price);
      var g = groups[row.rate] || groups[TAX_RATES.TEN];
      if (amount > 0) g.subtotal += amount;
      g.count += 1;
      return { row: row, amount: amount };
    });

    var subtotal = 0;
    var taxTotal = 0;
    [TAX_RATES.TEN, TAX_RATES.EIGHT].forEach(function (rate) {
      var g = groups[rate];
      // 税率区分ごとに消費税を計算し、1円未満は切り捨て
      g.tax = Math.floor(g.subtotal * rate / 100);
      subtotal += g.subtotal;
      taxTotal += g.tax;
    });

    return {
      lines: lines,
      groups: groups,
      subtotal: subtotal,
      taxTotal: taxTotal,
      grand: subtotal + taxTotal,
      usedRates: [TAX_RATES.TEN, TAX_RATES.EIGHT].filter(function (r) {
        return groups[r].count > 0;
      })
    };
  }

  /* ---------------------------------------------------------
     プレビューの描画
     --------------------------------------------------------- */

  function placeholder(text) {
    return '<span class="ph">' + text + '</span>';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // 書式設定（字体・太字・日付表記）を紙面へ反映する
  function applyFormat() {
    var paper = $('paper');
    if (!paper) return;

    var fontEl = document.querySelector('input[name="docFont"]:checked');
    var weightEl = document.querySelector('input[name="docWeight"]:checked');
    var eraEl = document.querySelector('input[name="dateEra"]:checked');

    var font = fontEl ? fontEl.value : 'gothic';
    paper.classList.toggle('font-mincho', font === 'mincho');
    paper.classList.toggle('font-gothic', font !== 'mincho');

    var bold = weightEl ? weightEl.value === 'bold' : false;
    paper.classList.toggle('weight-bold', bold);

    dateEraMode = eraEl && eraEl.value === 'wareki' ? 'wareki' : 'seireki';
  }

  function applyFormatDefaults() {
    var font = $('fmtFontGothic');
    var weight = $('fmtWeightNormal');
    var era = $('fmtEraSeireki');
    if (font) font.checked = true;
    if (weight) weight.checked = true;
    if (era) era.checked = true;
  }

  function renderPreview() {
    applyFormat();

    var issuerNameEl = $('issuerName');
    var clientNameEl = $('clientName');
    var regEl = $('regNumber');

    /* --- 要件 1: 発行者の氏名・名称 + 登録番号 --- */
    $('pvIssuerName').innerHTML = issuerNameEl.value.trim()
      ? escapeHtml(issuerNameEl.value.trim())
      : placeholder('発行者名を入力');

    var regResult = validateRegNumber(regEl.value);
    var regOut = $('pvRegNumber');
    if (regResult === false) {
      var half = toHalfWidth(regEl.value).trim();
      regOut.innerHTML = '<span class="reg-bad">' + escapeHtml(half || '（未入力）') + '</span>';
    } else if (regResult === null) {
      regOut.innerHTML = '<span class="reg-missing">（未入力）</span>';
    } else {
      regOut.textContent = regResult;
    }

    /* --- 要件 2: 取引年月日 --- */
    var dateISO = $('issueDate').value;
    $('pvDate').innerHTML = dateISO
      ? escapeHtml(formatDate(dateISO))
      : placeholder('未入力');

    /* --- 要件 6: 宛先の氏名・名称 --- */
    $('pvClientName').innerHTML = clientNameEl.value.trim()
      ? escapeHtml(clientNameEl.value.trim())
      : placeholder('宛先を入力');
    $('pvHonorific').textContent = $('clientHonorific').value;

    /* タイトル・任意項目 */
    $('pvTitle').textContent = $('docTitle').value;

    var invoiceNo = $('invoiceNo').value.trim();
    $('pvInvoiceNoLine').hidden = !invoiceNo;
    $('pvInvoiceNo').textContent = invoiceNo;

    var dueISO = $('dueDate').value;
    $('pvDueLine').hidden = !dueISO;
    $('pvDue').textContent = dueISO ? formatDate(dueISO) : '';

    /* --- 明細（要件 3・4・5） --- */
    var totals = computeTotals();
    var tbody = $('pvItems');
    tbody.innerHTML = '';

    if (!totals.lines.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">明細がありません</td></tr>';
    } else {
      totals.lines.forEach(function (line) {
        var tr = document.createElement('tr');

        var nameCell = document.createElement('td');
        nameCell.className = 'td-name';
        var nameText = line.row.name.trim();
        nameCell.innerHTML =
          '<span class="item-name">' + (nameText ? escapeHtml(nameText) : placeholder('品目未入力')) + '</span>' +
          (line.row.rate === TAX_RATES.EIGHT ? '<span class="tax-mark">※</span>' : '');

        var qtyCell = document.createElement('td');
        qtyCell.className = 'td-qty';
        qtyCell.textContent = formatQty(line.row.qty);

        var priceCell = document.createElement('td');
        priceCell.className = 'td-price';
        priceCell.textContent = yen(line.row.price);

        var taxCell = document.createElement('td');
        taxCell.className = 'td-tax';
        taxCell.textContent = line.row.rate === TAX_RATES.EIGHT ? '8%（軽減）' : '10%';

        var amountCell = document.createElement('td');
        amountCell.className = 'td-amount';
        amountCell.textContent = yen(line.amount);

        tr.appendChild(nameCell);
        tr.appendChild(qtyCell);
        tr.appendChild(priceCell);
        tr.appendChild(taxCell);
        tr.appendChild(amountCell);
        tbody.appendChild(tr);
      });
    }

    var hasReduced = totals.groups[TAX_RATES.EIGHT].count > 0;
    $('pvReducedNote').hidden = !hasReduced;

    /* --- 要件 4・5: 税率ごとの合計額と消費税額 --- */
    var breakdownBody = $('pvBreakdown');
    breakdownBody.innerHTML = '';

    if (!totals.usedRates.length) {
      breakdownBody.innerHTML = '<tr><td colspan="3" class="empty-cell">明細がありません</td></tr>';
    } else {
      totals.usedRates.forEach(function (rate) {
        var g = totals.groups[rate];
        var tr = document.createElement('tr');

        var label = rate === TAX_RATES.EIGHT ? '8%（軽減税率）' : '10%（標準税率）';
        tr.innerHTML =
          '<td>' + label + '</td>' +
          '<td class="num">' + yen(g.subtotal) + '</td>' +
          '<td class="num">' + yen(g.tax) + '</td>';
        breakdownBody.appendChild(tr);
      });
    }

    $('pvSubtotal').textContent = yen(totals.subtotal);
    $('pvTaxTotal').textContent = yen(totals.taxTotal);
    $('pvTotal').textContent = yen(totals.grand);
    $('pvGrand').textContent = yen(totals.grand);

    /* 備考・振込先 */
    var notes = $('notes').value.trim();
    $('pvNotesBlock').hidden = !notes;
    $('pvNotes').textContent = notes;

    var bank = $('bankInfo').value.trim();
    $('pvBankBlock').hidden = !bank;
    $('pvBank').textContent = bank;

    /* 注記 */
    var paperNote = $('pvPaperNote');
    if (totals.lines.length) {
      paperNote.hidden = false;
      paperNote.textContent =
        '※ 消費税額は税率区分ごとに計算し、1円未満は切り捨てています。' +
        (regResult === null || regResult === false
          ? ' また、登録番号が未入力または形式が正しくないため、本書は適格請求書としての要件を満たしていません。'
          : '');
    } else {
      paperNote.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     登録番号エラー表示
     --------------------------------------------------------- */

  function updateRegNumberState() {
    var input = $('regNumber');
    var errorEl = $('regNumberError');
    var result = validateRegNumber(input.value);

    if (result === false) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      errorEl.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     イベント
     --------------------------------------------------------- */

  function handleRowInput(event) {
    var rowEl = event.target.closest('.row');
    if (!rowEl) return;
    var row = findRow(rowEl.dataset.id);
    if (!row) return;

    if (event.target.classList.contains('i-name')) {
      row.name = event.target.value;
    } else if (event.target.classList.contains('i-qty')) {
      row.qty = parseMoney(event.target.value);
    } else if (event.target.classList.contains('i-price')) {
      row.price = parseMoney(event.target.value);
    } else if (event.target.classList.contains('i-rate')) {
      row.rate = event.target.value === '8' ? 8 : 10;
    }
    renderPreview();
  }

  function handleRowCommit(event) {
    // 単価の入力欄からフォーカスが外れたらカンマ区切りに整形
    if (event.target.classList.contains('i-price')) {
      var rowEl = event.target.closest('.row');
      var row = rowEl && findRow(rowEl.dataset.id);
      if (row) event.target.value = row.price ? comma(row.price) : '';
    } else if (event.target.classList.contains('i-qty')) {
      var rowEl2 = event.target.closest('.row');
      var row2 = rowEl2 && findRow(rowEl2.dataset.id);
      if (row2) event.target.value = formatQty(row2.qty);
    }
  }

  function handleRowDelete(event) {
    var btn = event.target.closest('.i-del');
    if (!btn) return;
    var rowEl = btn.closest('.row');
    if (!rowEl) return;

    var id = rowEl.dataset.id;
    rows = rows.filter(function (r) { return r.id !== id; });
    rowEl.remove();

    if (!rows.length) addRowToDOM({ name: '', qty: 1, price: 0, rate: 10 });

    renderPreview();
  }

  // フォーム項目に初期値を流し込む（明細行は別途）
  function applyFieldDefaults() {
    $('issuerName').value = DEFAULTS.issuerName;
    $('regNumber').value = DEFAULTS.regNumber;
    $('clientName').value = DEFAULTS.clientName;
    $('clientHonorific').value = DEFAULTS.clientHonorific;
    $('docTitle').value = DEFAULTS.docTitle;
    $('invoiceNo').value = DEFAULTS.invoiceNo;
    $('notes').value = DEFAULTS.notes;
    $('bankInfo').value = DEFAULTS.bankInfo;
    $('issueDate').value = todayISO();
    $('dueDate').value = '';
  }

  function resetForm() {
    applyFieldDefaults();
    applyFormatDefaults();
    renderAllRows();
    updateRegNumberState();
    renderPreview();
  }

  /* ---------------------------------------------------------
     初期化
     --------------------------------------------------------- */

  function init() {
    applyFieldDefaults();

    rowSeq = 0;
    rows = [];
    DEFAULT_ROWS.forEach(function (r) { addRowToDOM(r); });

    // 登録番号は入力を半角に正規化しつつ検証
    var regInput = $('regNumber');
    regInput.addEventListener('input', function () {
      var half = toHalfWidth(regInput.value).toUpperCase();
      if (half !== regInput.value) {
        var pos = regInput.selectionStart;
        regInput.value = half;
        try { regInput.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
      }
      updateRegNumberState();
      renderPreview();
    });
    regInput.addEventListener('blur', function () {
      var normalized = normalizeRegNumber(regInput.value);
      if (/^T\d{13}$/.test(normalized)) {
        regInput.value = normalized;
        updateRegNumberState();
        renderPreview();
      }
    });

    $('invoiceForm').addEventListener('input', function (event) {
      if (event.target.closest('.row')) return;
      renderPreview();
    });
    $('invoiceForm').addEventListener('change', function (event) {
      if (event.target.closest('.row')) return;
      renderPreview();
    });

    var rowsContainer = $('rowsContainer');
    rowsContainer.addEventListener('input', handleRowInput);
    rowsContainer.addEventListener('change', handleRowInput);
    rowsContainer.addEventListener('focusout', handleRowCommit);
    rowsContainer.addEventListener('click', handleRowDelete);

    $('addRowBtn').addEventListener('click', function () {
      var el = addRowToDOM({ name: '', qty: 1, price: 0, rate: 10 });
      renderPreview();
      var input = el.querySelector('.i-name');
      if (input) input.focus();
    });

    $('printBtn').addEventListener('click', function () {
      window.print();
    });

    $('resetBtn').addEventListener('click', resetForm);

    updateRegNumberState();
    renderPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* =========================================================
   シェア（バイラル導線） — 既存機能には触れない独立モジュール
   ========================================================= */
(function () {
  'use strict';

  var SHARE_URL  = "https://www.reveriel.com/japan-invoice-pdf/";
  var CARD_TITLE = "適格請求書 作成ツール";
  var CARD_SUB   = "ブラウザだけで作れる無料の適格請求書ジェネレーター";
  var CARD_FOOT  = "www.reveriel.com/japan-invoice-pdf";
  var FILE_NAME  = "japan-invoice-pdf.png";

  var SHARE_TEXT = "ブラウザだけで作れる無料の適格請求書ジェネレーター";

  function byId(id) { return document.getElementById(id); }

  function shareText() { return SHARE_TEXT; }
  function cardSub()   { return CARD_SUB; }

  function openExternal(url) {
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function buildTweetUrl() {
    return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) +
      '&url=' + encodeURIComponent(SHARE_URL);
  }
  function buildLineUrl() {
    return 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(SHARE_URL);
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(
            function () { resolve(true); },
            function () { resolve(fallbackCopy(text)); }
          );
          return;
        }
      } catch (e) { /* fallthrough */ }
      resolve(fallbackCopy(text));
    });
  }

  /* ---- 共有カード（1200 x 630） ---- */
  var CARD_W = 1200, CARD_H = 630;
  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(ctx) {
    var g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, '#1e3a8a');
    g.addColorStop(1, '#2f5bd0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(CARD_W - 130, 80, 230, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(CARD_W - 300, CARD_H + 10, 160, 0, Math.PI * 2); ctx.fill();

    var PAD = 80;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 24px ' + FONT;
    ctx.fillText('FREE TOOL — BROWSER ONLY', PAD, 106);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 74px ' + FONT;
    ctx.fillText(CARD_TITLE, PAD, 260);

    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '500 34px ' + FONT;
    ctx.fillText(cardSub(), PAD, 336);

    ctx.fillStyle = 'rgba(255,255,255,.85)';
    roundRect(ctx, PAD, CARD_H - 138, 64, 6, 3);
    ctx.fill();

    ctx.fillStyle = '#dbe6ff';
    ctx.font = '700 30px ' + FONT;
    ctx.fillText(CARD_FOOT, PAD, CARD_H - 80);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = '500 22px ' + FONT;
    ctx.fillText('無料・登録不要', CARD_W - PAD, CARD_H - 80);
    ctx.textAlign = 'left';
  }

  function renderCardBlob() {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = CARD_W;
        canvas.height = CARD_H;
        var ctx = canvas.getContext('2d');
        var finish = function () {
          if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, 'image/png');
          else resolve(null);
        };
        var draw = function () {
          try { drawCard(ctx); } catch (e) {}
          finish();
        };
        if (document.fonts && document.fonts.ready) {
          var drawn = false;
          var once = function () { if (drawn) { return; } drawn = true; draw(); };
          document.fonts.ready.then(once).catch(once);
          // fonts.ready が解決しない環境でも保存ボタンが固まらないようタイムアウト競走させる
          setTimeout(once, 1500);
        } else {
          draw();
        }
      } catch (e) { resolve(null); }
    });
  }

  function flash(el, text) {
    if (!el) return;
    var old = el.textContent;
    el.textContent = text;
    setTimeout(function () { el.textContent = old; }, 1800);
  }

  function init() {
    var xBtn = byId('shareXBtn');
    var lBtn = byId('shareLineBtn');
    var cBtn = byId('shareCopyBtn');
    var sBtn = byId('shareSaveBtn');
    var urlText = byId('shareUrlText');
    if (!xBtn || !lBtn || !cBtn) return;

    if (urlText) urlText.textContent = SHARE_URL;

    xBtn.addEventListener('click', function () { openExternal(buildTweetUrl()); });
    lBtn.addEventListener('click', function () { openExternal(buildLineUrl()); });

    var copyLabel = byId('shareCopyLabel');
    var resetTimer = null;
    cBtn.addEventListener('click', function () {
      var original = copyLabel ? copyLabel.textContent : '';
      copyText(SHARE_URL).then(function (ok) {
        if (!copyLabel) return;
        copyLabel.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { copyLabel.textContent = original; }, 1800);
      });
    });

    if (sBtn) {
      var saveLabel = byId('shareSaveLabel');
      sBtn.addEventListener('click', function () {
        if (sBtn.disabled) return;
        sBtn.disabled = true;
        renderCardBlob().then(function (blob) {
          sBtn.disabled = false;
          if (!blob) { flash(saveLabel, '画像を生成できませんでした'); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = FILE_NAME;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
