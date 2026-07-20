import assert from "node:assert/strict";
import test from "node:test";

import handler from "../api/chat.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("autos consulta la herramienta única, normaliza 34M y conserva los campos útiles", async () => {
  const fetchOriginal = global.fetch;
  const requestsLlm = [];
  delete process.env.LOG_TURSO_DATABASE_URL;

  global.fetch = async (url, init = {}) => {
    const destino = String(url);
    if (destino.includes("usados_filter_vehicles")) {
      return jsonResponse({
        data: [{
          id: 35,
          tipo: "SUV",
          marca: "VW",
          modelo: "Nivus",
          version: "Comfortline",
          ano: "2022",
          kilometros: "35000",
          motor: "1.0T",
          transmision: "Automática",
          combustible: "Nafta",
          precio: "$28.000.000",
          precio_numerico: "28000000",
          disponibilidad: "Stock Físico",
          imagen_url: "https://example.com/nivus.jpg",
          galeria: ["https://example.com/nivus-2.jpg"],
          descripcion: "Descripción extensa",
          fecha_creacion: "2026-01-01",
        }],
      });
    }

    const body = JSON.parse(init.body);
    requestsLlm.push(body);
    if (body.max_tokens === 5) {
      return jsonResponse({
        choices: [{ message: { content: "simple" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 1 },
      });
    }

    const yaTieneResultado = body.messages.some((m) => m.role === "tool");
    if (!yaTieneResultado) {
      return jsonResponse({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "tool-1",
              type: "function",
              function: {
                name: "buscar_vehiculo",
                arguments: JSON.stringify({ tipo: "suv", transmision: "automatica", presupuesto_max: 34 }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 5 },
      });
    }

    return jsonResponse({
      choices: [{
        message: { content: "**VW Nivus Comfortline**\n[Más info](https://example.com/nivus/)" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 120, completion_tokens: 20 },
    });
  };

  try {
    let statusCode = 0;
    let payload;
    const req = {
      method: "POST",
      body: {
        system: "El stock se consulta únicamente mediante buscar_vehiculo.",
        messages: [{ role: "user", content: "Busco una SUV automática hasta 34M" }],
        agente: "autos",
        negocio: "usadosnuevos",
        convId: "test-autos",
      },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { payload = data; return data; },
    };

    await handler(req, res);

    assert.equal(statusCode, 200);
    assert.equal(payload.metrics, undefined);
    assert.equal(
      payload.content[0].text,
      "*VW Nivus Comfortline*\nMás info: https://example.com/nivus/"
    );
    const primeraRonda = requestsLlm.find((r) => r.tools && !r.messages.some((m) => m.role === "tool"));
    assert.match(primeraRonda.tools[0].function.description, /ÚNICA fuente de stock/);
    const rondaConResultado = requestsLlm.find((r) => r.messages.some((m) => m.role === "tool"));
    assert.ok(rondaConResultado);
    const resultadoTool = JSON.parse(rondaConResultado.messages.find((m) => m.role === "tool").content);
    assert.equal(resultadoTool.resultados.length, 1);
    assert.equal(resultadoTool.resultados[0].modelo, "Nivus");
    assert.equal(resultadoTool.resultados[0].version, "Comfortline");
    assert.equal(resultadoTool.resultados[0].motor, "1.0T");
    assert.equal(resultadoTool.resultados[0].imagen_url, undefined);
    assert.equal(resultadoTool.resultados[0].galeria, undefined);
    assert.equal(resultadoTool.resultados[0].descripcion, undefined);
    assert.equal(resultadoTool.resultados[0].fecha_creacion, undefined);
  } finally {
    global.fetch = fetchOriginal;
  }
});
