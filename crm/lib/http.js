export function responderJson(res, status, payload) {
  res.setHeader?.("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(payload);
}

export function soloMetodo(req, res, metodos) {
  const permitidos = Array.isArray(metodos) ? metodos : [metodos];
  if (permitidos.includes(req.method)) return true;
  res.setHeader?.("Allow", permitidos.join(", "));
  responderJson(res, 405, { error: "Method not allowed" });
  return false;
}

export function enteroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function texto(valor, max = 10000) {
  return String(valor ?? "").trim().slice(0, max);
}

export function mensajeError(error, fallback = "Error interno") {
  if (error?.codigoPublico) return error.codigoPublico;
  return fallback;
}

export function errorPublico(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.codigoPublico = mensaje;
  error.status = status;
  return error;
}

export function manejarError(res, error, fallback = "Error interno") {
  const status = error?.status || 500;
  if (status >= 500) console.error(error);
  return responderJson(res, status, { error: mensajeError(error, fallback) });
}
