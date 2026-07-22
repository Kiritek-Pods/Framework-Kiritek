"use strict";

const readline = require("readline");

// Cuando stdin llega por pipe (CI, tests, `echo x | npx ...`), Node puede
// entregar varias líneas en un solo evento 'data' y procesarlas todas de
// golpe — antes de que nuestro código alcance a llamar rl.question() de
// nuevo para la siguiente pregunta. rl.question() descarta cualquier línea
// que llegue sin una pregunta pendiente en ese instante, así que la 2da/3ra
// respuesta se pierde y el CLI se cuelga esperando una respuesta que ya
// estaba en el buffer. Por eso NO usamos rl.question(): escuchamos 'line'
// directo y encolamos, así no importa cuándo llegó el dato vs. cuándo se
// pidió — se consume en orden de todos modos.
let rl = null;
const lineQueue = [];
const waiters = [];

function getInterface() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lineQueue.push(line);
    });
  }
  return rl;
}

function nextLine() {
  getInterface();
  if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => waiters.push(resolve));
}

async function ask(question) {
  process.stdout.write(question);
  const line = await nextLine();
  return line.trim();
}

function closePrompts() {
  if (rl) {
    rl.close();
    rl = null;
  }
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

module.exports = { ask, confirm, confirmStacks, closePrompts };
