const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export const STATUS_SCHEMA = 1;
export const CAPABILITY_VERSION = "v1";

function workflow(happened, next, actor) {
  return Object.freeze({ happened, next, actor });
}

export const STAGES = Object.freeze([
  Object.freeze({
    code: "submitted",
    label: "Submitted",
    note: "Submitted. Waiting for scope review.",
    workflow: workflow(
      "Your request was received.",
      "Matt reviews the request and packet before deciding whether to accept it.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "intake",
    label: "Scope review",
    note: "Scope review in progress.",
    workflow: workflow(
      "Matt started the scope review.",
      "Matt confirms the scope, price, and return time, or asks for what is missing.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "accepted",
    label: "Accepted · due date set",
    note: "Accepted. Return committed for {TIME}.",
    trialNote: "Accepted. Illustrative trial return: {TIME}.",
    workflow: workflow(
      "Scope, price, and the committed return were confirmed.",
      "Market research begins.",
      "Matt",
    ),
    trialWorkflow: workflow(
      "The $0 trial scope and illustrative return were confirmed.",
      "Market research begins.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "research",
    label: "Market research",
    note: "Market research in progress.",
    workflow: workflow(
      "The report was accepted and market research began.",
      "Matt prepares the comparable selection.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "comparables",
    label: "Comparable selection",
    note: "Comparable selection prepared.",
    workflow: workflow(
      "The comparable selection was prepared.",
      "Report development begins. Reply in the order thread if you want to steer the set.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "drafting",
    label: "Report development",
    note: "Report development in progress.",
    workflow: workflow(
      "The comparable selection was made and report development began.",
      "Matt completes the draft and performs his review.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "review",
    label: "In review",
    note: "In review against the source data.",
    workflow: workflow(
      "Report development finished and the review began.",
      "Matt returns the draft for your independent review.",
      "Matt",
    ),
  }),
  Object.freeze({
    code: "ready",
    label: "Ready for your review",
    note: "Ready for your independent review.",
    workflow: workflow(
      "The draft was placed in the private order folder for your review.",
      "Review it, send one consolidated direction list, then adopt or revise and sign in your software.",
      "You",
    ),
  }),
  Object.freeze({
    code: "complete",
    label: "Complete",
    note: "Complete.",
    workflow: workflow(
      "The production work and included review cycle were completed.",
      "No action is required unless a traced client or underwriter condition arrives.",
      "No one right now",
    ),
  }),
]);

export const WAITING_NOTE = "Waiting on one item from you. Check your order thread.";
export const WAITING_WORKFLOW = workflow(
  "Matt paused production and sent the specific request in the order thread.",
  "Send the requested item in the order thread. Production resumes when it arrives.",
  "You",
);

export const SCOPES = Object.freeze({
  "packet-to-draft": "Packet-to-Draft",
  "research-and-draft": "Research + Draft",
  "prior-assignment-trial": "Prior-assignment trial",
});

export const NOTIFICATION_MODES = Object.freeze({
  page: "Status page only",
  email: "Email",
  sms: "Text",
  both: "Email + text",
});

export function notificationDelivery(mode) {
  if (!Object.hasOwn(NOTIFICATION_MODES, mode)) throw new Error("Unknown notification mode.");
  return Object.freeze({
    label: NOTIFICATION_MODES[mode],
    email: mode === "email" || mode === "both",
    text: mode === "sms" || mode === "both",
  });
}

const STAGE_BY_CODE = new Map(STAGES.map((stage, index) => [stage.code, { ...stage, index }]));
const PAYLOAD_KEYS = Object.freeze([
  "schema",
  "order",
  "stage",
  "waiting_on_you",
  "scope",
  "price_cents",
  "committed_return",
  "updated_at",
  "notifications",
  "long_window",
  "demo",
]);
const ENVELOPE_KEYS = Object.freeze(["schema", "alg", "iv", "ciphertext"]);
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ORDER_PATTERN = /^\d{4,10}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function getCrypto(cryptoImplementation) {
  const implementation = cryptoImplementation ?? globalThis.crypto;
  if (!implementation?.subtle || typeof implementation.getRandomValues !== "function") {
    throw new Error("Web Crypto is unavailable.");
  }
  return implementation;
}

function assertExactKeys(value, allowedKeys, label) {
  const keys = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains an unknown or missing field.`);
  }
}

function assertRfc3339(value, label) {
  if (typeof value !== "string" || !RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an RFC 3339 time with a timezone.`);
  }
}

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function newRandomBytes(length, cryptoImplementation) {
  const bytes = new Uint8Array(length);
  getCrypto(cryptoImplementation).getRandomValues(bytes);
  return bytes;
}

export function validateRecordId(recordId) {
  if (typeof recordId !== "string" || !RECORD_ID_PATTERN.test(recordId)) {
    throw new Error("Invalid status record identifier.");
  }
  return recordId;
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Status payload must be an object.");
  }
  assertExactKeys(payload, PAYLOAD_KEYS, "Status payload");

  if (payload.schema !== STATUS_SCHEMA) throw new Error("Unsupported status payload schema.");
  if (typeof payload.order !== "string" || !ORDER_PATTERN.test(payload.order)) {
    throw new Error("Order must be a neutral 4-10 digit identifier.");
  }
  if (!STAGE_BY_CODE.has(payload.stage)) throw new Error("Status is not in the approved phrasebook.");
  if (typeof payload.waiting_on_you !== "boolean") throw new Error("waiting_on_you must be boolean.");
  if (payload.scope !== null && !Object.hasOwn(SCOPES, payload.scope)) throw new Error("Unknown scope.");
  if (payload.price_cents !== null && (!Number.isInteger(payload.price_cents) || payload.price_cents < 0 || payload.price_cents > 999999)) {
    throw new Error("Price must be an allowed non-negative amount.");
  }
  if (payload.committed_return !== null) assertRfc3339(payload.committed_return, "Committed return");
  assertRfc3339(payload.updated_at, "Updated time");
  if (!Object.hasOwn(NOTIFICATION_MODES, payload.notifications)) throw new Error("Unknown notification mode.");
  if (typeof payload.long_window !== "boolean") throw new Error("long_window must be boolean.");
  if (typeof payload.demo !== "boolean") throw new Error("demo must be boolean.");
  if (payload.waiting_on_you && payload.stage === "complete") throw new Error("A complete order cannot be waiting on the appraiser.");

  const accepted = STAGE_BY_CODE.get(payload.stage).index >= STAGE_BY_CODE.get("accepted").index;
  const acceptedFields = [payload.scope, payload.price_cents, payload.committed_return];
  if (accepted && acceptedFields.some((value) => value === null)) {
    throw new Error("Accepted scope, price, and return time are required after acceptance.");
  }
  if (!accepted && acceptedFields.some((value) => value !== null)) {
    throw new Error("Scope, price, and return time cannot appear before acceptance.");
  }
  if (payload.scope === "prior-assignment-trial" && payload.price_cents !== 0) {
    throw new Error("The prior-assignment trial price must be zero.");
  }
  if (payload.scope !== "prior-assignment-trial" && payload.price_cents === 0) {
    throw new Error("A zero price is reserved for the prior-assignment trial.");
  }

  return Object.freeze({ ...payload });
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Status envelope must be an object.");
  }
  assertExactKeys(envelope, ENVELOPE_KEYS, "Status envelope");
  if (envelope.schema !== STATUS_SCHEMA || envelope.alg !== "A256GCM") {
    throw new Error("Unsupported status envelope.");
  }
  const iv = base64UrlToBytes(envelope.iv);
  if (iv.length !== 12) throw new Error("Invalid status envelope IV.");
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > 16384) throw new Error("Invalid status ciphertext length.");
  return envelope;
}

function additionalData(recordId) {
  return textEncoder.encode(`appraisal-partners-status-v1/${validateRecordId(recordId)}`);
}

export async function encryptStatus(payload, recordId, keyBytes, cryptoImplementation, ivBytes) {
  const crypto = getCrypto(cryptoImplementation);
  const checkedPayload = validatePayload(payload);
  validateRecordId(recordId);
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) throw new Error("Status key must be 32 bytes.");
  const iv = ivBytes ?? newRandomBytes(12, crypto);
  if (!(iv instanceof Uint8Array) || iv.length !== 12) throw new Error("Status IV must be 12 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const plaintext = textEncoder.encode(JSON.stringify(checkedPayload));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(recordId), tagLength: 128 },
    key,
    plaintext,
  );
  return Object.freeze({
    schema: STATUS_SCHEMA,
    alg: "A256GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
  });
}

