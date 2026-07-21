/**
 * Webhook receptor de métricas de kiritek-init.
 *
 * Setup:
 * 1. Crear un Google Sheet nuevo (ej. "Kiritek — Métricas de Adopción").
 * 2. Extensiones > Apps Script, pegar este archivo completo (reemplaza Code.gs).
 * 3. Desplegar > Nueva implementación > tipo "Aplicación web".
 *    - Ejecutar como: tú mismo (o una cuenta de servicio del equipo)
 *    - Quién tiene acceso: cualquiera (el POST no lleva auth propia — si se
 *      necesita más seguridad, agregar un token compartido y validarlo en doPost)
 * 4. Copiar la URL de la app web — esa es KIRITEK_METRICS_WEBHOOK.
 */

const SHEET_NAME = "reportes";
const HEADERS = [
  "timestamp",
  "repo",
  "compliant",
  "conventionalCommitRate",
  "conventionalCommitSampleSize",
  "checks_json",
];

function doPost(e) {
  const sheet = getOrCreateSheet();
  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.repo || "",
    data.compliant === true,
    data.conventionalCommitRate ?? "",
    data.conventionalCommitSampleSize ?? "",
    JSON.stringify(data.checks || []),
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}
