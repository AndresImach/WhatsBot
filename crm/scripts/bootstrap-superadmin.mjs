import { cargarEnv, argumentos } from "./_env.mjs";

cargarEnv();
const args = argumentos();
const [usuarioRaw, password, nombreRaw] = args._;

const { aplicarMigraciones } = await import("../lib/migrations.js");
const { crearUsuario, getUsuarioPorNombre, actualizarUsuario } = await import("../lib/data.js");
const { hashPassword } = await import("../lib/auth.js");
const { fila } = await import("../lib/client.js");

await aplicarMigraciones();
let usuario;
let nombre;
let passwordHash;
if (args["from-legacy-agent"]) {
  const buscado = args["from-legacy-agent"] === true ? null : String(args["from-legacy-agent"]).trim().toLowerCase();
  const legacy = buscado
    ? await fila('SELECT usuario, passwordHash, nombre FROM "Agente" WHERE usuario = ? AND activo = 1 LIMIT 1', [buscado])
    : await fila('SELECT usuario, passwordHash, nombre FROM "Agente" WHERE activo = 1 ORDER BY id LIMIT 1');
  if (!legacy) throw new Error("No se encontró un Agente legacy activo para promover.");
  usuario = String(legacy.usuario).trim().toLowerCase();
  nombre = String(legacy.nombre || legacy.usuario).trim();
  passwordHash = legacy.passwordHash;
} else {
  if (!usuarioRaw || !password) {
    console.error('Uso: npm run bootstrap -- <usuario> <password> ["Nombre"]');
    console.error("   o: npm run bootstrap -- --from-legacy-agent [usuario]");
    process.exit(1);
  }
  if (String(password).length < 10) {
    console.error("La contraseña necesita al menos 10 caracteres.");
    process.exit(1);
  }
  usuario = String(usuarioRaw).trim().toLowerCase();
  nombre = String(nombreRaw || usuarioRaw).trim();
  passwordHash = hashPassword(password);
}

const existente = await getUsuarioPorNombre(usuario);
if (existente) {
  await actualizarUsuario({
    id: Number(existente.id),
    nombre,
    activo: true,
    esSuperAdmin: true,
    passwordHash,
  });
  console.log(`Superadmin "${usuario}" actualizado.`);
} else {
  await crearUsuario({ usuario, nombre, passwordHash, esSuperAdmin: true });
  console.log(`Superadmin "${usuario}" creado.`);
}
