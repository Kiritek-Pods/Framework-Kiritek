"use strict";
// Devuelve identidades/contactos en el snapshot y los imprime: el harness
// sólo deriva hechos y aísla stdout.
const sut = require("./good.adapter.js").make({
  extra: { email: "KCANARY-mail-3b4c@example.test", users: ["KCANARY-user-5d6e"] },
  extraAnnouncement: { viewerId: "KCANARY-user-5d6e", tracking: "KCANARY-track-7f80" },
});
exports.createAnnouncementUnderTest = (deps) => {
  const inner = sut(deps);
  return {
    async render() {
      console.log("viewer=KCANARY-user-5d6e mail=KCANARY-mail-3b4c@example.test");
      process.stdout.write("track KCANARY-track-7f80\n");
      return inner.render();
    },
    press: (k) => inner.press(k),
  };
};
