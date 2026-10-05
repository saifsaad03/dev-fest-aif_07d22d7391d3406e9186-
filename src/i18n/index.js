import { en, bn } from './strings.js';

const DICTIONARIES = { en, bn };
export const LOCALES = ['en', 'bn'];

let current = 'en';

/** @param {'en'|'bn'} locale */
export function setLocale(locale) {
  current = DICTIONARIES[locale] ? locale : 'en';
}

export function getLocale() {
  return current;
}

/**
 * Translate a key, interpolating `{placeholders}`.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function t(key, vars) {
  const table = DICTIONARIES[current] ?? en;
  let text = table[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Pick the right label from a `{ en, bn }` pair, falling back to English then
 * to the raw value.
 * @param {Record<string,string>|undefined} labels
 */
export function label(labels) {
  if (!labels) return '';
  return labels[current] ?? labels.en ?? Object.values(labels)[0] ?? '';
}