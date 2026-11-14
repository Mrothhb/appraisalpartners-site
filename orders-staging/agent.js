/* A&AP portal v1.5. The page supplies all data and the only send operation. */
(function () {
  "use strict";
  if (window.AAPAgent) return;

  const PLACEHOLDER = "Ask about orders, files or billing";
  const SENT = "Sent. Your desk answers within a few minutes.";
  const LABEL = "Ask your agent";
  const GREETING = "Questions about an order? Ask here. Replies in minutes.";
  let seenKey = "aap-agent-seen-";
  try { seenKey += new URLSearchParams(window.location.search).get("t") || ""; } catch (_) { /* No link code: one key. */ }
  const conversations = new Map();
  const drafts = new Map();
  let data = { route: "home", order: null, needs: [], orders: [], thread: [], plan: null };
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

  function scope() {
    return data.route === "order" && data.order ? data.order : null;
  }

  function sameScope(message, order) {
    return (message.order || null) === order;
  }

  function selectedOrder() {
    return data.orders.find(order => order.ap === scope());
  }

  // A desk reply answers the message its re names (the id send returned); never matched by text, time or order alone.
  // With nothing asked here yet, the latest reply shows on its own; one bound to no message stays unbound.
  function replyFor(order, request) {
    const desks = data.thread.filter(message => sameScope(message, order) && message.who === "desk");
    if (!request) return desks.length ? desks[desks.length - 1] : null;
    if (request.status !== "sent" || !request.id) return null;
    const bound = desks.filter(message => message.re === request.id);
    return bound.length ? bound[bound.length - 1] : null;
  }

  function askedBy(reply) {
    const asked = reply && reply.re ? data.thread.find(message => message.who === "you" && message.id === reply.re) : null;
    return asked ? asked.text : "";
  }

  // The page retries an unconfirmed message on its own; once the thread shows it confirmed, this panel says Sent.
  function recover(order, request) {
    if (!request || request.status !== "failed" || !request.id) return;
    const mine = data.thread.find(message => message.who === "you" && message.id === request.id);
    if (!mine || mine.pending) return;
    request.status = "sent";
    if ((drafts.get(order) || "").trim() === request.text) drafts.set(order, "");
    if (ui && scope() === order && ui.input.value.trim() === request.text) ui.input.value = "";
  }

  function suggestions() {
    return data.needs.filter(function (need) {
      if (scope()) return need.ap === scope();
      if (data.route === "billing") return need.kind === "pay";
      if (data.route === "help") return false;
      if (data.route === "delivered") {
        const order = data.orders.find(item => item.ap === need.ap);
        return need.kind === "pay" || /(?:#|\/)delivered(?:[/?#]|$)/i.test(need.href || "") ||
          Boolean(order && /delivered/i.test(order.status || ""));
      }
      return data.route !== "orders" || need.kind !== "pay";
    });
  }

  function safeHref(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:", "file:"].includes(url.protocol)) return null;
      if (url.origin !== window.location.origin) return null;
      return url.href;
    } catch (_) { return null; }
  }

  function renderContext() {
    const order = selectedOrder();
    const needs = suggestions();
    let line;
    if (scope()) line = (order && order.street ? order.street + " · " : "") + scope() +
      (order && order.status ? " · " + order.status : "");
    else if (data.route === "help") line = "Ask about orders, files or billing.";
    else if (data.route === "billing") line = needs.length ? "Select a billing item below." : "Ask about billing.";
    else if (data.route === "delivered") line = needs.length ? "Select a delivered report below." : "Ask about a delivered report.";
    else {
      const count = new Set(needs.map(need => need.ap).filter(Boolean)).size;
      line = count ? count + (count === 1 ? " order needs" : " orders need") + " your attention. Select an order below." : "Ask about orders, files or billing.";
    }
    ui.context.textContent = line;
    ui.context.classList.toggle("aap-agent-property", Boolean(scope()));
    ui.suggestions.replaceChildren();
    needs.slice(0, 2).forEach(function (need) {
      const href = safeHref(need.href);
      const link = element(href ? "a" : "button", "suggestion");
      const street = need.street || need.ap || "";
      const label = need.label || "Open order";
      link.textContent = scope() || !street || label.includes(street) ? label : street + ": " + label;
      if (href) link.href = href;
      else {
        link.type = "button";
        link.disabled = true;
      }
      ui.suggestions.append(link);
    });
    ui.suggestions.hidden = !ui.suggestions.childElementCount;
  }

  function renderConversation() {
    const order = scope();
    const request = conversations.get(order);
    const reply = replyFor(order, request);
    const asked = request ? request.text : askedBy(reply);
    const sending = Boolean(request && request.status === "sending");
    ui.input.disabled = sending;
    ui.send.disabled = sending || !ui.input.value.trim();
    ui.send.textContent = sending ? "Sending…" : "Send";
    ui.mic.disabled = sending;
    ui.form.setAttribute("aria-busy", String(sending));
    let status = "";
    if (request) {
      if (sending) status = "Sending…";
      else if (request.status === "failed") status = request.error;
      else if (!reply) status = SENT;
    }
    ui.status.textContent = status;
    ui.status.hidden = !status;
    ui.status.classList.toggle("aap-agent-error", Boolean(request && request.status === "failed"));
    ui.answer.hidden = !reply;
    ui.reply.textContent = reply ? reply.text : "";
    ui.question.hidden = !asked;
    ui.question.textContent = asked ? "You asked: " + asked : "";
  }

  function stopSpeech() {
    const active = recognition;
    recognition = null;
    listening = false;
    if (ui) {
      ui.mic.setAttribute("aria-pressed", "false");
      ui.mic.setAttribute("aria-label", "Speak");
      ui.input.placeholder = PLACEHOLDER;
    }
    if (active) {
      try { active.abort(); } catch (_) { /* Already stopped. */ }
    }
  }

  function render() {
    if (!ui) return;
    const order = scope();
    if (order !== mountedScope) {
      drafts.set(mountedScope, ui.input.value);
      stopSpeech();
      mountedScope = order;
      ui.input.value = drafts.get(order) || "";
    }
    ui.title.textContent = data.plan ? "Your dedicated agent" : "A&AP agent";
    ui.intro.textContent = data.plan
      ? "This agent works only for " + (config.office.name || "your office") + ". It remembers your orders, your preferences and the way you like things done, and it gets more helpful with every order. Think of it as your assistant at A&AP."
      : "Ask about any order here, or anything else you need. Customers on a monthly plan get their own dedicated agent that remembers their orders, preferences and style.";
    renderContext();
    renderConversation();
    unread();
  }

  // The last-opened mark per link code: the newest desk reply's time when the panel was last open (the desk's clock, so a
  // phone's own clock never hides or invents a dot). Memory stands in when this browser cannot store it.
  function seen(value) {
    if (value !== undefined) seenMemory = value;
    try {
      if (value !== undefined) localStorage.setItem(seenKey, String(value));
      else { const stored = localStorage.getItem(seenKey); if (stored !== null) return Number(stored) || 0; }
    } catch (_) { /* Not stored; memory only. */ }
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
    ui.launch.setAttribute("aria-label", yes ? LABEL + ", 1 new reply" : LABEL);
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
    if (!yes) stopSpeech();
    greet(false);
    unread();
    // Focus a button, never the input: opening must not summon the phone keyboard. Closing goes back to the button that
    // opened it, else the launcher, else the page's own bar button (the launcher is hidden on wider screens).
    const back = [opener, ui.launch].concat(Array.from(document.querySelectorAll(".talk"))).find(shown);
    if (yes) ui.close.focus({ preventScroll: true });
    else if (back) back.focus({ preventScroll: true });
  }

  // Once per browser, on phones only: a line above the launcher, gone after 8 seconds or the first tap.
  function greet(yes) {
    if (!yes) {
      if (ui.greeting) ui.greeting.remove();
      ui.greeting = null;
      return;
    }
    try {
      if (!window.matchMedia("(max-width:600px)").matches || localStorage.getItem("aap-agent-greeted")) return;
      localStorage.setItem("aap-agent-greeted", "1");
    } catch (_) { return; }
    const bubble = element("div", "greeting");
    bubble.setAttribute("role", "status");
    const dismiss = element("button", "greeting-close", "Close");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => greet(false));
    bubble.append(element("p", "greeting-text", GREETING), dismiss);
    ui.root.insertBefore(bubble, ui.launch);
    ui.greeting = bubble;
    setTimeout(() => greet(false), 8000);
    document.addEventListener("pointerdown", () => setTimeout(() => greet(false), 0), { once: true, capture: true });
  }

  async function submit(event) {
    event.preventDefault();
    const order = scope();
    const text = ui.input.value.trim();
    const previous = conversations.get(order);
    if (!text || (previous || {}).status === "sending") return;
    stopSpeech();
    // The same words sent again after a failure retry that message (its id); they never make a second one.
    const retry = previous && previous.status === "failed" && previous.id && previous.text === text ? previous.id : null;
    const request = { text: text, status: "sending", id: retry };
    conversations.set(order, request);
    renderConversation();
    try {
      const result = await config.send(retry ? { order: order, text: text, id: retry } : { order: order, text: text });
      if (result && typeof result.id === "string" && result.id) request.id = result.id;
      if (!result || result.ok !== true) throw new Error(result && result.error || "Please try again.");
      request.status = "sent";
      drafts.set(order, "");
      if (scope() === order) ui.input.value = "";
    } catch (error) {
      request.status = "failed";
      request.error = "Could not send. " + (error && error.message || "Please try again.");
      drafts.set(order, text);
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
        drafts.set(scope(), ui.input.value);
        renderConversation();
      };
      session.onend = function () {
        if (recognition !== session) return;
        recognition = null;
        listening = false;
        ui.mic.setAttribute("aria-pressed", "false");
        ui.mic.setAttribute("aria-label", "Speak");
        ui.input.placeholder = PLACEHOLDER;
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
.aap-agent-root { position:fixed; right:calc(16px + env(safe-area-inset-right, 0px)); bottom:calc(16px + env(safe-area-inset-bottom, 0px) + var(--aap-agent-view-bottom, 0px)); z-index:1000; display:grid; justify-items:end; gap:12px; font:400 18px/1.5 "Open Sans","Segoe UI",system-ui,-apple-system,Arial,sans-serif; color:#1c1c1c; text-align:left; color-scheme:light; }
.aap-agent-root, .aap-agent-root * { box-sizing:border-box; }
.aap-agent-root [hidden] { display:none !important; }
.aap-agent-root button, .aap-agent-root input, .aap-agent-root a { font:inherit; letter-spacing:normal; text-transform:none; }
.aap-agent-root button, .aap-agent-root a { touch-action:manipulation; }
.aap-agent-root :focus-visible { outline:3px solid #005ea8; outline-offset:3px; }
.aap-agent-root p, .aap-agent-root h2 { margin:0; }
.aap-agent-root button:disabled { cursor:default; opacity:.65; }
.aap-agent-launch { position:relative; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:52px; min-width:56px; padding:0 20px 0 16px; border-radius:999px; border:0; background:#0a6ec1; color:#fff; font-size:16px; line-height:1.2; font-weight:700 !important; cursor:pointer; box-shadow:0 10px 28px -12px rgba(13,42,70,.6); }
.aap-agent-launch:hover { background:#085ea6; }
.aap-agent-launch-icon { display:block; width:22px; height:22px; flex:none; }
html.aap-agent-unread .aap-agent-launch::after { content:""; position:absolute; top:-2px; right:-2px; width:10px; height:10px; border-radius:50%; background:#e5a53a; box-shadow:0 0 0 2px #0d2a46; }
@media (min-width:601px) {
  .aap-agent-launch { display:none; }
  html.aap-agent-scrolled .aap-agent-launch { display:inline-flex; width:56px; min-height:56px; padding:0; }
  .aap-agent-launch-text { display:none; }
}
.aap-agent-greeting { display:flex; align-items:center; gap:4px; max-width:300px; padding:8px 4px 8px 16px; border:1px solid #e3e3e3; border-radius:6px; background:#fff; box-shadow:0 24px 48px -28px rgba(13,42,70,.35),0 1px 2px rgba(13,42,70,.1); font-size:16px; line-height:1.4; }
.aap-agent-greeting-close { flex:none; min-width:48px; min-height:48px; padding:0 8px; border:0; border-radius:4px; background:none; color:#005ea8; font-weight:600 !important; cursor:pointer; }
.aap-agent-mark { display:block; width:32px; height:19px; flex:none; }
.aap-agent-panel { width:440px; max-width:calc(100vw - 32px); max-height:calc(100vh - 96px); max-height:min(calc(100dvh - 96px), calc(var(--aap-agent-view-height, 100dvh) - 96px)); background:#fff; border:1px solid #e3e3e3; border-radius:6px; box-shadow:0 24px 48px -28px rgba(13,42,70,.35),0 1px 2px rgba(13,42,70,.1); overflow:hidden; display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-height:0; }
.aap-agent-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 12px 12px 24px; background:linear-gradient(90deg, #016195, #006da5 50%, #016da6); color:#fff; }
.aap-agent-heading { display:flex; align-items:center; gap:12px; font-size:18px; line-height:1.5; font-weight:700; }
.aap-agent-close { flex:none; min-width:48px; min-height:48px; padding:8px 16px; border-radius:4px; border:0; background:rgba(0,0,0,.15); color:#fff; font-weight:600 !important; cursor:pointer; }
.aap-agent-header :focus-visible { outline-color:#fff; }
.aap-agent-body { display:grid; align-content:start; gap:20px; padding:24px; min-height:0; overflow:auto; overscroll-behavior:contain; overflow-wrap:anywhere; }
.aap-agent-intro { font-size:16px; color:#444; }
.aap-agent-property { font-size:20px; font-weight:700; color:#0d2a46; }
.aap-agent-suggestions { display:flex; flex-wrap:wrap; gap:8px; }
.aap-agent-suggestion { display:inline-flex; justify-content:center; align-items:center; min-width:48px; min-height:48px; max-width:100%; padding:8px 16px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#005ea8; font-weight:600 !important; text-align:left; text-decoration:none; white-space:normal; overflow-wrap:anywhere; cursor:pointer; }
.aap-agent-suggestion:hover { background:#eaf3fb; border-color:#005ea8; color:#005ea8; }
.aap-agent-conversation { display:grid; gap:12px; }
.aap-agent-question { font-size:16px; color:#444; white-space:pre-wrap; }
.aap-agent-status { font-weight:600; color:#444; white-space:pre-wrap; }
.aap-agent-error { color:#a72a2a; }
.aap-agent-answer { display:grid; gap:8px; padding:16px 20px; border:1px solid #e3e3e3; border-radius:4px; background:#f4f5f5; }
.aap-agent-answer-heading { font-size:18px; font-weight:700; color:#0d2a46; }
.aap-agent-reply { white-space:pre-wrap; overflow-wrap:anywhere; }
.aap-agent-footer { padding:20px 24px 24px; border-top:1px solid #e3e3e3; background:#fff; display:grid; gap:16px; }
.aap-agent-form { display:grid; gap:12px; margin:0; }
.aap-agent-field { display:flex; align-items:center; gap:8px; padding:4px 4px 4px 16px; border:1px solid #8a949f; border-radius:4px; background:#fff; }
.aap-agent-field:focus-within { outline:2px solid #005ea8; outline-offset:2px; }
.aap-agent-input { flex:1; min-width:0; width:100%; min-height:48px; padding:8px 0; border:0; border-radius:0; background:#fff; color:#1c1c1c; box-shadow:none; }
.aap-agent-input:focus-visible { outline:none; }
.aap-agent-input::placeholder { color:#444; opacity:1; }
.aap-agent-mic { display:flex; align-items:center; justify-content:center; flex:none; width:48px; height:48px; padding:12px; border:0; border-radius:4px; background:#fff; color:#005ea8; cursor:pointer; }
.aap-agent-mic[aria-pressed="true"] { background:#eaf3fb; }
.aap-agent-mic-icon { width:24px; height:24px; }
.aap-agent-send-row { display:flex; justify-content:flex-end; }
.aap-agent-send { display:inline-flex; align-items:center; justify-content:center; min-width:80px; min-height:48px; padding:8px 20px; border:1px solid #005ea8; border-radius:4px; background:#005ea8; color:#fff; font-weight:600 !important; cursor:pointer; }
.aap-agent-send:hover:enabled { background:#004f8f; }
.aap-agent-disclosure { font-size:16px; color:#444; }
.aap-agent-speech { font-size:16px; color:#444; }
.aap-agent-speech:empty { display:none; }
@media (max-width:600px) {
  .aap-agent-root.aap-agent-open { left:0; right:0; bottom:var(--aap-agent-view-bottom, 0px); justify-items:stretch; gap:0; }
  .aap-agent-open .aap-agent-launch { display:none; }
  .aap-agent-panel { width:100%; max-width:none; max-height:80vh; max-height:min(80dvh, var(--aap-agent-view-height, 80dvh)); border-radius:6px 6px 0 0; border-bottom:0; }
  .aap-agent-header { padding-left:20px; }
  .aap-agent-body { padding:20px; }
  .aap-agent-footer { padding:16px 20px calc(16px + env(safe-area-inset-bottom, 0px)); gap:12px; }
}
`;
    const panel = element("section", "panel");
    panel.hidden = true;
    panel.id = "aap-agent-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "aap-agent-title");
    const header = element("div", "header");
    const heading = element("h2", "heading");
    const title = element("span", "heading-text", "A&AP agent");
    title.id = "aap-agent-title";
    heading.append(mark(), title);
    const close = element("button", "close", "Close");
    close.type = "button";
    header.append(heading, close);
    const body = element("div", "body");
    const intro = element("p", "intro");
    const context = element("p", "context");
    const suggestionBox = element("div", "suggestions");
    const conversation = element("div", "conversation");
    conversation.setAttribute("aria-live", "polite");
    conversation.setAttribute("aria-atomic", "true");
    const question = element("p", "question");
    const status = element("p", "status");
    const answer = element("article", "answer");
    const reply = element("p", "reply");
    answer.append(element("b", "answer-heading", "Desk reply"), reply);
    conversation.append(question, status, answer);
    body.append(intro, context, suggestionBox, conversation);
    const footer = element("div", "footer");
    const form = element("form", "form");
    form.autocomplete = "off";
    const field = element("div", "field");
    const input = element("input", "input");
    input.type = "text";
    input.placeholder = PLACEHOLDER;
    input.setAttribute("aria-label", PLACEHOLDER);
    const mic = element("button", "mic");
    mic.type = "button";
    mic.title = "Speak";
    mic.setAttribute("aria-label", "Speak");
    mic.setAttribute("aria-pressed", "false");
    mic.hidden = !(window.SpeechRecognition || window.webkitSpeechRecognition);
    mic.append(svg("0 0 24 24", [{ d: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-7-4v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" }], "mic-icon"));
    field.append(input, mic);
    const sendRow = element("div", "send-row");
    const send = element("button", "send", "Send");
    send.type = "submit";
    sendRow.append(send);
    const speech = element("p", "speech");
    speech.setAttribute("role", "status");
    form.append(field, sendRow, speech);
    footer.append(form, element("p", "disclosure", "AI agent"));
    panel.append(header, body, footer);
    const launch = element("button", "launch");
    launch.type = "button";
    launch.append(svg("0 0 24 24", [
      { d: "M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round" },
      { d: "M8 8.5h8M8 11.5h5", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }
    ], "launch-icon"), element("span", "launch-text", LABEL));
    launch.setAttribute("aria-label", LABEL);
    launch.setAttribute("aria-expanded", "false");
    launch.setAttribute("aria-controls", panel.id);
    launch.setAttribute("aria-haspopup", "dialog");
    root.append(style, panel, launch);
    ui = { root, panel, close, launch, title, intro, greeting: null, context, suggestions: suggestionBox, question, status, answer, reply, input, send, mic, form, speech };
    mountedScope = scope();
    launch.addEventListener("click", () => open(!opened));
    close.addEventListener("click", () => open(false));
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && opened) { event.preventDefault(); open(false); }
    });
    input.addEventListener("input", function () { drafts.set(scope(), input.value); renderConversation(); });
    form.addEventListener("submit", submit);
    mic.addEventListener("click", startSpeech);
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
      if (!options || typeof options.send !== "function") throw new TypeError("AAPAgent.init requires send.");
      config = { send: options.send, office: options.office || {} };
      if (document.body) mount();
      else document.addEventListener("DOMContentLoaded", mount, { once: true });
    },
    // The page's own "Ask your agent" buttons open this same panel.
    open: function () { if (ui && !opened) open(true); },
    update: function (next) {
      if (!next || typeof next !== "object") return;
      data = {
        route: next.route || "home", order: next.order || null,
        needs: Array.isArray(next.needs) ? next.needs : [],
        orders: Array.isArray(next.orders) ? next.orders : [],
        thread: Array.isArray(next.thread) ? next.thread : [], plan: next.plan || null
      };
      conversations.forEach((request, order) => recover(order, request));
      render();
    }
  });
})();
