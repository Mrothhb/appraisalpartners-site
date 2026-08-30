import {
  SCOPES,
  STAGES,
  WAITING_NOTE,
  decryptStatus,
  formatCentralTime,
  formatPrice,
  notificationDelivery,
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
  const definition = stageDefinition(payload.stage);
  const activeIndex = definition.index;

  setText("stage-name", definition.label);
  setText("stage-count", `Checkpoint ${activeIndex + 1} of ${STAGES.length}`);
  const progress = byId("progress-track");
  progress.setAttribute("aria-valuenow", String(activeIndex + 1));
  byId("progress-fill").style.width = `${((activeIndex + 1) / STAGES.length) * 100}%`;

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

const MILESTONES = [
  { label: "Submitted", codes: ["submitted", "intake"] },
  { label: "Accepted", codes: ["accepted"] },
  { label: "In production", codes: ["research", "comparables", "drafting", "review"] },
  { label: "Ready for you", codes: ["ready"] },
  { label: "Complete", codes: ["complete"] },
];

function renderTracker(payload) {
  const tracker = byId("status-tracker");
  if (!tracker) return;
  tracker.replaceChildren();
  const active = MILESTONES.findIndex((m) => m.codes.includes(payload.stage));

  for (const [index, milestone] of MILESTONES.entries()) {
    const item = document.createElement("li");
    item.className = index < active ? "done" : index === active ? "now" : "";
    if (index === active) item.setAttribute("aria-current", "step");

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");

    const step = document.createElement("span");
    step.className = "step";
    step.textContent = milestone.label;

    item.append(dot, step);
    tracker.append(item);
  }
}

function renderNotifications(payload) {
  const delivery = notificationDelivery(payload.notifications);
  setText("notification-mode", delivery.label);
  setText("email-setting", delivery.email ? "On" : "Off");
  setText("text-setting", delivery.text ? "Active" : "Not selected");
  setText(
    "milestone-copy",
    delivery.email || delivery.text
      ? `Standard alerts: accepted · waiting on you · ready for review${payload.long_window ? " · research complete on this longer turn" : ""}.`
      : "No email or text alerts are selected. Every checkpoint stays visible on this page.",
  );

  if (payload.demo) {
    setText("demo-email", `AP-${payload.order}: research done, drafting now`);
    setText(
      "demo-text",
      `Appraisal Partners AP-${payload.order}: research is complete and drafting has started. Still on track. [private status link] Reply STOP to opt out.`,
    );
    byId("demo-notification-examples").hidden = false;
  } else {
    byId("demo-notification-examples").hidden = true;
  }
}

function render(payload) {
  setText("order-number", `AP-${payload.order}`);
  setText("direction-order", `AP-${payload.order}`);
  setText("current-note", pageNote(payload));
  setText("last-updated", formatCentralTime(payload.updated_at));
  renderTracker(payload);
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
