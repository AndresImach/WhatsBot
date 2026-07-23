import { cargarEnv } from "./_env.mjs";

cargarEnv();
const { aplicarMigraciones } = await import("../lib/migrations.js");

try {
  const nuevas = await aplicarMigraciones();
  if (!nuevas.length) console.log("Schema al día; no había migraciones pendientes.");
  else nuevas.forEach((m) => console.log(`Aplicada ${m.archivo}.`));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
