/* A&AP New order, contract v1.7. No transport: only the supplied ctx functions.
 * Progress accepts a percentage (0–100), or {loaded, total}/{percent}.
 * ACH and card totals are quotes; the contract does not collect a payment method.
 * ctx.draft restores a kept draft (files come back as names to choose again); ctx.saveDraft gets every change;
 * ctx.startOver clears it for a different order.
 */
(function () {
  'use strict';
  let current = null;
  let sequence = 0;
  const money = cents => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0
  }).format(cents / 100);
  const dateText = date => date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
  function businessDate(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    let left = Math.max(0, Math.ceil(Number(days) || 0));
    while (left > 0) {
      date.setDate(date.getDate() + 1);
      if (date.getDay() !== 0 && date.getDay() !== 6) left--;
    }
    return date;
  }
  const isoDay = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  function node(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = 'aap-new-' + cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function mount(root, ctx) {
    if (!root || root.nodeType !== 1) throw new TypeError('A new order root is required.');
    unmount();
    const id = 'aap-new-' + (++sequence) + '-';
    const lanes = Array.isArray(ctx.lanes) ? ctx.lanes : [];
    const addons = Array.isArray(ctx.addons) ? ctx.addons : [];
    const payment = ctx.payment || {};
    const plan = ctx.plan;
    let alive = true, busy = false, done = false, created = null, waiting = false;
    let selected = lanes[0] || null;
    const chosen = new Set();
    const files = [];
    const completed = new Set();
    const again = [];
    const draft = ctx.draft && typeof ctx.draft === 'object' ? ctx.draft : null;
    const wrapper = node('div', 'root');
    const style = node('style');
    style.textContent = `
.aap-new-root { box-sizing:border-box; max-width:720px; margin:0 auto; padding:24px 24px 96px; color:#1c1c1c; background:#fff; font:400 18px/1.5 var(--font,"Segoe UI",system-ui,sans-serif); overflow-wrap:anywhere; }
.aap-new-root * { box-sizing:border-box; }
.aap-new-root [hidden] { display:none !important; }
.aap-new-root p { margin:0; }
.aap-new-title { font:700 30px/1.2 var(--display,"Segoe UI",system-ui,sans-serif); color:#0d2a46; margin:0 0 8px; }
.aap-new-link { color:#005ea8; display:inline-flex; align-items:center; min-height:48px; min-width:48px; }
.aap-new-back { margin-bottom:8px; font-size:16px; font-weight:600; text-decoration:none; }
.aap-new-intro { margin-bottom:24px !important; }
.aap-new-sheet { border:1px solid #e3e3e3; border-radius:4px; padding:20px; display:grid; gap:16px; min-width:0; }
.aap-new-drop { border:2px dashed #aaa; border-radius:4px; padding:24px; text-align:center; color:#444; display:grid; gap:12px; justify-items:center; }
.aap-new-drop.aap-new-drag { border-color:#005ea8; background:#eaf3fb; }
.aap-new-button { font-family:inherit; font-size:18px; font-weight:600; line-height:1.5; min-height:48px; min-width:48px; border:1px solid #005ea8; border-radius:4px; padding:9px 20px; background:#005ea8; color:#fff; white-space:normal; cursor:pointer; }
.aap-new-button:hover { background:#004f8f; }
.aap-new-button:disabled { opacity:.65; cursor:default; }
.aap-new-secondary { background:#fff; color:#005ea8; }
.aap-new-secondary:hover { background:#eaf3fb; }
.aap-new-root :focus-visible { outline:3px solid #005ea8; outline-offset:3px; }
.aap-new-picker { display:none; }
.aap-new-fieldset { min-width:0; border:0; margin:0; padding:0; display:grid; gap:8px; }
.aap-new-legend { padding:0; margin-bottom:8px; font-size:18px; font-weight:700; color:#0d2a46; }
.aap-new-option { display:flex; align-items:center; gap:12px; padding:8px; min-height:48px; cursor:pointer; border-radius:4px; }
.aap-new-option:has(input:checked) { background:#f0f6fb; }
.aap-new-choice { width:24px; height:24px; flex:none; margin:0; accent-color:#005ea8; }
.aap-new-option-copy { flex:1; min-width:0; }
.aap-new-note { display:block; color:#444; font-size:18px; font-weight:400; }
.aap-new-price { flex:none; font-variant-numeric:tabular-nums; }
.aap-new-field { display:grid; gap:4px; font-weight:600; }
.aap-new-input { font-family:inherit; font-size:18px; font-weight:400; line-height:1.5; min-height:48px; width:100%; min-width:0; padding:12px 16px; border:1px solid #aaa; border-radius:4px; color:#1c1c1c; background:#fff; }
.aap-new-input[type=date] { max-width:100%; }
.aap-new-input:is(textarea) { resize:vertical; }
.aap-new-summary { margin:0; }
.aap-new-kv { display:flex; justify-content:space-between; align-items:baseline; gap:16px; padding:8px 0; border-bottom:1px solid #e3e3e3; }
.aap-new-kv dt { flex:1; }
.aap-new-kv dd { flex:1; margin:0; text-align:right; font-weight:600; font-variant-numeric:tabular-nums; }
.aap-new-total { border-top:2px solid #0d2a46; color:#0d2a46; font-weight:700; }
.aap-new-detail { margin:0; padding:0; list-style:none; color:#444; }
.aap-new-detail li { padding:4px 0; }
.aap-new-actions { display:flex; flex-wrap:wrap; gap:8px; }
.aap-new-warning { background:#fdf3e1; border:1px solid #f1dcb0; border-radius:4px; color:#7a4300; padding:16px; display:grid; gap:16px; }
.aap-new-error { color:#a72a2a; }
.aap-new-receipt { padding:16px; border:1px solid #cfe6c7; border-radius:4px; background:#ecf6e8; color:#236b1f; font-weight:600; }
.aap-new-files { margin:0; padding:0; list-style:none; display:grid; gap:8px; }
.aap-new-file { display:flex; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid #e3e3e3; padding:8px 0; }
.aap-new-file-copy { flex:1; min-width:0; }
.aap-new-progress { width:100%; height:18px; accent-color:#005ea8; }
.aap-new-status { color:#444; }
@media(max-width:600px) {
 .aap-new-root { padding:24px 16px 96px; }
 .aap-new-sheet { padding:16px; }
 .aap-new-drop { padding:20px 12px; }
 .aap-new-kv { display:block; }
 .aap-new-kv dd { text-align:left; margin-top:4px; }
 .aap-new-actions > .aap-new-button { flex:1 1 auto; }
}`;
    wrapper.append(style);
    const back = node('a', 'link aap-new-back', '← Orders');
    back.href = '#orders';
    const title = node('h1', 'title', 'New order');
    const intro = node('p', 'intro', 'Charges, total, payment due and ready date show before you start.');
    const form = node('form', 'sheet');
    form.setAttribute('aria-label', 'New order');
    form.noValidate = true;   // Start order checks the date itself (one plain line under it), then reportValidity() as before
    const fields = node('fieldset', 'fieldset');
    const drop = node('div', 'drop');
    drop.append(node('p', null, 'Drop the engagement letter and your TOTAL file here, or choose files'),
      node('p', null, 'Engagement letter, TOTAL file, comps/MLS, market export, contract, photos'));
    const picker = node('input', 'picker');
    picker.type = 'file'; picker.multiple = true;
    picker.setAttribute('aria-label', 'Order files');
    const choose = button('Choose files', true);
    choose.addEventListener('click', () => picker.click());
    drop.append(choose, picker);
    const fileList = node('ul', 'files');
    fileList.setAttribute('aria-label', 'Selected files');
    const againNote = node('p', 'note', 'Your files need choosing again. The rest of your order is as you left it.');
    againNote.hidden = true;
    const fileError = node('p', 'error');
    fileError.setAttribute('role', 'alert'); fileError.hidden = true;
    fields.append(drop, againNote, fileList, fileError);
    function button(text, secondary) {
      const b = node('button', secondary ? 'button aap-new-secondary' : 'button', text);
      b.type = 'button'; return b;
    }
    function addFiles(incoming) {
      if (busy || created || done) return;
      fileError.hidden = true;
      for (const file of incoming) {
        const kept = again.find(entry => entry.name === file.name);
        if (kept) dropAgain(kept);
        const same = files.find(entry => entry.file.name === file.name);
        if (same) {
          if (same.file.size !== file.size || same.file.lastModified !== file.lastModified) {
            fileError.textContent = 'Two files have the name “' + file.name + '”. Rename one before adding it.';
            fileError.hidden = false;
          }
          continue;
        }
        const row = node('li', 'file');
        const copy = node('div', 'file-copy');
        copy.append(node('span', null, file.name));
        const status = node('span', 'status', ' · ' + new Intl.NumberFormat('en-US').format(file.size) + ' bytes · Not sent');
        copy.append(status);
        const progress = node('progress', 'progress');
        progress.max = 100; progress.value = 0; progress.hidden = true;
        progress.setAttribute('aria-label', 'Upload progress for ' + file.name);
        const remove = button('Remove', true);
        remove.setAttribute('aria-label', 'Remove ' + file.name);
        const entry = {file, row, status, progress, remove};
        remove.addEventListener('click', () => {
          if (busy || created || done) return;
          files.splice(files.indexOf(entry), 1); row.remove(); save();
        });
        row.append(copy, remove, progress); fileList.append(row); files.push(entry);
      }
      save();
    }
    function addAgain(name, size) {
      if (!name || again.some(entry => entry.name === name)) return;
      const row = node('li', 'file');
      const copy = node('div', 'file-copy');
      copy.append(node('span', null, name), node('span', 'status', ' · Choose it again'));
      const remove = button('Remove', true);
      remove.setAttribute('aria-label', 'Remove ' + name);
      const entry = {name, size, row};
      remove.addEventListener('click', () => { if (!busy && !created && !done) { dropAgain(entry); save(); } });
      row.append(copy, remove); fileList.append(row); again.push(entry);
    }
    function dropAgain(entry) {
      again.splice(again.indexOf(entry), 1); entry.row.remove();
      againNote.hidden = !again.length;
    }
    picker.addEventListener('change', () => { addFiles(Array.from(picker.files)); picker.value = ''; });
    drop.addEventListener('dragover', event => {
      event.preventDefault(); if (!busy && !created && !done) drop.classList.add('aap-new-drag');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('aap-new-drag'));
    drop.addEventListener('drop', event => {
      event.preventDefault(); drop.classList.remove('aap-new-drag');
      addFiles(Array.from(event.dataTransfer.files));
    });
    const addonInputs = {}, laneInputs = {};
    function options(title, list, isLane) {
      const group = node('fieldset', 'fieldset');
      group.append(node('legend', 'legend', title));
      list.forEach((item, index) => {
        const label = node('label', 'option');
        const input = node('input', 'choice');
        input.type = isLane ? 'radio' : 'checkbox';
        input.name = id + (isLane ? 'lane' : 'addons'); input.value = item.id;
        input.checked = isLane && index === 0;
        if (isLane) laneInputs[item.id] = {input, item}; else addonInputs[item.id] = input;
        const copy = node('span', 'option-copy', item.label);
        if (item.note) copy.append(node('span', 'note', item.note));
        label.append(input, copy, node('b', 'price', (isLane ? '' : '+') + money(item.price_cents)));
        input.addEventListener('change', () => {
          if (isLane) { selected = item; fitNeedBy(); }
          else if (input.checked) chosen.add(item.id);
          else chosen.delete(item.id);
          waiting = false; update(); save();
        });
        group.append(label);
      });
      return group;
    }
    fields.append(options('Service', lanes, true));
    if (addons.length) fields.append(options('Add-ons', addons, false));
    function field(label, tag, type) {
      const el = node('label', 'field', label);
      const input = node(tag, 'input');
      if (type) input.type = type;
      el.append(input); fields.append(el); return input;
    }
    const due = field('When do you need it from us? (required)', 'input', 'date');
    due.min = isoDay(businessDate(0)); due.setAttribute('aria-required', 'true');
    // Matt 11-14: the date is required. Start order without one (or with a past one) says so under the date and goes to it.
    const dueNeed = node('p', 'error', 'Pick the date you need it from us.'); dueNeed.id = id + 'due-need'; dueNeed.hidden = true;
    const dueHint = node('p', 'note'); dueHint.hidden = true; due.parentNode.append(dueNeed, dueHint);
    const dueOk = () => /^\d{4}-\d{2}-\d{2}$/.test(due.value) && due.value >= isoDay(businessDate(0));
    function needDate(on) {
      dueNeed.hidden = !on;
      if (on) { due.setAttribute('aria-invalid', 'true'); due.setAttribute('aria-describedby', dueNeed.id); }
      else { due.removeAttribute('aria-invalid'); due.removeAttribute('aria-describedby'); }
    }
    // Matt 11-13: their date from us picks the turn time; Next day only when the standard time misses it.
    function fitNeedBy() {
      dueHint.hidden = true;
      if (!due.value || !selected) return;
      const want = new Date(due.value + 'T12:00:00');
      const standard = businessDate(selected.ready_days);
      const box = addonInputs['next-day'];
      if (box) {
        const fast = businessDate(Math.min(1, Number(selected.ready_days) || 1));
        const need = standard > want && fast < standard;   // only when Next day actually gets it there sooner
        if (box.checked !== need) { box.checked = need; if (need) chosen.add('next-day'); else chosen.delete('next-day'); }
      }
      const earliest = businessDate(box && box.checked ? Math.min(1, Number(selected.ready_days) || 1) : selected.ready_days);
      if (earliest > want) { dueHint.textContent = 'Our earliest is ' + dateText(earliest) + '. Add a note and the desk will reach out.'; dueHint.hidden = false; }
      else if (box && box.checked) { dueHint.textContent = 'Next day added to meet your date.'; dueHint.hidden = false; }
    }
    due.addEventListener('change', () => { if (dueOk()) needDate(false); fitNeedBy(); waiting = false; update(); save(); });
    const notes = field('Notes', 'textarea'); notes.rows = 3;
    notes.placeholder = 'Anything the desk should know';
    notes.addEventListener('input', save);
    const summary = node('dl', 'summary');
    function fact(label, total) {
      const row = node('div', total ? 'kv aap-new-total' : 'kv');
      const value = node('dd'); row.append(node('dt', null, label), value); summary.append(row); return value;
    }
    const charges = fact('Selected charges');
    const detail = node('ul', 'detail'); charges.append(detail);
    const fees = fact('Payment fee');
    const total = fact('Total', true);
    const paymentDue = fact('Payment due');
    const ready = fact('Ready for your review');
    const usage = node('p'); usage.hidden = !plan;
    const warning = node('div', 'warning'); warning.tabIndex = -1;
    warning.setAttribute('role', 'region'); warning.setAttribute('aria-label', 'Weekly usage warning');
    warning.append(node('p', null, "If you start this order, you'll likely run out of this week's usage while it's in progress. Finishing it will cost an extra $50, and new orders will wait until you refill or the week resets."));
    const warningActions = node('div', 'actions');
    const anyway = button('Start anyway');
    const wait = button('Wait', true);
    warningActions.append(anyway, wait); warning.append(warningActions);
    const status = node('p', 'status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = node('p', 'error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const receipt = node('p', 'receipt'); receipt.hidden = true; receipt.setAttribute('role', 'status');
    const actions = node('div', 'actions');
    const start = button('Start order'); start.type = 'submit'; actions.append(start);
    const over = button('Start over', true);
    over.hidden = typeof ctx.startOver !== 'function';
    over.addEventListener('click', () => { if (!busy && !done) ctx.startOver(); });
    actions.append(over);
    form.append(fields, summary, usage, warning, status, error, receipt, actions);
    wrapper.append(back, title, intro, form); root.replaceChildren(wrapper);

    function runsOut() {
      return !!plan && Number(plan.pct) + Number(plan.order_share_pct) >= 100;
    }
    function update() {
      const items = selected ? [selected].concat(addons.filter(item => chosen.has(item.id))) : [];
      const cents = items.reduce((sum, item) => sum + Number(item.price_cents), 0);
      const cardPct = Number(payment.card_fee_pct) || 0;
      const cardFee = Math.round(cents * cardPct / 100);
      // ach_fee is in cents, like the prices (currently 0).
      const achFee = Math.round(Number(payment.ach_fee) || 0);
      detail.replaceChildren(...items.map(item => node('li', null, item.label + ': ' + money(item.price_cents))),
        node('li', null, money(cents)));
      fees.textContent = 'ACH ' + money(achFee) + ' / card +' + cardPct + '% (' + money(cardFee) + ')';
      total.textContent = money(cents + achFee) + ' by ACH / ' + money(cents + cardFee) + ' by card';
      // Next day: ready in 1 business day, whatever the lane's own days.
      const days = selected ? (chosen.has('next-day') ? Math.min(1, Number(selected.ready_days) || 1) : selected.ready_days) : 0;
      const readyDate = businessDate(days);
      ready.textContent = selected ? dateText(readyDate) : 'Choose a service';
      const net = /^invoice Fridays, net (\d+)$/.exec(String(payment.due || ''));
      if (net) {
        const invoice = new Date(readyDate);
        invoice.setDate(invoice.getDate() + (5 - invoice.getDay() + 7) % 7);
        const payDate = new Date(invoice); payDate.setDate(payDate.getDate() + Number(net[1]));
        paymentDue.textContent = 'Invoice ' + dateText(invoice) + ' · Due ' + dateText(payDate) + ' (net ' + Number(net[1]) + ')';
      } else {
        paymentDue.textContent = 'On delivery, ' + dateText(readyDate);
      }
      if (plan) usage.textContent = 'This order will use about ' + plan.order_share_pct + '% of your week. ' +
        plan.pct + '% used. Resets ' + plan.resets + '.';
      warning.hidden = !selected || !runsOut() || waiting || !!created || done;
      actions.hidden = !warning.hidden || done;
      start.disabled = !selected || busy || done;
      over.disabled = busy || done;
      if (!selected) {
        status.textContent = 'No services are on file for your office. Contact the desk before starting an order.';
      }
    }
    wait.addEventListener('click', () => {
      if (busy || done) return;
      waiting = true; update(); status.textContent = 'Order not started. You can wait until you refill or the week resets.';
      start.focus();
    });
    anyway.addEventListener('click', () => submit(true));
    form.addEventListener('submit', event => { event.preventDefault(); submit(false); });

    async function submit(accepted) {
      if (busy || done || !selected || !alive) return;
      if (!created && !dueOk()) { needDate(true); due.focus(); return; }
      if (!form.reportValidity()) return;
      if (again.length) {
        error.textContent = 'Choose these files again, or remove them: ' + again.map(entry => entry.name).join(', ') + '.';
        error.hidden = false; return;
      }
      if (!created && runsOut() && !accepted) {
        waiting = false; update(); warning.focus(); return;
      }
      busy = true; fields.disabled = true; start.disabled = true; over.disabled = true; anyway.disabled = true; wait.disabled = true;
      error.hidden = true; status.textContent = created ? 'Retrying files…' : 'Sending…';
      try {
        if (!created) {
          const response = await ctx.createOrder({
            lane: selected.id, addons: Array.from(chosen), notes: notes.value,
            client_due: due.value ? 'needed from us by ' + due.value : '', files: files.map(({file}) => ({name: file.name, size: file.size, type: file.type}))
          });
          if (!response || response.ok !== true) throw new Error(response && response.error || 'The order could not be received. Try again.');
          // Keep a successful request even if its upload sessions are incomplete: never create a duplicate on retry.
          created = response;
        }
        if (!created.request_id) throw new Error('The desk did not return an order number. Contact the desk before trying again.');
        const sessions = Array.isArray(created.uploads) ? created.uploads : [];
        for (const entry of files) {
          if (completed.has(entry)) continue;
          const matches = sessions.filter(session => session.name === entry.file.name);
          if (matches.length !== 1 || typeof matches[0].url !== 'string' || !matches[0].url) {
            throw new Error('No upload session was returned for “' + entry.file.name + '”. Contact the desk; your order is already recorded.');
          }
          if (alive) {
            status.textContent = 'Sending files…'; entry.remove.hidden = true;
            entry.progress.hidden = false; entry.progress.removeAttribute('value'); entry.status.textContent = ' · Sending…';
          }
          const result = await ctx.uploadFile(matches[0].url, entry.file, progress => {
            if (!alive || completed.has(entry)) return;
            const pct = typeof progress === 'number' ? progress : progress &&
              (progress.total > 0 ? progress.loaded / progress.total * 100 : progress.percent);
            if (Number.isFinite(pct)) {
              entry.progress.value = Math.min(100, Math.max(0, pct));
              entry.status.textContent = ' · ' + Math.round(entry.progress.value) + '%';
            }
          });
          if (!result || result.ok !== true) {
            if (alive) entry.status.textContent = ' · Not sent · Retry files';
            throw new Error(result && result.error || 'A file could not be sent. Retry files to finish this order.');
          }
          completed.add(entry);
          if (alive) { entry.progress.value = 100; entry.status.textContent = ' · Sent'; }
        }
        done = true;
        if (alive) {
          warning.hidden = true; actions.hidden = true; status.textContent = '';
          receipt.textContent = 'Order received. Your desk will confirm within a few minutes.';
          receipt.hidden = false;
          // A navigation callback failure must not turn a received order into a failed submission.
          try { if (typeof ctx.afterCreate === 'function') await ctx.afterCreate(created.request_id); }
          catch (_) { status.textContent = 'Open Orders to see your request when the desk opens it.'; }
        }
      } catch (failure) {
        if (alive) {
          status.textContent = '';
          error.textContent = failure && failure.message || 'The order could not be sent. Try again.';
          error.hidden = false;
          if (created) { warning.hidden = true; actions.hidden = false; start.textContent = 'Retry files'; }
        }
      } finally {
        busy = false;
        if (alive) {
          fields.disabled = !!created || done; start.disabled = done; over.disabled = done;
          anyway.disabled = done; wait.disabled = done;
        }
      }
    }
    function save() {
      if (done || !alive || typeof ctx.saveDraft !== 'function') return;
      const names = files.map(({file}) => ({name: file.name, size: file.size})).concat(again.map(({name, size}) => ({name, size})));
      try {
        ctx.saveDraft({lane: selected ? selected.id : '', addons: Array.from(chosen), due: due.value, notes: notes.value, files: names});
      } catch (_) { /* the form still works without a kept draft */ }
    }
    if (draft) {
      const lane = laneInputs[draft.lane];
      if (lane) { lane.input.checked = true; selected = lane.item; }
      for (const addon of Array.isArray(draft.addons) ? draft.addons : []) {
        if (addonInputs[addon]) { addonInputs[addon].checked = true; chosen.add(addon); }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(draft.due || '')) due.value = draft.due;
      if (typeof draft.notes === 'string') notes.value = draft.notes;
      fitNeedBy();
      for (const file of Array.isArray(draft.files) ? draft.files.slice(0, 30) : []) {
        if (file && typeof file.name === 'string') addAgain(file.name, Number(file.size) || 0);
      }
      againNote.hidden = !again.length;
    }
    update();
    const instance = {unmount() { alive = false; wrapper.remove(); }};
    current = instance;
    return instance;
  }
  function unmount() {
    if (current) current.unmount();
    current = null;
  }
  window.AAPNewOrder = {mount, unmount};
})();
