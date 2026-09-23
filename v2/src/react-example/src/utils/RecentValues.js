import { HTTP, WSS, transportOf } from './SignalingUrlUtils';

/*
 * Recently used signaling URLs, application names and stream names: per field, most recent
 * first, offered as suggestions. Signaling URLs are also kept per transport.
 * Never the auth token, TURN password or client IP: no credentials in local storage.
 */

const PREFIX = 'wz.recent.';
const LIMIT = 8;

const key = (field, scope) => `${PREFIX}${field}${scope ? `.${scope}` : ''}`;

const read = (storageKey) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    // Blocked or corrupted storage: no suggestions is a fine outcome.
    return [];
  }
};

const write = (storageKey, values) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // Not remembering is not a reason to fail the thing the user actually asked for.
  }
};

/*
 * Splits the old unscoped signaling URL list into the per-transport lists, once. Values
 * that are neither transport are dropped.
 */
const migrateSignalingUrls = () => {
  const legacy = key('signalingURL');
  let raw;
  try {
    raw = window.localStorage.getItem(legacy);
  } catch {
    return;
  }
  if (raw == null) return;

  const byTransport = { [WSS]: [], [HTTP]: [] };
  read(legacy).forEach((value) => {
    const transport = transportOf(value);
    if (transport) byTransport[transport].push(value);
  });

  [WSS, HTTP].forEach((transport) => {
    const target = key('signalingURL', transport);
    const merged = [...byTransport[transport], ...read(target)];
    const deduped = merged.filter((v, i) => merged.indexOf(v) === i).slice(0, LIMIT);
    if (deduped.length) write(target, deduped);
  });

  try {
    window.localStorage.removeItem(legacy);
  } catch {
    // Leaving it behind costs nothing: the merge above is idempotent.
  }
};

let migrated = false;

const ready = (field) => {
  if (migrated || field !== 'signalingURL') return;
  migrated = true;
  migrateSignalingUrls();
};

export const readRecent = (field, scope = null) => {
  ready(field);
  return read(key(field, scope));
};

/** Most recent first, no duplicates, capped. Blank values are not worth remembering. */
export const rememberValue = (field, value, scope = null) => {
  const text = String(value ?? '').trim();
  if (text === '') return readRecent(field, scope);

  const next = [text, ...readRecent(field, scope).filter((v) => v !== text)].slice(0, LIMIT);
  write(key(field, scope), next);
  return next;
};

/** Drop one remembered value, for the button beside it in the suggestion list. */
export const forgetValue = (field, value, scope = null) => {
  const next = readRecent(field, scope).filter((v) => v !== value);
  write(key(field, scope), next);
  return next;
};

