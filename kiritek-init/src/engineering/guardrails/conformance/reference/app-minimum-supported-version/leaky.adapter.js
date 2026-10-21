"use strict";
// Devuelve tokens de dispositivo/cuenta/store en la decisión y los imprime:
// el harness debe descartarlos y aislar stdout.
const good = require("./good.adapter.js");
exports.createVersionGateUnderTest = (deps) => {
  const sut = good.make({ extra: { deviceToken: "KCANARY-device-1f2e", accountId: "KCANARY-account-9a8b", storeToken: "KCANARY-store-7c6d" } })(deps);
  return {
    async evaluate() {
      console.log("deviceToken=KCANARY-device-1f2e");
      process.stdout.write("store KCANARY-store-7c6d\n");
      return sut.evaluate();
    },
  };
};
