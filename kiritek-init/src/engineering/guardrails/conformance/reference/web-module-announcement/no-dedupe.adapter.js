"use strict";
// Siempre muestra el anuncio (sin show-once).
exports.createAnnouncementUnderTest = require("./good.adapter.js").make({ noDedupe: true });
