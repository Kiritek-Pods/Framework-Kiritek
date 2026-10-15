"use strict";

/**
 * Harness conductual de localización (T27.2). Compara la capa de formato del
 * equipo contra `Intl` (ICU de la plataforma). Framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su capa de i18n real):
 *
 *   createFormatterUnderTest({
 *     locale,        // locale del usuario (p. ej. "es-CL")
 *     timeZone,      // zona horaria del usuario (IANA)
 *     currency,      // moneda del contrato
 *     messages,      // { [locale]: { [key]: texto } } sintéticos
 *     defaultLocale,
 *   }) → { formatDate(epochMs), formatNumber(n), formatCurrency(amount), t(key) }
 *
 * La traza sólo lleva booleanos: nunca los textos formateados.
 */

const { messageState } = require("../shared/message-state.js");
const { scenariosFor, slug } = require("./scenarios.js");

const HARNESS = { name: "kiritek-i18n-harness", version: "1.0.0" };
const DATE = Date.UTC(2026, 2, 4, 15, 0, 0); // 4 de marzo de 2026, 15:00 UTC
// Instantes donde el día local difiere del de UTC: al este (23:30 UTC del 4)
// o al oeste (02:00 UTC del 5) de Greenwich.
const INSTANTS = [Date.UTC(2026, 2, 4, 23, 30, 0), Date.UTC(2026, 2, 5, 2, 0, 0)];
const NUMBER = 1234567.891;
const AMOUNT = 1234; // entero: válido también en monedas sin decimales (CLP, JPY)
const FALLBACK_CANDIDATES = ["fr-FR", "it-IT", "de-DE", "ja-JP"];

const digits = (s) => String(s).replace(/[^\d]/g, "");

/** Orden esperado (day/month/year) según Intl para el locale. */
function dateOrder(locale) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" })
    .formatToParts(DATE)
    .filter((p) => ["day", "month", "year"].includes(p.type))
    .map((p) => p.type);
}

function checkDate(out, locale) {
  const s = String(out);
  if (!s.includes("2026")) return false;
  const tokens = s.match(/\d+/g) || [];
  const day = tokens.findIndex((x) => Number(x) === 4);
  const month = tokens.findIndex((x, i) => Number(x) === 3 && i !== day);
  if (day === -1) return false;
  if (month === -1) return true; // mes con nombre: el orden numérico no aplica
  const order = dateOrder(locale);
  return order.indexOf("day") < order.indexOf("month") ? day < month : month < day;
}

function separators(locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(NUMBER);
  return { decimal: (parts.find((p) => p.type === "decimal") || {}).value || ".", group: (parts.find((p) => p.type === "group") || {}).value || "" };
}

function checkNumber(out, locale) {
  const s = String(out).replace(/\s| | /g, " ");
  const { decimal } = separators(locale);
  if (!digits(s).startsWith("1234567")) return false;
  const idx = s.lastIndexOf(decimal);
  return idx !== -1 && /^\d/.test(s.slice(idx + 1)) && digits(s.slice(idx + 1)).startsWith("89");
}

function checkCurrency(out, locale, currency) {
  const s = String(out);
  const names = new Set([currency]);
  for (const display of ["symbol", "narrowSymbol", "code"]) {
    try {
      const p = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: display }).formatToParts(AMOUNT).find((x) => x.type === "currency");
      if (p) names.add(p.value);
    } catch (_) {
      /* display no soportado en esta versión de ICU */
    }
  }
  return [...names].some((n) => s.includes(n)) && digits(s).startsWith("1234");
}

const dayIn = (ms, timeZone) => Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(ms));

/** Instante cuyo día en la zona difiere del día en UTC (siempre existe salvo zonas UTC±0). */
function instantFor(timeZone) {
  return INSTANTS.find((ms) => dayIn(ms, timeZone) !== dayIn(ms, "UTC")) || INSTANTS[0];
}

function checkTimeZone(out, ms, timeZone) {
  const want = dayIn(ms, timeZone);
  const utc = dayIn(ms, "UTC");
  const tokens = (String(out).match(/\d+/g) || []).map(Number);
  return tokens.includes(want) && (want === utc || !tokens.includes(utc));
}

const TIME_ZONES = { CL: "America/Santiago", AR: "America/Argentina/Buenos_Aires", MX: "America/Mexico_City", US: "America/New_York", ES: "Europe/Madrid", BR: "America/Sao_Paulo", JP: "Asia/Tokyo" };
/** Zona horaria del escenario: donde el instante LATE cae en un día distinto a UTC si se puede. */
const zoneFor = (locale) => TIME_ZONES[(locale.split("-")[1] || "").toUpperCase()] || "Asia/Tokyo";

function messagesFor(locales, defaultLocale) {
  const out = {};
  for (const l of new Set([...locales, defaultLocale])) out[l] = { "greeting.title": `Hola-${l}` };
  return out;
}

function runScenario(id, factory, p) {
  const [scenario, locSlug] = id.split("@");
  const locale = locSlug ? p.locales.find((l) => slug(l) === locSlug) : scenario === "fallback" ? FALLBACK_CANDIDATES.find((l) => !p.locales.includes(l)) : p.defaultLocale;
  const timeZone = scenario === "timezone" ? zoneFor(locale) : "UTC";
  let sut;
  try {
    sut = factory({ locale, timeZone, currency: p.currency, messages: messagesFor(p.locales, p.defaultLocale), defaultLocale: p.defaultLocale });
    if (!sut || typeof sut !== "object") throw new Error("sin formateador");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const call = (name, ...args) => {
    if (typeof sut[name] !== "function") return { threw: true };
    try {
      return { threw: false, v: sut[name](...args) };
    } catch (_) {
      return { threw: true };
    }
  };
  let r;
  let ok;
  if (scenario === "date") (r = call("formatDate", DATE)), (ok = !r.threw && checkDate(r.v, locale));
  else if (scenario === "number") (r = call("formatNumber", NUMBER)), (ok = !r.threw && checkNumber(r.v, locale));
  else if (scenario === "currency") (r = call("formatCurrency", AMOUNT)), (ok = !r.threw && checkCurrency(r.v, locale, p.currency));
  else if (scenario === "timezone") {
    const ms = instantFor(timeZone);
    r = call("formatDate", ms);
    ok = !r.threw && checkTimeZone(r.v, ms, timeZone);
  }
  else if (scenario === "fallback") (r = call("t", "greeting.title")), (ok = !r.threw && r.v === `Hola-${p.defaultLocale}`);
  else {
    r = call("t", "kiritek.missing.key");
    return { id, status: "ok", steps: [{ threw: r.threw, message: r.threw ? "empty" : messageState(r.v) }] };
  }
  return { id, status: "ok", steps: [{ threw: r.threw, ok: !!ok }] };
}

async function runSuite(factory, params) {
  const scenarios = scenariosFor(params).map((id) => runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, checkDate, checkNumber, checkCurrency, checkTimeZone, zoneFor, instantFor };