export async function decryptStatus(envelope, recordId, keyBytes, cryptoImplementation) {
  const crypto = getCrypto(cryptoImplementation);
  validateEnvelope(envelope);
  validateRecordId(recordId);
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) throw new Error("Status key must be 32 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(envelope.iv),
      additionalData: additionalData(recordId),
      tagLength: 128,
    },
    key,
    base64UrlToBytes(envelope.ciphertext),
  );
  return validatePayload(JSON.parse(textDecoder.decode(decrypted)));
}

export function buildCapabilityFragment(recordId, keyBytes) {
  validateRecordId(recordId);
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) throw new Error("Status key must be 32 bytes.");
  return `#${CAPABILITY_VERSION}.${recordId}.${bytesToBase64Url(keyBytes)}`;
}

export function parseCapabilityFragment(fragment) {
  if (typeof fragment !== "string") throw new Error("Status link is missing.");
  const match = fragment.match(/^#?v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u);
  if (!match) throw new Error("Status link is invalid.");
  const keyBytes = base64UrlToBytes(match[2]);
  if (!KEY_PATTERN.test(match[2]) || keyBytes.length !== 32) throw new Error("Status link key is invalid.");
  return Object.freeze({ recordId: validateRecordId(match[1]), keyBytes });
}

export function stageDefinition(stageCode) {
  const definition = STAGE_BY_CODE.get(stageCode);
  if (!definition) throw new Error("Unknown stage.");
  return definition;
}

export function formatCentralTime(value, includeWeekday = true) {
  assertRfc3339(value, "Time");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: includeWeekday ? "long" : undefined,
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const day = `${part("month")} ${part("day")}`;
  const time = `${part("hour")}:${part("minute")} ${part("dayPeriod")} CT`;
  return includeWeekday ? `${part("weekday")}, ${day} at ${time}` : `${day} at ${time}`;
}

export function formatPrice(priceCents, scopeCode) {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error("Invalid price.");
  if (scopeCode === "prior-assignment-trial" && priceCents === 0) return "$0 free trial";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(priceCents / 100);
}

export function pageNote(payload) {
  const checkedPayload = validatePayload(payload);
  if (checkedPayload.waiting_on_you) return WAITING_NOTE;
  const definition = stageDefinition(checkedPayload.stage);
  if (checkedPayload.stage === "accepted") {
    const template = checkedPayload.scope === "prior-assignment-trial" ? definition.trialNote : definition.note;
    return template.replace("{TIME}", formatCentralTime(checkedPayload.committed_return));
  }
  return definition.note;
}

export function workflowSummary(payload) {
  const checkedPayload = validatePayload(payload);
  if (checkedPayload.waiting_on_you) return WAITING_WORKFLOW;
  const definition = stageDefinition(checkedPayload.stage);
  if (checkedPayload.stage === "accepted" && checkedPayload.scope === "prior-assignment-trial") {
    return definition.trialWorkflow;
  }
  return definition.workflow;
}
