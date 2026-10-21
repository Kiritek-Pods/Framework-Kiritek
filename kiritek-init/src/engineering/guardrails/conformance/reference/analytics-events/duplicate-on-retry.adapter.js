"use strict";

// Adapter de referencia de analytics.events (duplicate-on-retry): duplica eventos al reintentar
// Simula los flujos de la app: cada evento del plan se emite con propiedades válidas.
const OPTS = {"duplicateOnRetry":true};

const sample = (p) => (p.enum ? p.enum[0] : p.type === "number" ? 1 : p.type === "boolean" ? true : "valor");

exports.createTrackerUnderTest = ({ clock, transport, plan, user }) => {
  
  let queue = [];
  let seq = 0;
  const send = async () => {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    try {
      await transport.send({ events: batch });
    } catch (err) {
      if (OPTS.throwOnFailure) throw err;
      if (!OPTS.noRequeue) queue = batch.concat(queue);
      if (OPTS.duplicateOnRetry) queue = batch.concat(batch, queue);
      clock.setTimeout(() => send().catch(() => {}), 5000);
    }
  };
  return {
    async trigger(name) {
      const spec = plan.find((e) => e.name === name);
      const properties = {};
      for (const p of spec.properties) if (p.required || OPTS.allProps) properties[p.name] = OPTS.wrongTypes && p.type === "number" ? "uno" : sample(p);
      if (OPTS.extraProps) properties.screen_width = 1280;
      if (OPTS.leakPii) properties.user_email = user.email;
      if (OPTS.skipRequired && spec.properties.some((p) => p.required)) delete properties[spec.properties.find((p) => p.required).name];
      const event = { name, properties, id: `evt-${++seq}` };
      queue.push(event);
      if (OPTS.doubleEmit) queue.push({ ...event, id: `evt-${++seq}` });
      if (OPTS.throwOnFailure) await send();
      else send().catch(() => {});
    },
    flush: () => send(),
  };
};
