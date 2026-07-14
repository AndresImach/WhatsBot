// Decide si un pedido se tomó "fuera de horario", usando el horario semanal que
// el local cargó en la pantalla de Configuración. Se calcula en el servidor al
// crear el pedido para tener una sola fuente de verdad (la base de esta PWA).

const DIAS_INTL = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Momento local del negocio (día 0..6 + minutos desde medianoche), según la zona
// horaria configurada. Default: Argentina.
function ahoraLocal() {
  const tz = process.env.NEGOCIO_TZ || "America/Argentina/Buenos_Aires";
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => partes.find((p) => p.type === t)?.value;
  const dia = DIAS_INTL[get("weekday")] ?? new Date().getDay();
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // algunos entornos devuelven '24' a medianoche
  const mm = parseInt(get("minute"), 10);
  return { dia, minutos: hh * 60 + mm };
}

function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// horario: array de { dia, abierto, apertura, cierre } (ver lib/db.getHorario()).
// Devuelve true si AHORA el local está cerrado según ese horario.
// Si el horario no está configurado (ningún día abierto), asumimos que no se
// puede afirmar que esté cerrado → false (no marcamos nada).
export function estaFueraDeHorario(horario) {
  if (!Array.isArray(horario) || !horario.some((d) => d.abierto)) return false;
  const { dia, minutos } = ahoraLocal();
  const hoy = horario.find((d) => d.dia === dia);
  if (!hoy || !hoy.abierto) return true;
  const ap = aMinutos(hoy.apertura);
  const ci = aMinutos(hoy.cierre);
  if (ap === null || ci === null) return false; // día abierto sin horas cargadas: no lo marcamos
  if (ci <= ap) return minutos < ap && minutos >= ci; // cruza medianoche
  return minutos < ap || minutos >= ci;
}
