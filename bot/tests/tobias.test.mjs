import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENROUTER_API_KEY = "test-openrouter";
process.env.TURSO_DATABASE_URL = "libsql://catalogo.test";
process.env.TURSO_AUTH_TOKEN = "test-turso";
process.env.MODEL_ROUTER = "router-test";
process.env.MODEL_EXPERTO = "principal-test";

const { nombreCoincide, ejecutarHerramientaTobias } = await import("../lib/tobias.js");
const { formatearWhatsApp } = await import("../lib/formato.js");
const { responder } = await import("../lib/router.js");

test("la validación de nombres tolera formato pero rechaza otro producto", () => {
  assert.equal(
    nombreCoincide("MERMELADA FRUTOS ROJOS X 380 GR", "Mermelada frutos rojos x380gr"),
    true
  );
  assert.equal(
    nombreCoincide("PIROTIN DORADO", "MERMELADA FRUTOS ROJOS X 380 GR"),
    false
  );
});

test("la salida convierte tablas y Markdown al formato visible de WhatsApp", () => {
  const salida = formatearWhatsApp(
    "## Opciones\n\n| Producto | Precio |\n|---|---|\n| Chocolate | $4.200 |\n\n**Ver más:** [Catálogo](https://ejemplo.com/catalogo)"
  );
  assert.equal(
    salida,
    "Opciones\n\n• Chocolate — $4.200\n\n*Ver más:* Catálogo: https://ejemplo.com/catalogo"
  );
});

test("buscar_producto consulta el catálogo sin exponer credenciales", async () => {
  const anterior = global.fetch;
  let autorizacion;
  global.fetch = async (_url, opciones) => {
    autorizacion = opciones.headers.Authorization;
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            type: "ok",
            response: {
              result: {
                cols: [
                  { name: "id" },
                  { name: "name" },
                  { name: "price" },
                  { name: "available" },
                  { name: "categoria" },
                ],
                rows: [
                  [
                    { type: "integer", value: "12" },
                    { type: "text", value: "Chocolate cobertura" },
                    { type: "float", value: 4200 },
                    { type: "integer", value: "1" },
                    { type: "text", value: "Chocolates" },
                  ],
                ],
              },
            },
          },
        ],
      }),
    };
  };
  try {
    const resultado = JSON.parse(
      await ejecutarHerramientaTobias("buscar_producto", { texto: "chocolate" })
    );
    assert.equal(resultado.cantidad, 1);
    assert.equal(resultado.resultados[0].nombre, "Chocolate cobertura");
    assert.equal(autorizacion, "Bearer test-turso");
  } finally {
    global.fetch = anterior;
  }
});

test("el router ejecuta una herramienta y devuelve la respuesta final", async () => {
  const anterior = global.fetch;
  let llamadasOpenRouter = 0;
  global.fetch = async (url) => {
    if (String(url).includes("openrouter.ai")) {
      llamadasOpenRouter += 1;
      if (llamadasOpenRouter === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "responder" } }],
          }),
        };
      }
      if (llamadasOpenRouter === 2) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "buscar_producto",
                        arguments: JSON.stringify({ texto: "chocolate" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Trabajamos chocolate cobertura a $4.200. El stock lo confirma una persona.",
              },
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            type: "ok",
            response: {
              result: {
                cols: [
                  { name: "id" },
                  { name: "name" },
                  { name: "price" },
                  { name: "available" },
                  { name: "categoria" },
                ],
                rows: [
                  [
                    { type: "integer", value: "12" },
                    { type: "text", value: "Chocolate cobertura" },
                    { type: "float", value: 4200 },
                    { type: "integer", value: "1" },
                    { type: "text", value: "Chocolates" },
                  ],
                ],
              },
            },
          },
        ],
      }),
    };
  };
  try {
    const resultado = await responder([{ role: "user", content: "¿Tenés chocolate?" }]);
    assert.equal(resultado.derivar, false);
    assert.match(resultado.texto, /chocolate cobertura/i);
    assert.equal(llamadasOpenRouter, 3);
  } finally {
    global.fetch = anterior;
  }
});
