/* Shared durable WebSocket client. No Google calls, credentials in URLs, or HTML rendering. */
(function () {
  "use strict";
  window.AAPChatClient = function (options) {
    const key = "aap-chat-v1|" + options.conversation_id;
    const storage = options.storage || localStorage;
    let saved = storage.getItem(key);
    let state = saved ? JSON.parse(saved) : { sequence: 0, outbox: [], messages: [], draft: "" };
    let socket, timer, watchdog, stopped = false, ready = false, connected = false, retry = 0;
    let status = options.surface === "form"
      ? "Connecting your A&AP report agent, with your report's full context."
      : "Connecting your A&AP agent, who knows your office.";
    const endpoint = new URL(options.endpoint || "wss://aap-chat.southcentralus.cloudapp.azure.com/v1/chat");
    if (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)))
      throw new Error("A secure chat connection is required.");
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Invalid chat address.");
    function answering() { return state.messages.some(m => m.who === "you" && !state.messages.some(r => r.re === m.id && !r.pending)); }
    function persist() { storage.setItem(key, JSON.stringify(state)); }
    function view() { return { status, ready, sequence: state.sequence, outbox: state.outbox.slice(), messages: state.messages.slice(), draft: state.draft }; }
    function notify() { if (options.onchange) options.onchange(view()); }
    function wire(frame) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(frame)); }
    function flush() { if (ready) state.outbox.forEach(item => wire({ type: "send", ...item })); }
    function reconnect() {
      if (stopped) return;
      ready = false; status = "Reconnecting..."; notify();
      clearTimeout(timer); clearTimeout(watchdog);
      timer = setTimeout(connect, Math.min(1500, 200 * 2 ** Math.min(retry++, 3)) + Math.random() * 100);
    }
    function connect() {
      if (stopped) return;
      const current = socket = new WebSocket(endpoint.href);
      watchdog = setTimeout(() => current.close(), 4500);
      current.onopen = function () {
        wire({ type: "authenticate", grant: options.grant, conversation_id: options.conversation_id });
        wire({ type: "resume", last_sequence: state.sequence });
      };
      current.onmessage = function (event) {
        if (current !== socket || stopped) return;
        const before = JSON.stringify(state);
        try {
          const f = JSON.parse(event.data);
          if (f.type === "error") {
            if (["expired_grant", "wrong_scope", "unauthorized", "context_changed"].includes(f.code)) {
              stopped = true; ready = false; status = "Connection needs refreshing. Your messages are kept.";
              clearTimeout(watchdog); current.close(); notify(); return;
            }
            current.close(); return;
          }
          if (f.type === "ready") {
            clearTimeout(watchdog); retry = 0; connected = ready = true;
            status = answering() ? "Typing..." : "Connected.";
            flush(); notify(); return;
          }
          if (!["received", "typing", "text", "completed"].includes(f.type)) return;
          if (!Number.isSafeInteger(f.sequence) || f.sequence < 1) throw new Error("Invalid sequence");
          if (f.sequence <= state.sequence) return;
          if (f.sequence !== state.sequence + 1) { current.close(); return; }
          if (f.type === "received") {
            state.outbox = state.outbox.filter(m => m.id !== f.id);
            const ask = state.messages.find(m => m.id === f.id && m.who === "you");
            if (ask) ask.pending = false;
            status = "Typing...";
          } else if (f.type === "typing") status = "Typing...";
          else {
            if (!f.reply_id || !f.re || typeof f.text !== "string") throw new Error("Invalid text");
            let reply = state.messages.find(m => m.id === f.reply_id);
            if (reply && (reply.re !== f.re || !f.text.startsWith(reply.text) || !reply.pending && (f.type !== "completed" || f.text !== reply.text))) throw new Error("Changed prefix");
            if (!reply) {
              const ask = state.messages.find(m => m.id === f.re && m.who === "you");
              reply = { id: f.reply_id, re: f.re, who: "agent", text: "", order: ask ? ask.order : options.order || null };
              state.messages.push(reply);
            }
            reply.text = f.text; reply.pending = f.type !== "completed";
            if (f.type === "completed" && f.handoff === true) reply.handoff = true;
            status = answering() ? "Typing..." : "Connected.";
          }
          state.sequence = f.sequence;
          persist(); notify();
        } catch (_) {
          // A failed local commit must replay from the last durable sequence.
          state = JSON.parse(before);
          current.close();
        }
      };
      current.onerror = () => current.close();
      current.onclose = function () { if (current === socket) reconnect(); };
    }
    const api = {
      view,
      regrant(grant) { options.grant = grant; if (socket && socket.readyState === 1) wire({ type: "authenticate", grant, conversation_id: options.conversation_id }); },
      draft(text) { const old = state.draft; state.draft = String(text); try { persist(); } catch (e) { state.draft = old; throw e; } },
      send(text, order, context) {
        text = String(text || "").trim();
        if (!text || text.length > 3000) throw new Error("Please enter a message up to 3000 characters.");
        if (stopped) throw new Error("Refresh the page to reconnect. Your draft is kept.");
        const item = { id: "q_fb_" + crypto.randomUUID().replaceAll("-", ""), text, order: order || null, context: context || null };
        const before = JSON.stringify(state);
        state.outbox.push(item);
        state.messages.push({ id: item.id, who: "you", text, order: item.order, pending: true });
        state.draft = "";
        try { persist(); } catch (e) { state = JSON.parse(before); throw new Error("Could not save your message in this browser. Your draft is kept."); }
        if (ready) { status = "Sending..."; wire({ type: "send", ...item }); }
        notify(); return item.id;
      },
      disconnect() { stopped = true; ready = false; clearTimeout(timer); clearTimeout(watchdog); if (socket) socket.close(); },
      reconnect() { if (socket) socket.close(); },
      get connected() { return connected; }
    };
    notify(); connect(); return api;
  };
})();

