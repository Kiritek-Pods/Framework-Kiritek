"use strict";

const readline = require("readline");

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(message, { defaultYes = true } = {}) {
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  const answer = (await ask(`${message} ${suffix} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "s" || answer === "si" || answer === "y" || answer === "yes";
}

async function confirmStacks(detected, known) {
  if (detected.length === 0) {
    console.log("No se detectó ningún stack conocido automáticamente.");
    const manual = await ask(
      `Stacks disponibles: ${known.join(", ")}\nEscribe los que aplican, separados por coma (o vacío para ninguno): `
    );
    return manual
      .split(",")
      .map((s) => s.trim())
      .filter((s) => known.includes(s));
  }

  const ok = await confirm(`Se detectó: ${detected.join(", ")}. ¿Instalar estos stack pack(s)?`);
  if (ok) return detected;

  const manual = await ask(
    `Escribe los stacks correctos, separados por coma (disponibles: ${known.join(", ")}): `
  );
  return manual
    .split(",")
    .map((s) => s.trim())
    .filter((s) => known.includes(s));
}

module.exports = { ask, confirm, confirmStacks };
