import { HTTP, WSS, transportOf } from './SignalingUrlUtils';

/*
 * The handful of values worth not typing twice.
 *
 * Signalling URLs, application names and stream names get retyped constantly while testing,
 * and they are exactly the fields where a typo produces a confusing failure rather than an
 * obvious one. They are kept per field, most recent first, and offered as suggestions
 * rather than as a closed list: typing something new is always allowed.
 *
 * Signalling URLs are additionally kept per transport. A wss:// URL and an https:// origin
 * are not alternatives to each other, so offering the WHIP origins while WSS is selected is
 * offering values that cannot work, and it doubles the length of the list to do it.
 *
 * Deliberately not the auth token, the TURN password or the client IP. Remembering a
 * credential in local storage and offering it in a dropdown is not a convenience worth
 * having in an example other people will copy.
 */

const PREFIX = 'wz.recent.';
const LIMIT = 8;

export const RECENT_FIELDS = ['signalingURL', 'applicationName', 'streamName'];

/** The fields kept separately per transport. */
export const SCOPED_FIELDS = ['signalingURL'];

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
 * Splits a pre-existing unscoped signalling URL list into the two transport lists, once.
 *
 * Without this, everything remembered before the split silently disappears from the panel,
 * which is the opposite of what a memory is for. Values that cannot be read as either
 * transport are dropped rather than guessed at.
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

export const forgetRecent = (field, scope = null) => {
  try {
    window.localStorage.removeItem(key(field, scope));
  } catch {
    // Nothing to do.
  }
};
