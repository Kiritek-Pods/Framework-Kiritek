"use strict";

// Adapter de referencia de i18n.formatting (manual-date): arma fechas a mano (mes/día/año)
const OPTS = {"manualDate":true};

exports.createFormatterUnderTest = ({ locale, timeZone, currency, messages, defaultLocale }) => {
  
  const loc = OPTS.fixedLocale ? "en-US" : locale;
  const tz = OPTS.ignoreTimeZone ? "UTC" : timeZone;
  return {
    formatDate: (ms) => (OPTS.manualDate ? (() => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; })() : new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeZone: tz }).format(ms)),
    formatNumber: (n) => (OPTS.toFixed ? n.toFixed(2) : new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(n)),
    formatCurrency: (amount) => (OPTS.noCurrency ? new Intl.NumberFormat(loc).format(amount) : new Intl.NumberFormat(loc, { style: "currency", currency }).format(amount)),
    t(key) {
      const own = (messages[locale] || {})[key];
      if (own !== undefined) return own;
      if (OPTS.noFallback) return key;
      const def = (messages[defaultLocale] || {})[key];
      if (def !== undefined) return def;
      return OPTS.rawMissing ? key : "Texto no disponible";
    },
  };
};