(function () {
  "use strict";
  if (window.AAPAgent) return;

  const PLACEHOLDER = "Message your Desk Agent";
  const LABEL = "Desk Agent";
  const HOST_LABEL = "Report Agent";
  const GREETING = "Desk Agent, an AI: orders, dates, pricing.";
  const ASK = "Ask about this report…";
  const SUB = "AI agent · orders, ready dates, pricing · replies in seconds";
  const HOST_SUB = "AI agent · did your report · replies in seconds";
  const HAND_EMAIL = "Email me the answer too";
  const HAND_EMAIL_TEXT = "Please email me the answer too.";
  const HAND_EMAILED = "We'll email it to you too.";
  let seenKey = "aap-agent-seen-";
  try { seenKey += new URLSearchParams(window.location.search).get("t") || ""; } catch (_) {   }
  const conversations = new Map();
  const drafts = new Map();
  const draftKey = seenKey.replace("aap-agent-seen-", "aap-agent-draft-") + "|";   // per link and order; survives a reload
  const handKey = seenKey.replace("aap-agent-seen-", "aap-agent-handoff-") + "|";   // per link, order and question
  const handChoices = new Map();
  const handBusy = new Set();
  let data = { route: "home", order: null, needs: [], orders: [], thread: [], plan: null, profile: false };
  let config = null;
  let ui = null;
  let recognition = null;
  let listening = false;
  let speechScope = null;
  let speechDraft = "";
  let opened = false;
  let mountedScope = null;
  let seenMemory = null;
  let opener = null;
  let promptId = null;
  let live = null;
  let nudged = false;
  let chat = null;
  let chatView = null;

  function element(tag, name, text) {
    const el = document.createElement(tag);
    el.className = "aap-agent-" + name;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svg(viewBox, paths, name) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("class", "aap-agent-" + name);
    el.setAttribute("viewBox", viewBox);
    el.setAttribute("aria-hidden", "true");
    paths.forEach(function (attrs) {
      const path = document.createElementNS(el.namespaceURI, "path");
      Object.keys(attrs).forEach(key => path.setAttribute(key, attrs[key]));
      el.append(path);
    });
    return el;
  }

  function mark() {
    return svg("0 0 354 208", [
      { fill: "#e8eae6", d: "M133.28 9H148Q158.32 9 165.5 21L272.54 200H211.88L176 140V104.5L135.5 64V95L82 140V178L67.58 200H8.06Z" },
      { fill: "#e8eae6", d: "M174.12 12H279A66.5 66.5 0 0 1 279 145H253.65L229.43 104.5L276 105A26.5 26.5 0 0 0 276 52H198.04Z" },
      { fill: "#96aac4", d: "M92 200V145.3L112 128.48V200ZM118.5 200V123.01L138.5 106.19V200ZM145 200V88.35L165 108.35V200Z" }
    ], "mark");
  }

  function setDraft(order, text) {
    if (chat) chat.draft(text);
    drafts.set(order, text);
    try { if (text) localStorage.setItem(draftKey + (order || ""), text); else localStorage.removeItem(draftKey + (order || "")); } catch (_) {   }
  }

  function getDraft(order) {
    if (chat) return chat.view().draft;
    if (drafts.has(order)) return drafts.get(order) || "";
    try { return localStorage.getItem(draftKey + (order || "")) || ""; } catch (_) { return ""; }
  }

  function grow() {   // the message box grows with its text, up to 4 lines, then scrolls
    if (!ui) return;
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + "px";
  }

  function placeholder() { return config && config.host ? ASK : PLACEHOLDER; }
  function label() { return config && config.host ? HOST_LABEL : LABEL; }

  function avatar(name) {
    const el = element("span", name);
    el.append(mark());
    return el;
  }

  function short(text) {
    const words = String(text || "").trim().split(/\s+/);
    return words.length > 12 ? words.slice(0, 12).join(" ").replace(/[,;:.]$/, "") + "…" : words.join(" ");
  }

  function thread() { return data.thread.concat(chatView ? chatView.messages : []); }

  function you() { return thread().some(message => message.who === "you" && !message.history && sameScope(message, scope())); }   // this visit; a restored history line does not count

  function scope() {
    return data.route === "order" && data.order ? data.order : null;
  }

  function sameScope(message, order) {
    return (message.order || null) === order;
  }

  function selectedOrder() {
    return data.orders.find(order => order.ap === scope());
  }

  function recover(order, request) {
    if (!request || request.status !== "failed" || !request.id) return;
    const mine = data.thread.find(message => message.who === "you" && message.id === request.id);
    if (!mine || mine.pending) return;
    request.status = "sent";
    if (getDraft(order).trim() === request.text) setDraft(order, "");
    if (ui && scope() === order && ui.input.value.trim() === request.text) ui.input.value = "";
  }

  function renderContext() {
    const order = selectedOrder();
    ui.context.replaceChildren();
    if (scope()) ui.context.textContent = (order && order.street ? order.street + " · " : "") + scope() +
      (order && order.status ? " · " + order.status : "");
    else {
      const count = new Set(data.needs.map(need => need.ap).filter(Boolean)).size;
      if (count) {
        const view = element("button", "view", "View");
        view.type = "button";
        view.addEventListener("click", viewNeeds);
        ui.context.append(count + (count === 1 ? " order needs you · " : " orders need you · "), view);
      }
    }
    ui.context.classList.toggle("aap-agent-property", Boolean(scope()));
    ui.context.hidden = !ui.context.childNodes.length;
  }

  function viewNeeds() {
    open(false);
    if (data.route !== "home") { window.location.hash = "#home"; return; }
    const needs = document.getElementById("needs");
    if (needs) needs.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function renderConversation() {
    const request = conversations.get(scope());
    const sending = !chat && Boolean(request && request.status === "sending");
    ui.input.disabled = sending;
    ui.send.disabled = sending || !ui.input.value.trim();
    grow();
    ui.send.setAttribute("aria-label", sending ? "Sending" : "Send");
    ui.mic.disabled = sending;
    ui.form.setAttribute("aria-busy", String(sending));
    let status = "";
    if (request) {
      if (sending) status = "Sending…";
      else if (request.status === "failed") status = request.error;
    }
    ui.status.textContent = status;
    ui.status.hidden = !status;
    ui.status.classList.toggle("aap-agent-error", Boolean(request && request.status === "failed"));
  }

  function renderThread() {
    const streamed = chatView ? chatView.messages : [];
    const ids = new Set(streamed.flatMap(m => [m.id, "h-" + m.id]));
    const lines = data.thread.filter(m => !ids.has(m.id || m.key) && !streamed.some(s => s.re && s.re === m.re && m.who === "agent"))
      .concat(streamed).filter(message => sameScope(message, scope()));
    const atEnd = ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 48, keep = new Set(), hand = handoff(lines);
    lines.forEach(function (message, i) {
      const key = String(message.key || message.id || i), you = message.who === "you";
      const who = you ? "You" : !config.host ? LABEL : message.who === "desk" ? "Desk" : HOST_LABEL;
      const first = !you && (i === 0 || lines[i - 1].who === "you"), typing = Boolean(message.pending && message.typing);
      const note = typeof message.note === "string" ? message.note : "", held = hand && hand.i === i ? hand.state : "";
      const text = String(message.text || ""), shape = [who, text, Boolean(message.pending), first, typing, note, held].join("\n");
      let line = ui.lines.get(key);
      if (!line || line.dataset.shape !== shape) {
        const focus = line && line.contains(document.activeElement) ? document.activeElement.textContent : null;
        const next = element("li", you ? "you" : "says");
        if (message.pending) next.classList.add("aap-agent-pending");
        if (first) next.classList.add("aap-agent-first");
        const name = element("b", "who", who);
        if (who === "Desk") name.classList.add("aap-agent-human");
        if (typing) {
          const dots = element("p", "words aap-agent-typing");
          dots.setAttribute("role", "img");
          dots.setAttribute("aria-label", label() + " is typing");
          dots.append(element("span", "dot"), element("span", "dot"), element("span", "dot"));
          next.append(name, dots);
        } else next.append(name, element("p", "words", text));
        if (note) next.append(element("p", "note", note));   // e.g. "Sent": his message is saved, no reply yet
        if (held) next.append(handRow(hand));
        if (first) next.prepend(avatar("bubble-avatar"));
        next.dataset.shape = shape;
        if (line) line.replaceWith(next);
        line = next;
        ui.lines.set(key, line);
        if (focus !== null) {
          const to = Array.from(next.querySelectorAll("button")).find(b => b.textContent === focus) || next.querySelector("[tabindex]");
          if (to) to.focus({ preventScroll: true });
        }
      }
      keep.add(key);
      if (ui.thread.children[i] !== line) ui.thread.insertBefore(line, ui.thread.children[i] || null);
    });
    ui.lines.forEach(function (line, key) { if (!keep.has(key)) { line.remove(); ui.lines.delete(key); } });
    ui.thread.hidden = !lines.length;
    if (atEnd || lines.length !== ui.threadCount) ui.body.scrollTop = ui.body.scrollHeight;
    ui.threadCount = lines.length;
  }

  function handoff(lines) {   // the newest hand-off in scope, while no desk answer to it follows
    const flagged = new Set(data.thread.filter(m => m.handoff && m.re).map(m => m.re));
    const handed = m => !m.pending && m.who !== "you" && Boolean(m.handoff || m.who === "agent" && m.re && flagged.has(m.re));
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i];
      if (!handed(m)) continue;
      if (lines.some((r, j) => r.who === "desk" && !r.pending && !handed(r) && (m.re && r.re ? r.re === m.re : j > i))) return null;
      const k = handKey + (m.order || "") + "|" + (m.re || m.id || m.key || m.at || "");
      return { i, k, order: m.order || null, state: handBusy.has(k) ? "busy" : handPick(k) || "ask" };
    }
    return null;
  }

  function handPick(k, value) {
    if (value) {
      handChoices.set(k, value);
      try { localStorage.setItem(k, value); } catch (_) {   }
      return value;
    }
    if (handChoices.has(k)) return handChoices.get(k);
    try { const stored = localStorage.getItem(k); return stored === "wait" || stored === "email" ? stored : ""; } catch (_) { return ""; }
  }

  function handRow(hand) {
    if (hand.state === "wait" || hand.state === "email") {
      if (hand.state === "wait") return element("span", "handdone");
      const done = element("p", "note", HAND_EMAILED);
      done.tabIndex = -1;
      return done;
    }
    const row = element("div", "hand");   // waiting here is the default; one light link offers email too
    const button = element("button", "handlink", HAND_EMAIL);
    button.type = "button";
    if (hand.state === "busy") button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", () => handEmail(hand));
    row.append(button);
    return row;
  }

  async function handEmail(hand) {   // one ordinary message, through the same send path as the message box
    if (handBusy.has(hand.k) || handPick(hand.k)) return;
    const order = hand.order, text = HAND_EMAIL_TEXT;
    if (chat) {
      try { chat.send(text, order, config.chatContext ? config.chatContext() : null); handPick(hand.k, "email"); ui.speech.textContent = ""; }
      catch (e) { ui.speech.textContent = e.message; }
      render(); return;
    }
    const previous = conversations.get(order);
    if ((previous || {}).status === "sending") return;
    const retry = previous && previous.status === "failed" && previous.id && previous.text === text ? previous.id : null;
    const request = { text: text, status: "sending", id: retry };
    conversations.set(order, request);
    handBusy.add(hand.k);
    render();
    try {
      const result = await config.send(retry ? { order: order, text: text, id: retry } : { order: order, text: text });
      if (result && typeof result.id === "string" && result.id) request.id = result.id;
      if (!result || result.ok !== true) throw new Error(result && result.error || "Please try again.");
      request.status = "sent";
      handPick(hand.k, "email");
    } catch (error) {
      request.status = "failed";
      request.error = "Could not send. " + (error && error.message || "Please try again.");
    }
    handBusy.delete(hand.k);
    render();
  }

  function renderPrompt() {
    const prompt = data.prompt && typeof data.prompt === "object" ? data.prompt : null;
    const id = prompt ? String(prompt.id || "") : null;
    if (id !== promptId) {
      promptId = id;
      ui.answerBox.replaceChildren();
      ui.answerInput = null;
      const input = prompt && prompt.input;
      if (input) {
        const area = element("textarea", "answer-input");
        area.rows = 2;
        area.maxLength = 3000;
        area.placeholder = input.placeholder || "";
        area.setAttribute("aria-label", input.placeholder || "Your answer");
        area.value = input.value || "";
        const save = element("button", "save", input.save || "Save");
        save.type = "button";
        const wrap = element("div", "answer-field");
        wrap.append(area);
        ui.answerBox.append(wrap);
        const talk = typeof config.talk === "function" ? config.talk(area) : null;
        if (talk) ui.answerBox.append(talk);
        ui.answerBox.append(save);
        area.addEventListener("input", function () { save.disabled = !area.value.trim() || Boolean((data.prompt || {}).input && data.prompt.input.disabled); });
        const item = { key: input.key, version: input.version };
        save.addEventListener("click", function () { if (!save.disabled && area.value.trim()) config.save(area.value, item); });
        ui.answerInput = { area: area, save: save };
      }
    }
    ui.promptText.textContent = prompt && prompt.text ? prompt.text : "";
    ui.promptText.hidden = !ui.promptText.textContent;
    ui.kicker.textContent = prompt && prompt.kicker ? prompt.kicker : "";
    ui.kicker.hidden = !ui.kicker.textContent;
    const body = prompt && prompt.body ? String(prompt.body) : "", cut = short(body);
    if (ui.cardBody.dataset.full !== body) {
      ui.cardBody.dataset.full = body;
      ui.cardText.textContent = cut;
      ui.more.hidden = cut === body.trim().split(/\s+/).join(" ");
    }
    ui.cardBody.hidden = !body;
    ui.prompt.dataset.tone = prompt && prompt.tone ? prompt.tone : "";
    if (ui.answerInput) {
      const off = Boolean(prompt.input && prompt.input.disabled);
      ui.answerInput.area.disabled = off;
      ui.answerInput.save.disabled = off || !ui.answerInput.area.value.trim();
    }
    ui.answerBox.hidden = !ui.answerInput;
    const chips = prompt && Array.isArray(prompt.chips) ? prompt.chips : [];
    const chipShape = JSON.stringify([promptId, chips.map(c => [c.label, c.key, c.value, c.version, Boolean(c.disabled), Boolean(c.pressed)])]);
    if (chipShape !== ui.chipShape) {
      const focused = ui.chips.contains(document.activeElement) ? document.activeElement.textContent : null;
      ui.chipShape = chipShape;
      ui.chips.replaceChildren();
      chips.forEach(function (chip) {
        const button = element("button", "chip", String(chip.label || ""));
        button.type = "button";
        button.disabled = Boolean(chip.disabled);
        if (chip.pressed) button.setAttribute("aria-pressed", "true");
        button.addEventListener("click", function () {
          if (button.disabled) return;
          if (chip.key === "ask") { ui.input.focus(); return; }
          config.choose(chip);
        });
        ui.chips.append(button);
        if (focused !== null && button.textContent === focused && !button.disabled) button.focus({ preventScroll: true });
      });
    }
    ui.chips.hidden = !ui.chips.childElementCount;
    const page = prompt && prompt.button && prompt.button.el ? prompt.button : null;
    const pageShape = page ? [String(page.label || page.el.textContent || "").trim(), Boolean(page.disabled), page.review, page.action].join("\n") : "";
    if (pageShape !== ui.pageShape || (page && ui.pageEl !== page.el)) {
      const had = ui.action.contains(document.activeElement);
      ui.pageShape = pageShape;
      ui.pageEl = page ? page.el : null;
      ui.action.replaceChildren();
      if (page) {
        const button = element("button", "page-button", String(page.label || page.el.textContent || "").trim());
        button.type = "button";
        button.disabled = Boolean(page.disabled);
        const shown = { review: page.review, action: page.action };
        const el = page.el;
        button.addEventListener("click", function () { if (!button.disabled) config.tap(el, shown); });
        ui.action.append(button);
        if (had && !button.disabled) button.focus({ preventScroll: true });
      }
    }
    ui.action.hidden = !ui.action.childElementCount;
    ui.prompt.hidden = ui.starters.childElementCount > 0 || ui.promptText.hidden && ui.cardBody.hidden && ui.answerBox.hidden && ui.chips.hidden && ui.action.hidden;
  }

  function renderStarters() {
    const list = !you() && Array.isArray(data.starters) ? data.starters.filter(s => s && s.label) : [];
    const shape = JSON.stringify(list.map(s => [s.label, s.key]));
    if (shape !== ui.starterShape) {
      ui.starterShape = shape;
      ui.starters.replaceChildren();
      list.forEach(function (starter) {
        const button = element("button", "chip", String(starter.label));
        button.type = "button";
        button.addEventListener("click", function () {
          if (starter.key && config.choose) { config.choose({ label: starter.label, key: starter.key }); return; }
          ui.input.value = String(starter.label);
          ui.form.requestSubmit();
        });
        ui.starters.append(button);
      });
    }
    ui.starters.hidden = !ui.starters.childElementCount;
  }

  function renderLive() {
    if (chatView) {
      const quiet = !chatView.status || chatView.status === "Connected.";   // only say something when it matters
      ui.sub.textContent = quiet ? (config.host ? HOST_SUB : SUB) : chatView.status;
      ui.sys.textContent = quiet ? "" : chatView.status;
      ui.sys.hidden = quiet; ui.bar.hidden = true; return;
    }
    const state = live && live.state, eta = live && live.eta || 60, late = state === "connecting" && Date.now() - live.at > 2 * eta * 1000;
    const progress = data.prompt && data.prompt.progress && !ui.prompt.hidden ? "AI agent · " + data.prompt.progress : "";
    ui.sub.textContent = late ? "Taking longer · replies also by email"
      : state === "connecting" ? "Connecting your agent · about " + (eta < 90 ? "1 minute" : Math.round(eta / 60) + " minutes")
      : state === "live" ? "Live · your agent is here" : progress || (config.host ? HOST_SUB : SUB);
    ui.bar.hidden = state !== "connecting" || late;
    ui.bar.style.setProperty("--aap-agent-eta", eta + "s");
    ui.sys.textContent = late ? "Taking longer. Message sent; replies also by email."
      : state === "connecting" ? "Agent joining. Keep typing; your message is kept." : state === "live" ? "Your agent joined." : "";
    ui.sys.hidden = !ui.sys.textContent;
  }

  function stopSpeech() {
    const active = recognition;
    recognition = null;
    listening = false;
    if (ui) {
      ui.mic.setAttribute("aria-pressed", "false");
      ui.mic.setAttribute("aria-label", "Speak");
      ui.input.placeholder = placeholder();
    }
    if (active) {
      try { active.abort(); } catch (_) {   }
    }
  }

  function render() {
    if (!ui) return;
    const order = scope();
    if (order !== mountedScope) {
      setDraft(mountedScope, ui.input.value);
      stopSpeech();
      mountedScope = order;
      ui.input.value = getDraft(order);
    }
    const dedicated = !!(data.plan && data.profile), office = String(config.office.name || "").trim();
    const first = String(config.office.person || "").trim().split(/\s+/)[0], hi = first ? "Hi " + first + ". " : "Hi. ";
    if (config.host) {
      ui.title.textContent = HOST_LABEL;
      ui.introText.textContent = hi + "I did this report. Ask me anything about it.";
    } else {
      ui.title.textContent = !dedicated ? "A&AP Desk Agent" : office && office.length <= 20 ? office + " Desk Agent" : "Your Desk Agent";
      const count = new Set(data.needs.map(need => need.ap).filter(Boolean)).size;
      ui.introText.textContent = hi + "Desk Agent here, an AI. " + (count ? count + (count === 1 ? " order needs you." : " orders need you.") : "Ask about any order.");
    }
    ui.intro.hidden = thread().some(message => sameScope(message, scope()));
    renderContext();
    if (config.host || !scope() && !ui.intro.hidden) ui.context.hidden = true;   // the opener already says the count
    renderConversation();
    renderThread();
    renderStarters();
    if (config.host) renderPrompt();
    renderLive();
    unread();
  }

  function seen(value) {
    if (value !== undefined) seenMemory = value;
    try {
      if (value !== undefined) localStorage.setItem(seenKey, String(value));
      else { const stored = localStorage.getItem(seenKey); if (stored !== null) return Number(stored) || 0; }
    } catch (_) {   }
    return seenMemory;
  }

  function unread() {
    const newest = data.thread.reduce(function (most, message) {
      return message.who === "desk" && sameScope(message, scope()) ? Math.max(most, Date.parse(message.at) || 0) : most;
    }, 0);
    if (opened) seen(newest);
    const mark = seen();
    const yes = !opened && newest > 0 && (mark === null || newest > mark);
    document.documentElement.classList.toggle("aap-agent-unread", yes);
    ui.launch.setAttribute("aria-label", "Open the agent chat" + (yes ? ", 1 new reply" : ""));
    document.querySelectorAll(".talk").forEach(function (button) {
      if (yes) button.setAttribute("aria-label", LABEL + ", 1 new reply"); else button.removeAttribute("aria-label");
    });
  }

  function shown(el) { return Boolean(el && el !== document.body && el.isConnected && el.getClientRects().length); }

  function open(yes) {
    if (yes) opener = document.activeElement;
    opened = yes;
    ui.root.classList.toggle("aap-agent-open", yes);
    ui.panel.hidden = !yes;
    ui.launch.setAttribute("aria-expanded", String(yes));
    document.documentElement.classList.toggle("aap-agent-docked", yes && Boolean(config.dock));
    if (!yes) stopSpeech();
    greet(false);
    unread();
    const back = [opener, ui.launch].concat(Array.from(document.querySelectorAll(".talk"))).find(shown);
    if (yes) { ui.body.scrollTop = ui.body.scrollHeight; ui.close.focus({ preventScroll: true }); }
    else if (back) back.focus({ preventScroll: true });
  }

  function greet(yes) {
    if (!yes) {
      if (ui.greeting) ui.greeting.remove();
      ui.greeting = null;
      return;
    }
    const nudge = config.float ? data.nudge : null, key = nudge ? "aap-agent-nudged-" + (data.order || "") : "aap-agent-greeted";
    if (opened || ui.greeting || config.float && !nudge) return;
    try {
      if (!nudge && !window.matchMedia("(max-width:600px)").matches || localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch (_) { return; }
    const bubble = element("div", "greeting");
    bubble.setAttribute("role", "status");
    const dismiss = element("button", "greeting-close", "Close");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => greet(false));
    bubble.append(element("p", "greeting-text", nudge || GREETING), dismiss);
    ui.root.insertBefore(bubble, ui.launch);
    ui.greeting = bubble;
    setTimeout(() => greet(false), nudge ? 10000 : 8000);
    document.addEventListener("pointerdown", () => setTimeout(() => greet(false), 0), { once: true, capture: true });
  }

  async function submit(event) {
    event.preventDefault();
    const order = scope();
    const text = ui.input.value.trim();
    if (chat) {
      if (!text) return;
      stopSpeech();
      try {
        chat.send(text, order, config.chatContext ? config.chatContext() : null);
        ui.input.value = ""; setDraft(order, ""); ui.speech.textContent = "";
      } catch (e) { ui.speech.textContent = e.message; }
      render(); return;
    }
    const previous = conversations.get(order);
    if (!text || (previous || {}).status === "sending") return;
    stopSpeech();
    const retry = previous && previous.status === "failed" && previous.id && previous.text === text ? previous.id : null;
    const request = { text: text, status: "sending", id: retry };
    conversations.set(order, request);
    renderConversation();
    try {
      const result = await config.send(retry ? { order: order, text: text, id: retry } : { order: order, text: text });
      if (result && typeof result.id === "string" && result.id) request.id = result.id;
      if (!result || result.ok !== true) throw new Error(result && result.error || "Please try again.");
      request.status = "sent";
      setDraft(order, "");
      if (scope() === order) ui.input.value = "";
    } catch (error) {
      request.status = "failed";
      request.error = "Could not send. " + (error && error.message || "Please try again.");
      setDraft(order, text);
    }
    render();
  }

  function startSpeech() {
    if (listening) { stopSpeech(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    try {
      const session = new Recognition();
      recognition = session;
      session.lang = document.documentElement.lang || "en-US";
      session.interimResults = false;
      session.continuous = false;
      speechScope = scope();
      speechDraft = ui.input.value;
      session.onresult = function (event) {
        if (recognition !== session || !listening || scope() !== speechScope || !opened) return;
        const words = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(" ");
        if (!words) return;
        ui.input.value = (speechDraft ? speechDraft + " " : "") + words;
        setDraft(scope(), ui.input.value);
        renderConversation();
      };
      session.onend = function () {
        if (recognition !== session) return;
        recognition = null;
        listening = false;
        ui.mic.setAttribute("aria-pressed", "false");
        ui.mic.setAttribute("aria-label", "Speak");
        ui.input.placeholder = placeholder();
      };
      session.onerror = function () {
        if (recognition !== session) return;
        ui.speech.textContent = "Speak is unavailable. Please type your message.";
        session.onend();
      };
      ui.speech.textContent = "";
      listening = true;
      ui.mic.setAttribute("aria-pressed", "true");
      ui.mic.setAttribute("aria-label", "Stop speaking");
      ui.input.placeholder = "Listening…";
      session.start();
    } catch (_) {
      stopSpeech();
      ui.mic.hidden = true;
      ui.speech.textContent = "Speak is unavailable. Please type your message.";
    }
  }

  function viewport() {
    if (!ui) return;
    const view = window.visualViewport;
    const height = view ? view.height : window.innerHeight;
    const bottom = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0;
    ui.root.style.setProperty("--aap-agent-view-height", height + "px");
    ui.root.style.setProperty("--aap-agent-view-bottom", bottom + "px");
  }

  function mount() {
    if (ui || !config) return;
    const root = element("div", "root");
    const style = element("style", "style");
    style.textContent = `
.aap-agent-root { position:fixed; right:calc(16px + env(safe-area-inset-right, 0px)); bottom:calc(16px + env(safe-area-inset-bottom, 0px) + var(--aap-agent-view-bottom, 0px)); z-index:1000; display:grid; justify-items:end; gap:12px; font:400 16px/1.5 "Open Sans","Segoe UI",system-ui,-apple-system,Arial,sans-serif; color:#1c1c1c; text-align:left; color-scheme:light; }
.aap-agent-root, .aap-agent-root * { box-sizing:border-box; }
.aap-agent-root [hidden] { display:none !important; }
.aap-agent-root button, .aap-agent-root input, .aap-agent-root a { font:inherit; letter-spacing:normal; text-transform:none; }
.aap-agent-root button, .aap-agent-root a { touch-action:manipulation; }
.aap-agent-root :focus-visible { outline:3px solid #005ea8; outline-offset:3px; }
.aap-agent-root p, .aap-agent-root h2 { margin:0; }
.aap-agent-root button:disabled { cursor:default; opacity:.65; }
/* Launcher: raised cap on a wider base, glossy top. --aap-u scales the edges and shadows with the size. */
.aap-agent-launch {
  --aap-btn:76px; --aap-cap:58px; --aap-lift:7px; --aap-cap-font:16.5px; --aap-u:1px;
  --aap-wall:#075a9e; --aap-rim:#0d2a46; --aap-shade:rgba(13,42,70,.5);
  position:relative; display:inline-flex; align-items:flex-start; justify-content:center; flex:none;
  width:var(--aap-btn); height:var(--aap-btn); padding:0; margin:0; border:0; border-radius:50%;
  background:none; color:#fff; cursor:pointer; overflow:visible; -webkit-user-select:none; user-select:none;
  -webkit-tap-highlight-color:transparent; box-shadow:none;
}
.aap-agent-launch-base {
  position:absolute; inset:0; border-radius:50%;
  background:radial-gradient(circle at 50% 30%, #1c80d2 0%, #0a6ec1 55%, #0b5ea4 100%);
  box-shadow:
    inset 0 0 0 var(--aap-u) rgba(13,42,70,.3),
    inset 0 calc(var(--aap-u) * -3) calc(var(--aap-u) * 5) rgba(255,255,255,.22),
    0 calc(var(--aap-u) * 3) 0 #0b4f85, 0 calc(var(--aap-u) * 4) 0 var(--aap-rim),
    0 calc(var(--aap-u) * 12) calc(var(--aap-u) * 18) calc(var(--aap-u) * -4) var(--aap-shade);
}
.aap-agent-launch-cap {
  position:absolute; left:50%; top:calc((var(--aap-btn) - var(--aap-cap)) / 2 - var(--aap-lift));
  width:var(--aap-cap); height:var(--aap-cap); border-radius:50%;
  display:grid; place-items:center; transform:translateX(-50%);
  font:inherit; font-size:var(--aap-cap-font); line-height:1; font-weight:700 !important; letter-spacing:.01em;
  color:#fff;
  text-shadow:0 0 var(--aap-u) #0d2a46, 0 var(--aap-u) 0 #0d2a46, 0 calc(var(--aap-u) * -1) 0 #0d2a46, var(--aap-u) 0 0 #0d2a46, calc(var(--aap-u) * -1) 0 0 #0d2a46, 0 calc(var(--aap-u) * 2) calc(var(--aap-u) * 3) rgba(13,42,70,.5);
  background:
    radial-gradient(60% 34% at 50% 24%, rgba(255,255,255,.9) 0%, rgba(255,255,255,.5) 45%, rgba(255,255,255,0) 100%),
    radial-gradient(circle at 50% 35%, #4ea6ed 0%, #1b84d8 45%, #0a6ec1 72%, #085ea6 100%);
  box-shadow:
    inset 0 0 0 calc(var(--aap-u) * 1.5) rgba(13,42,70,.4),
    inset 0 calc(var(--aap-u) * -4) calc(var(--aap-u) * 8) rgba(8,70,130,.45),
    0 var(--aap-lift) 0 var(--aap-wall),
    0 calc(var(--aap-lift) + var(--aap-u)) 0 var(--aap-rim),
    0 calc(var(--aap-lift) + var(--aap-u) * 5) calc(var(--aap-u) * 8) calc(var(--aap-u) * -2) var(--aap-shade);
  transition:transform 80ms ease-out, box-shadow 80ms ease-out, filter 80ms ease-out;
}
.aap-agent-launch:hover .aap-agent-launch-cap { filter:brightness(1.08); }
.aap-agent-launch:active .aap-agent-launch-cap {
  transform:translate(-50%, calc(var(--aap-lift) * .57)); filter:brightness(.97);
  box-shadow:
    inset 0 0 0 calc(var(--aap-u) * 1.5) rgba(13,42,70,.4),
    inset 0 calc(var(--aap-u) * -4) calc(var(--aap-u) * 8) rgba(8,70,130,.45),
    0 calc(var(--aap-lift) * .43) 0 var(--aap-wall),
    0 calc(var(--aap-lift) * .43 + var(--aap-u)) 0 var(--aap-rim),
    0 calc(var(--aap-lift) * .43 + var(--aap-u) * 2) calc(var(--aap-u) * 4) calc(var(--aap-u) * -2) var(--aap-shade);
}
.aap-agent-launch:focus-visible { outline:3px solid #0a6ec1; outline-offset:4px; }
html.aap-agent-unread .aap-agent-launch::after { content:""; position:absolute; top:4px; right:8px; width:10px; height:10px; border-radius:50%; background:#e5a53a; box-shadow:0 0 0 2px #0d2a46; }
.aap-agent-launch.aap-agent-launch--giant { --aap-btn:240px; --aap-cap:184px; --aap-lift:14px; --aap-cap-font:46px; --aap-u:3px; }
html.aap-agent-unread .aap-agent-launch--giant::after { top:31px; right:45px; width:20px; height:20px; box-shadow:0 0 0 3px #0d2a46; }
@media (max-width:600px) {
  .aap-agent-launch { --aap-btn:64px; --aap-cap:48px; --aap-lift:6px; --aap-cap-font:14px; }
  .aap-agent-launch.aap-agent-launch--giant { --aap-btn:190px; --aap-cap:146px; --aap-lift:11px; --aap-cap-font:38px; --aap-u:2.5px; }
  html.aap-agent-unread .aap-agent-launch--giant::after { top:24px; right:35px; width:16px; height:16px; }
}
@media (prefers-color-scheme: dark) {
  .aap-agent-launch { --aap-wall:#0b4f85; --aap-rim:#1b3f66; --aap-shade:rgba(0,0,0,.6); }
  .aap-agent-launch-base { box-shadow:inset 0 0 0 var(--aap-u) rgba(255,255,255,.14), inset 0 calc(var(--aap-u) * -3) calc(var(--aap-u) * 5) rgba(255,255,255,.18), 0 calc(var(--aap-u) * 3) 0 #0b4f85, 0 calc(var(--aap-u) * 4) 0 var(--aap-rim), 0 calc(var(--aap-u) * 12) calc(var(--aap-u) * 18) calc(var(--aap-u) * -4) var(--aap-shade); }
  html.aap-agent-unread .aap-agent-launch::after { box-shadow:0 0 0 2px #f4f4f4; }
}
@media (prefers-reduced-motion: reduce) {
  .aap-agent-launch-cap { transition:none; }
}
@media (min-width:601px) {
  .aap-agent-launch { display:none; }
  html.aap-agent-scrolled .aap-agent-launch, .aap-agent-float .aap-agent-launch, .aap-agent-launch.aap-agent-launch--giant { display:inline-flex; }
}
.aap-agent-float.aap-agent-open .aap-agent-launch { display:none; }
.aap-agent-greeting { display:flex; align-items:center; gap:4px; max-width:300px; padding:8px 4px 8px 16px; border:1px solid #e3e3e3; border-radius:12px; background:#fff; box-shadow:0 24px 48px -28px rgba(13,42,70,.35),0 1px 2px rgba(13,42,70,.1); font-size:16px; line-height:1.4; }
.aap-agent-greeting-close { flex:none; min-width:44px; min-height:44px; padding:0 8px; border:0; border-radius:4px; background:none; color:#005ea8; font-weight:600 !important; cursor:pointer; }
.aap-agent-mark { display:block; width:32px; height:19px; flex:none; }
.aap-agent-panel { width:400px; max-width:calc(100vw - 32px); height:min(680px, calc(100vh - 112px)); height:min(680px, calc(100dvh - 112px), calc(var(--aap-agent-view-height, 100dvh) - 112px)); background:#fff; border:1px solid #e3e3e3; border-radius:12px; box-shadow:0 24px 48px -28px rgba(13,42,70,.35),0 1px 2px rgba(13,42,70,.1); overflow:hidden; display:flex; flex-direction:column; min-height:0; }
.aap-agent-header { flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:64px; padding:10px 8px 10px 16px; background:linear-gradient(90deg, #016195, #0073ae 50%, #017dbd); color:#fff; }
.aap-agent-root h2.aap-agent-heading { display:flex; align-items:center; gap:12px; min-width:0; min-height:0; margin:0; padding:0; background:none; border:0; border-radius:0; color:inherit; font:inherit; }
.aap-agent-avatar { display:grid; place-items:center; flex:none; width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,.18); }
.aap-agent-avatar .aap-agent-mark { width:24px; height:14px; }
.aap-agent-names { display:grid; min-width:0; }
.aap-agent-heading-text { font-size:18px; line-height:1.3; font-weight:700; }
.aap-agent-sub { font-size:13px; line-height:1.35; color:rgba(255,255,255,.85); }
.aap-agent-close { display:inline-flex; align-items:center; gap:4px; flex:none; min-width:44px; min-height:44px; padding:8px 12px; border-radius:6px; border:0; background:none; color:#fff; font-weight:600 !important; cursor:pointer; }
.aap-agent-close:hover { background:rgba(0,0,0,.15); }
.aap-agent-close-icon { width:18px; height:18px; }
.aap-agent-header :focus-visible { outline-color:#fff; }
.aap-agent-bar { flex:none; height:3px; background:#d5e6f5; overflow:hidden; }
.aap-agent-bar::before { content:""; display:block; height:100%; width:100%; background:#0a6ec1; transform-origin:left; animation:aap-agent-fill var(--aap-agent-eta, 60s) linear forwards; }
@keyframes aap-agent-fill { from { transform:scaleX(0); } to { transform:scaleX(1); } }
.aap-agent-body { flex:1 1 auto; display:grid; align-content:start; gap:12px; padding:16px; min-height:0; overflow:auto; overscroll-behavior:contain; overflow-wrap:anywhere; background:#f7f8fa; }
.aap-agent-context { font-size:15px; color:#5f5f5f; }
.aap-agent-view { min-height:44px; padding:0 2px; border:0; background:none; color:#005ea8; font-weight:600 !important; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
.aap-agent-property { font-size:18px; font-weight:700; color:#0d2a46; }
.aap-agent-conversation:not(:has(.aap-agent-status:not([hidden]))) { display:none; }
.aap-agent-status, .aap-agent-sys { font-size:13px; color:#5f5f5f; white-space:pre-wrap; text-align:center; }
.aap-agent-error { font-weight:600; color:#a72a2a; }
.aap-agent-footer { flex:none; padding:12px 16px; border-top:1px solid #e3e3e3; background:#fff; display:grid; gap:8px; }
.aap-agent-form { display:grid; gap:8px; margin:0; }
.aap-agent-field { display:flex; align-items:flex-end; gap:2px; padding:2px 4px 2px 16px; border:1px solid #8a949f; border-radius:24px; background:#fff; }
.aap-agent-field:focus-within { border-color:#0a6ec1; box-shadow:0 0 0 1px #0a6ec1; }
.aap-agent-root .aap-agent-input { flex:1; min-width:0; width:100%; min-height:48px; max-height:120px; padding:12px 0; font-size:16px !important; line-height:24px; border:0; border-radius:0; background:#fff; color:#1c1c1c; box-shadow:none; resize:none; overflow-y:auto; font-family:inherit; }
.aap-agent-input:focus-visible { outline:none; }
.aap-agent-input::placeholder { color:#5f5f5f; opacity:1; }
.aap-agent-mic, .aap-agent-send { display:flex; align-items:center; justify-content:center; flex:none; width:44px; height:44px; padding:10px; border:0; border-radius:50%; cursor:pointer; }
.aap-agent-mic { background:#fff; color:#005ea8; }
.aap-agent-mic[aria-pressed="true"] { background:#eaf3fb; }
.aap-agent-send { background:#0a6ec1; color:#fff; }
.aap-agent-send:hover:enabled { background:#085ea6; }
.aap-agent-send:disabled { background:#8a949f; }
.aap-agent-mic-icon, .aap-agent-send-icon { width:24px; height:24px; }
.aap-agent-disclosure { font-size:12px; line-height:1.4; color:#5f5f5f; text-align:center; }
.aap-agent-speech { font-size:15px; color:#444; }
.aap-agent-speech:empty { display:none; }
.aap-agent-hosted .aap-agent-close, .aap-agent-hosted .aap-agent-launch { display:none; }
@media (min-width:1280px) {
  html.aap-agent-docked body { padding-right:400px; }
  .aap-agent-dock.aap-agent-open { top:0; right:0; bottom:0; }
  .aap-agent-dock.aap-agent-open .aap-agent-panel { width:400px; max-width:none; height:100vh; height:100dvh; border:0; border-left:1px solid #e3e3e3; border-radius:0; box-shadow:none; }
}
@media (max-width:600px) {
  .aap-agent-root.aap-agent-open { left:0; right:0; bottom:var(--aap-agent-view-bottom, 0px); justify-items:stretch; gap:0; }
  .aap-agent-open .aap-agent-launch { display:none; }
  .aap-agent-panel { width:100%; max-width:none; height:90vh; height:min(90dvh, var(--aap-agent-view-height, 90dvh)); border-radius:12px 12px 0 0; border-bottom:0; }
  .aap-agent-footer { padding:12px 16px calc(10px + env(safe-area-inset-bottom, 0px)); }
}
.aap-agent-root.aap-agent-hosted { position:static; display:block; z-index:auto; }
.aap-agent-hosted .aap-agent-panel { width:100%; max-width:none; height:auto; border-radius:6px; border-bottom:1px solid #e3e3e3; box-shadow:none; }
.aap-agent-hosted .aap-agent-body { max-height:min(55vh, 520px); max-height:min(55dvh, 520px); }
.aap-agent-thread { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.aap-agent-says, .aap-agent-you, .aap-agent-intro { position:relative; display:grid; gap:4px; max-width:85%; }
.aap-agent-says, .aap-agent-intro { justify-self:start; justify-items:start; margin-left:32px; }
.aap-agent-you { justify-self:end; justify-items:end; }
.aap-agent-bubble-avatar { position:absolute; left:-32px; top:0; display:grid; place-items:center; width:24px; height:24px; border-radius:50%; background:#0a6ec1; }
.aap-agent-bubble-avatar .aap-agent-mark { width:16px; height:10px; }
.aap-agent-who { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.aap-agent-who.aap-agent-human { position:static; width:auto; height:auto; overflow:visible; clip:auto; padding:0 4px; font-size:12px; line-height:1.3; font-weight:600; color:#5f5f5f; }
.aap-agent-words { padding:10px 14px; border-radius:16px; font-size:16px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.aap-agent-says .aap-agent-words, .aap-agent-intro .aap-agent-words { background:#fff; border:1px solid #e3e3e3; border-bottom-left-radius:4px; color:#1c1c1c; }
.aap-agent-you .aap-agent-words { background:#0a6ec1; color:#fff; border-bottom-right-radius:4px; }
.aap-agent-pending .aap-agent-words { color:#5f5f5f; }
.aap-agent-note { padding:0 4px; font-size:12px; line-height:1.3; color:#5f5f5f; }
.aap-agent-typing { display:flex; gap:4px; align-items:center; min-height:44px; }
.aap-agent-dot { width:8px; height:8px; border-radius:50%; background:#5f5f5f; animation:aap-agent-bounce 1.2s infinite ease-in-out; }
.aap-agent-dot:nth-child(2) { animation-delay:.15s; }
.aap-agent-dot:nth-child(3) { animation-delay:.3s; }
@keyframes aap-agent-bounce { 0%, 60%, 100% { transform:translateY(0); } 30% { transform:translateY(-4px); } }
@media (prefers-reduced-motion:reduce) { .aap-agent-dot { animation:none; } .aap-agent-bar { display:none; } }
.aap-agent-prompt { display:grid; gap:10px; padding:12px 14px; border:1px solid #d5e6f5; border-left:4px solid #0a6ec1; border-radius:8px; background:#fff; }
.aap-agent-prompt[data-tone="check"] { border-left-color:#c92a2a; }
.aap-agent-kicker { font-size:13px; font-weight:600; color:#5f5f5f; }
.aap-agent-card-body { font-size:16px; line-height:1.45; }
.aap-agent-more { min-height:44px; margin-left:4px; padding:0 2px; border:0; background:none; color:#005ea8; font-weight:600 !important; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
.aap-agent-prompt-text { font-size:14px; font-weight:600; color:#5f5f5f; }
.aap-agent-chips, .aap-agent-starters, .aap-agent-hand { display:flex; flex-wrap:wrap; gap:8px; }
.aap-agent-handlink { min-height:44px; padding:0 4px; border:0; background:none; color:#005ea8; font-size:14px; font-weight:600 !important; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
.aap-agent-root .aap-agent-handlink[aria-disabled="true"] { cursor:default; opacity:.65; }
.aap-agent-starters { margin-left:32px; }
.aap-agent-chip { min-width:44px; min-height:44px; max-width:100%; padding:6px 16px; border:1px solid #0a6ec1; border-radius:999px; background:#fff; color:#005ea8; font-size:15px; line-height:1.3; font-weight:600 !important; text-align:left; white-space:normal; overflow-wrap:anywhere; cursor:pointer; }
.aap-agent-chip:hover:enabled, .aap-agent-chip[aria-pressed="true"] { background:#eaf3fb; }
.aap-agent-root .aap-agent-chip[aria-disabled="true"] { cursor:default; opacity:.65; background:#fff; }
.aap-agent-answer-box { display:grid; gap:8px; }
.aap-agent-answer-input { display:block; width:100%; min-height:72px; padding:10px 12px; border:1px solid #8a949f; border-radius:8px; background:#fff; color:#1c1c1c; resize:vertical; overflow:auto; }
.aap-agent-answer-box .talk-box > .aap-agent-answer-input { padding-right:46px; }
.aap-agent-save, .aap-agent-page-button { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:8px 20px; border:1px solid #005ea8; border-radius:999px; background:#005ea8; color:#fff; font-weight:600 !important; cursor:pointer; }
.aap-agent-save { justify-self:start; }
.aap-agent-page-button { width:100%; }
.aap-agent-save:hover:enabled, .aap-agent-page-button:hover:enabled { background:#004f8f; }
`;
    const panel = element("section", "panel");
    panel.hidden = true;
    panel.id = "aap-agent-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "aap-agent-title");
    const header = element("div", "header");
    const heading = element("h2", "heading");
    const title = element("span", "heading-text", label());
    title.id = "aap-agent-title";
    const sub = element("span", "sub");
    const names = element("span", "names");
    names.append(title, sub);
    heading.append(avatar("avatar"), names);
    const close = element("button", "close", "Close");
    close.type = "button";
    close.setAttribute("aria-label", "Close chat, your conversation is kept");
    close.append(svg("0 0 24 24", [{ d: "M6 9l6 6 6-6", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }], "close-icon"));
    header.append(heading, close);
    const bar = element("div", "bar");
    bar.hidden = true;
    const body = element("div", "body");
    const intro = element("div", "intro");
    const introText = element("p", "words");
    intro.append(avatar("bubble-avatar"), introText);
    const context = element("p", "context");
    const conversation = element("div", "conversation");
    conversation.setAttribute("aria-live", "polite");
    conversation.setAttribute("aria-atomic", "true");
    const status = element("p", "status");
    conversation.append(status);
    body.append(intro, context, conversation);
    const thread = element("ol", "thread");
    thread.setAttribute("role", "log");
    thread.setAttribute("aria-live", "polite");
    thread.hidden = true;
    const promptRow = element("div", "prompt");
    const kicker = element("p", "kicker");
    const cardBody = element("p", "card-body");
    const cardText = element("span", "card-text");
    const more = element("button", "more", "More");
    more.type = "button";
    more.addEventListener("click", function () { cardText.textContent = cardBody.dataset.full || ""; more.hidden = true; });
    cardBody.append(cardText, more);
    const promptText = element("p", "prompt-text");
    const chips = element("div", "chips");
    const answerBox = element("div", "answer-box");
    const action = element("div", "action");
    promptRow.append(kicker, cardBody, promptText, answerBox, chips, action);
    promptRow.hidden = true;
    const starters = element("div", "starters");
    starters.hidden = true;
    const sys = element("p", "sys");
    sys.setAttribute("role", "status");
    sys.hidden = true;
    body.insertBefore(thread, conversation);
    body.insertBefore(starters, conversation);
    body.insertBefore(sys, conversation);
    if (config.host) body.insertBefore(promptRow, conversation);
    const footer = element("div", "footer");
    const form = element("form", "form");
    form.autocomplete = "off";
    const field = element("div", "field");
    const input = element("textarea", "input");
    input.rows = 1;
    input.maxLength = 3000;
    input.placeholder = placeholder();
    input.setAttribute("aria-label", placeholder());
    const mic = element("button", "mic");
    mic.type = "button";
    mic.title = "Speak";
    mic.setAttribute("aria-label", "Speak");
    mic.setAttribute("aria-pressed", "false");
    mic.hidden = !(window.SpeechRecognition || window.webkitSpeechRecognition);
    mic.append(svg("0 0 24 24", [{ d: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-4v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" }], "mic-icon"));
    const send = element("button", "send");
    send.type = "submit";
    send.setAttribute("aria-label", "Send");
    send.append(svg("0 0 24 24", [{ d: "M12 19V5m-6 6l6-6 6 6", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" }], "send-icon"));
    field.append(input, mic, send);
    const speech = element("p", "speech");
    speech.setAttribute("role", "status");
    form.append(field, speech);
    const disclosure = element("p", "disclosure", "This is the Desk AI agent.");
    footer.append(form, disclosure);
    panel.append(header, bar, body, footer);
    const launch = element("button", "launch");
    launch.type = "button";
    const launchBase = element("span", "launch-base");
    launchBase.setAttribute("aria-hidden", "true");
    launch.append(launchBase, element("span", "launch-cap", "Agent"));
    launch.setAttribute("aria-label", "Open the agent chat");
    launch.setAttribute("aria-expanded", "false");
    launch.setAttribute("aria-controls", panel.id);
    launch.setAttribute("aria-haspopup", "dialog");
    ui = { root, panel, close, launch, title, sub, bar, sys, intro, introText, disclosure, greeting: null, context, status, input, send, mic, form, speech,
      body, thread, threadCount: 0, lines: new Map(), prompt: promptRow, kicker, cardBody, cardText, more, promptText, chips, chipShape: "", answerBox, answerInput: null, action,
      pageShape: "", pageEl: null, starters, starterShape: "" };
    mountedScope = scope();
    input.value = getDraft(mountedScope);
    input.addEventListener("input", function () { try { setDraft(scope(), input.value); ui.speech.textContent = ""; } catch (_) { ui.speech.textContent = "Could not save your draft in this browser."; } renderConversation(); });
    input.addEventListener("keydown", function (event) {   // Enter sends; Shift+Enter is a new line; never mid-composition (IME)
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      form.requestSubmit();
    });
    form.addEventListener("submit", submit);
    mic.addEventListener("click", startSpeech);
    if (config.host && !config.float) {
      root.classList.add("aap-agent-hosted", "aap-agent-open");
      root.append(style, panel);
      panel.hidden = false;
      panel.setAttribute("role", "region");
      opened = true;
      config.host.append(root);
      render();
      return;
    }
    if (config.float) root.classList.add("aap-agent-float");
    if (config.dock) root.classList.add("aap-agent-dock");
    root.append(style, panel, launch);
    launch.addEventListener("click", () => open(!opened));
    close.addEventListener("click", () => open(false));
    document.addEventListener("keydown", function (event) {   // non-modal: Escape closes while focus is in the panel or nowhere in particular
      const at = document.activeElement;
      if (event.key === "Escape" && opened && (root.contains(at) || !at || at === document.body)) { event.preventDefault(); open(false); }
    });
    window.addEventListener("resize", viewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", viewport);
      window.visualViewport.addEventListener("scroll", viewport);
    }
    document.body.append(root);
    viewport();
    render();
    greet(true);
  }

  window.AAPAgent = Object.freeze({
    init: function (options) {
      if (config) return;
      if (!options || !options.chat && typeof options.send !== "function") throw new TypeError("AAPAgent.init requires send.");
      config = { send: options.send, office: options.office || {}, float: options.float === true, dock: options.dock === true };
      if (options.host) {
        if (!(options.host instanceof Element) || typeof options.choose !== "function" || typeof options.save !== "function" || typeof options.tap !== "function")
          throw new TypeError("AAPAgent.init host mode requires host, choose, save and tap.");
        Object.assign(config, { host: options.host, choose: options.choose, save: options.save, tap: options.tap, talk: options.talk });
      }
      config.chatContext = options.chatContext;
      if (options.chat) {
        try {
          chat = window.AAPChatClient({ ...options.chat, surface: options.host ? "form" : "portal",
            onchange: function (next) { chatView = next; if (ui) render(); } });
        } catch (_) {
          // Configured streaming never silently falls back to a second answer owner.
          chatView = { status: "Connection unavailable. Your draft is kept.", messages: [] };
          config.send = () => Promise.resolve({ ok: false, error: "Chat could not connect. Your draft is kept." });
        }
      }
      if (document.body) mount();
      else document.addEventListener("DOMContentLoaded", mount, { once: true });
    },
    hosts: true,
    open: function (yes) {
      if (!ui || config.host && !config.float) return;
      if (yes === false) { if (opened) open(false); } else if (!opened) open(true);
    },
    show: function (yes) {
      if (!ui) return;
      if (!yes && opened && config.float) open(false);
      ui.root.style.display = yes ? "" : "none";
    },
    status: function (next) {
      live = next && (next.state === "connecting" || next.state === "live") ? { state: next.state, eta: Math.max(1, Number(next.eta) || 60), at: Date.now() } : null;
      if (live && live.state === "connecting") setTimeout(function () { if (ui) renderLive(); }, 2 * live.eta * 1000 + 50);
      if (ui) renderLive();
    },
    update: function (next) {
      if (!next || typeof next !== "object") return;
      if (chat && next.chat && next.chat.grant) chat.regrant(next.chat.grant);
      data = {
        route: next.route || "home", order: next.order || null,
        needs: Array.isArray(next.needs) ? next.needs : [],
        orders: Array.isArray(next.orders) ? next.orders : [],
        thread: Array.isArray(next.thread) ? next.thread : [], plan: next.plan || null, profile: next.profile === true,
        prompt: next.prompt && typeof next.prompt === "object" ? next.prompt : null,
        starters: Array.isArray(next.starters) ? next.starters : [], nudge: typeof next.nudge === "string" ? next.nudge : null
      };
      conversations.forEach((request, order) => recover(order, request));
      render();
      if (ui && config.float && data.nudge && !nudged) { nudged = true; setTimeout(() => greet(true), 2000); }
    }
  });
})();
