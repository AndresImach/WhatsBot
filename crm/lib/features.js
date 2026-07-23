export const FEATURES_DEFAULT = Object.freeze({
  etiquetas: false,
  notas: false,
  valoracion: false,
  atajos: false,
  gestionUsuarios: false,
  maxAgentes: 0,
});

export function parsearValorFeature(valor) {
  if (valor === "true") return true;
  if (valor === "false") return false;
  if (valor === "unlimited") return null;
  if (/^-?\d+$/.test(String(valor))) return Number(valor);
  return valor;
}

export function resolverFeatures(planRows = [], overrideRows = []) {
  const resultado = { ...FEATURES_DEFAULT };
  for (const row of planRows) resultado[row.feature] = parsearValorFeature(row.valor);
  for (const row of overrideRows) resultado[row.feature] = parsearValorFeature(row.valor);
  return resultado;
}

export function featureActiva(features, nombre) {
  return features?.[nombre] === true;
}
