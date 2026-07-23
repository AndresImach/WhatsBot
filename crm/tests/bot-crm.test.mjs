import assert from "node:assert/strict";
import test from "node:test";

process.env.CRM_API_URL = "https://crm.example.test";
process.env.CRM_API_KEY = "wbk_test";
const { registrarMensajeSeguro, CRM_TIMEOUT_MS } = await import("../../bot/lib/crm.js");
const { historialParaRespuesta } = await import("../../bot/api/webhook.js");

test("cliente del bot usa Bearer y devuelve la respuesta del CRM", async () => {
  let llamada;
  const anterior = global.fetch;
  global.fetch = async (url, options) => {
    llamada = { url, options };
    return { ok: true, json: async () => ({ estado: "bot", historial: [] }) };
  };
  try {
    const resultado = await registrarMensajeSeguro({
      numero: "549381000000",
      rol: "user",
      contenido: "hola",
    });
    assert.equal(resultado.estado, "bot");
    assert.equal(llamada.url, "https://crm.example.test/api/ingest/mensaje");
    assert.equal(llamada.options.headers.Authorization, "Bearer wbk_test");
    assert.equal(CRM_TIMEOUT_MS, 2000);
  } finally {
    global.fetch = anterior;
  }
});

test("una caída reintenta, continúa y no vuelca teléfono ni contenido al log", async () => {
  const anteriorFetch = global.fetch;
  const anteriorError = console.error;
  let intentos = 0;
  const logs = [];
  global.fetch = async () => {
    intentos += 1;
    const error = new Error("timeout simulado");
    error.name = "AbortError";
    throw error;
  };
  console.error = (linea) => logs.push(String(linea));
  try {
    const resultado = await registrarMensajeSeguro(
      { numero: "5493811234567", rol: "user", contenido: "contenido privado" },
      { etapa: "test", messageId: "wamid.test" }
    );
    assert.equal(resultado, null);
    assert.equal(intentos, 2);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /5493811234567|contenido privado/);
    assert.match(logs[0], /crm_delivery_failed/);
    assert.deepEqual(historialParaRespuesta(resultado, "mensaje actual"), [
      { role: "user", content: "mensaje actual" },
    ]);
  } finally {
    global.fetch = anteriorFetch;
    console.error = anteriorError;
  }
});
