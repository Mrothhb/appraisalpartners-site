import {
  NOTIFICATION_MODES,
  SCOPES,
  STAGES,
  WAITING_NOTE,
  decryptStatus,
  formatCentralTime,
  formatPrice,
  pageNote,
  parseCapabilityFragment,
  stageDefinition,
  workflowSummary,
} from "./status-core.mjs";

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  byId(id).textContent = value;
}

function showError() {
  byId("loading").hidden = true;
  byId("status-panel").hidden = true;
  byId("error-panel").hidden = false;
}

function renderRail(payload) {
  const rail = byId("status-rail");
  rail.replaceChildren();
  const activeIndex = stageDefinition(payload.stage).index;

  for (const [index, stage] of STAGES.entries()) {
    const item = document.createElement("li");
    item.className = index < activeIndex ? "complete" : index === activeIndex ? "active" : "upcoming";
    if (index === activeIndex) item.setAttribute("aria-current", "step");

    const marker = document.createElement("span");
    marker.className = "rail-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = index < activeIndex ? "✓" : String(index + 1);

    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = stage.label;
    item.append(marker, label);
    rail.append(item);
  }
}

function renderNotifications(payload) {
  setText("notification-mode", NOTIFICATION_MODES[payload.notifications]);
  const emailEnabled = payload.notifications === "email";
  setText("email-setting", emailEnabled ? "On" : "Off");
  byId("research-milestone").hidden = !payload.long_window || !emailEnabled;

  if (payload.demo) {
    setText("demo-email", `AP-${payload.order}: research done, drafting now`);
    byId("demo-notification-examples").hidden = false;
  } else {
    byId("demo-notification-examples").hidden = true;
  }
}

function render(payload) {
  setText("order-number", `AP-${payload.order}`);
  setText("current-note", pageNote(payload));
  setText("last-updated", formatCentralTime(payload.updated_at));
  renderRail(payload);
  renderNotifications(payload);

  const summary = workflowSummary(payload);
  setText("what-happened", summary.happened);
  setText("what-next", summary.next);
  setText("who-acts", summary.actor);

  const accepted = payload.scope !== null;
  const isTrial = payload.scope === "prior-assignment-trial";
  setText("scope", accepted ? SCOPES[payload.scope] : "Pending acceptance");
  setText("price", accepted ? formatPrice(payload.price_cents, payload.scope) : "Pending acceptance");
  setText(
    "return-time",
    accepted
      ? formatCentralTime(payload.committed_return)
      : "Pending acceptance",
  );
  setText("return-label", isTrial ? "Illustrative trial return" : accepted ? "Committed return" : "Return time");

  byId("waiting-banner").hidden = !payload.waiting_on_you;
  if (payload.waiting_on_you) byId("waiting-banner").textContent = WAITING_NOTE;
  byId("demo-banner").hidden = !isTrial;

  byId("loading").hidden = true;
  byId("error-panel").hidden = true;
  byId("status-panel").hidden = false;
}

async function loadStatus() {
  try {
    const { recordId, keyBytes } = parseCapabilityFragment(window.location.hash);
    const response = await fetch(`status-data/${recordId}.json?refresh=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Status record unavailable.");
    const raw = await response.text();
    if (raw.length > 20000) throw new Error("Status record is too large.");
    const payload = await decryptStatus(JSON.parse(raw), recordId, keyBytes);
    render(payload);
  } catch {
    showError();
  }
}

loadStatus();
