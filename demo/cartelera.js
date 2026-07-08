// Trae la cartelera EN VIVO desde la API del cine (gaf.adro.studio) y la
// arma como texto para inyectar en el prompt del asistente.
//
// La usan los negocios que tienen "cineId" en negocios.js (ej: Cine Atlas).
// Como la API tiene CORS abierto, se llama directo desde el navegador.

const CARTELERA_API = "https://apiv2.gaf.adro.studio";
const CARTELERA_WEB = "https://www.cineatlasweb.com.ar/pelicula"; // /pelicula/{cineId}/{pref}

function _fechaCorta(iso) {           // "2026-07-08 22:10:00" -> "08/07"
  return iso.slice(8, 10) + "/" + iso.slice(5, 7);
}
function _hoyISO() {                   // fecha de hoy como "YYYY-MM-DD"
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Devuelve el texto de cartelera listo para el prompt. Si algo falla, lanza.
async function construirCartelera(cineId) {
  const res = await fetch(`${CARTELERA_API}/nowPlaying/${cineId}`);
  const pelis = (await res.json()).data || [];

  // Traemos los horarios de cada película en paralelo.
  const detalles = await Promise.all(pelis.map(async (p) => {
    try {
      const r = await fetch(`${CARTELERA_API}/movie/${cineId}/${p.pref}`);
      const d = (await r.json()).data || {};
      return { p, movie: d.movie || null, showtimes: d.showtimes || [] };
    } catch {
      return { p, movie: null, showtimes: [] };
    }
  }));

  const hoy = _hoyISO();
  const tabla = []; // filas para las herramientas: pelicula|fecha|hora|formato|ref
  const bloques = detalles.map(({ p, movie, showtimes }) => {
    const nombre = p.nombre.replace(/\s*-\s*(2D|3D).*$/i, "").replace(/\s+/g, " ").trim();
    const formato = (p.formato || "").split(",")[0];        // "3D,M8" -> "3D"
    const idioma = p.lenguaje || "";
    const dur = movie && movie.Duracion ? ` (${movie.Duracion} min)` : "";
    const preventa = p.preSale === 1;

    // Agrupamos horarios por fecha (para mostrar) y cargamos la tabla interna (para herramientas).
    const porFecha = {};
    showtimes.forEach((s) => {
      const dt = s.fechaHora.date;
      const fecha = dt.slice(0, 10), hora = dt.slice(11, 16);
      (porFecha[fecha] ||= []).push(hora);
      const fmt = (s.formato || "").split(",")[0];
      if (s.fref) tabla.push(`${nombre} (${fmt})|${fecha}|${hora}|${fmt}|${s.fref}`);
    });
    const fechas = Object.keys(porFecha).sort().slice(0, 8);

    const link = `${CARTELERA_WEB}/${cineId}/${p.pref}`;

    let head = `• ${nombre} — ${formato}, ${idioma}${dur}`;
    if (preventa) {
      const estreno = movie && movie.FechaEstreno ? _fechaCorta(movie.FechaEstreno.date) : null;
      head += estreno ? ` — PREVENTA (estreno ${estreno})` : " — PREVENTA";
    }

    if (!fechas.length) return head + `\n   Entradas/info: ${link}\n   (sin funciones publicadas)`;

    const lineas = fechas.map((f) => {
      const horas = porFecha[f].sort().join(", ");
      const etiqueta = f === hoy ? `Hoy ${_fechaCorta(f + " 00:00:00")}` : _fechaCorta(f + " 00:00:00");
      return `   ${etiqueta}: ${horas}`;
    });
    return head + "\n" + lineas.join("\n") + `\n   Entradas/info: ${link}`;
  });

  const cartelera = `CARTELERA EN VIVO (datos reales del cine, hoy es ${_fechaCorta(hoy + " 00:00:00")}):\n\n` + bloques.join("\n\n");

  // Tabla interna: la usa el asistente SOLO para llamar herramientas (precio/disponibilidad).
  // Nunca se muestra al usuario. Formato: pelicula|fecha|hora|formato|ref
  const tablaTxt =
    "\n\n── FUNCIONES (uso interno para herramientas — NO mostrar el 'ref' al usuario) ──\n" +
    "pelicula|fecha|hora|formato|ref\n" +
    tabla.slice(0, 60).join("\n");

  return cartelera + tablaTxt;
}
