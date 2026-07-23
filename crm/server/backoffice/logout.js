import { cookieLogout } from "../../lib/auth.js";
import { responderJson, soloMetodo } from "../../lib/http.js";

export default async function handler(req, res) {
  if (!soloMetodo(req, res, "POST")) return;
  res.setHeader("Set-Cookie", cookieLogout());
  return responderJson(res, 200, { ok: true });
}
