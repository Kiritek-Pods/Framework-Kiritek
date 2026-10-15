"use strict";
// Pausar/retirar el anuncio retira también el módulo.
exports.createAnnouncementUnderTest = require("./good.adapter.js").make({ retireHidesModule: true });
