"use strict";

/**
 * Momentos rápidos (T14.1, T14.4): agent y pre-commit sólo ejecutan checks
 * locales deterministas (contratos/manifest); los harness conductuales se
 * difieren a PR/release, que tienen presupuesto para ellos.
 */
const FAST_MOMENTS = Object.freeze(["agent", "pre-commit"]);

const isFastMoment = (moment) => FAST_MOMENTS.includes(moment);

/** Razón de warn cuando la evidencia conductual se difirió por momento. */
const deferredReason = (moment) => `BEHAVIOR_DEFERRED: en ${moment} sólo se validan contratos; los tests conductuales corren en PR/release.`;

module.exports = { FAST_MOMENTS, isFastMoment, deferredReason };
