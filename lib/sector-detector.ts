/**
 * Detector de sector solicitante.
 *
 * Extrae el sector desde el contenido del ticket y/o formularios GLPI
 * buscando patrones validados en versiones anteriores.
 *
 * NO confundir sector solicitante con:
 * - Entidad GLPI
 * - Categoría GLPI
 * - Grupo asignado a Sistemas/Tecnología
 */

import { decode } from 'html-entities';

// Patrones conocidos para detectar el sector en el contenido del ticket
const SECTOR_PATTERNS = [
  /seleccione\s+su\s+grupo\s+de\s+trabajo\s*[:\-]?\s*(.+)/i,
  /sector\s+asignado\s*[:\-]?\s*(.+)/i,
  /indique\s+a\s+qu[eé]\s+sector\s+pertenece\s*[:\-]?\s*(.+)/i,
  /grupo\s+de\s+trabajo\s*[:\-]?\s*(.+)/i,
  /sector\s*[:\-]\s*(.+)/i,
];

// Sectores conocidos para validación (normalizar match)
const KNOWN_SECTORS = [
  'Impuestos',
  'Tesorería',
  'Cuentas a Pagar',
  'RRHH',
  'Recursos Humanos',
  'Contabilidad',
  'Compras',
  'Logística',
  'Comercial',
  'Administración',
  'Finanzas',
  'Legal',
  'Producción',
  'Calidad',
  'Mantenimiento',
];

/**
 * Normaliza texto: quita acentos, espacios extra y pasa a minúsculas.
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Convierte HTML a texto plano limpio.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';

  // Decodificar entidades HTML
  let text = decode(html);

  // Reemplazar <br>, <br/>, <br /> por saltos de línea
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Reemplazar </p>, </div>, </li> por saltos de línea
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');

  // Quitar todas las etiquetas HTML restantes
  text = text.replace(/<[^>]+>/g, '');

  // Decodificar entidades HTML otra vez (por si quedaron anidadas)
  text = decode(text);

  // Normalizar espacios
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');

  return text.trim();
}

/**
 * Intenta detectar un sector conocido en un texto capturado.
 */
function matchKnownSector(captured: string): string | null {
  const normalizedCapture = normalizeText(captured);

  for (const sector of KNOWN_SECTORS) {
    const normalizedSector = normalizeText(sector);
    if (normalizedCapture.includes(normalizedSector)) {
      return sector; // Devolver el nombre canónico
    }
  }

  // Si no matchea con sectores conocidos, devolver el texto capturado limpio
  // (puede ser un sector que no tenemos en la lista)
  const cleaned = captured.replace(/\n.*$/s, '').trim();
  if (cleaned.length > 0 && cleaned.length < 100) {
    return cleaned;
  }

  return null;
}

/**
 * Detecta el sector solicitante desde el contenido HTML del ticket.
 * Retorna el nombre del sector o "Sin sector" si no se detecta.
 */
export function detectSector(htmlContent: string): string {
  if (!htmlContent) return 'Sin sector';

  const plainText = htmlToPlainText(htmlContent);

  for (const pattern of SECTOR_PATTERNS) {
    const match = plainText.match(pattern);
    if (match && match[1]) {
      const sector = matchKnownSector(match[1]);
      if (sector) return sector;
    }
  }

  // Intentar también con el HTML decodificado directamente
  const decodedHtml = decode(htmlContent);
  for (const pattern of SECTOR_PATTERNS) {
    const match = decodedHtml.match(pattern);
    if (match && match[1]) {
      const cleanedMatch = htmlToPlainText(match[1]);
      const sector = matchKnownSector(cleanedMatch);
      if (sector) return sector;
    }
  }

  return 'Sin sector';
}

/**
 * Normaliza nombres de sector para comparación.
 * Por ejemplo: "recursos humanos" → "RRHH", "ctas a pagar" → "Cuentas a Pagar"
 */
export function normalizeSectorName(sector: string): string {
  const normalized = normalizeText(sector);

  const aliases: Record<string, string> = {
    'recursos humanos': 'RRHH',
    'rrhh': 'RRHH',
    'rr.hh.': 'RRHH',
    'rr hh': 'RRHH',
    'impuestos': 'Impuestos',
    'tesoreria': 'Tesorería',
    'cuentas a pagar': 'Cuentas a Pagar',
    'ctas a pagar': 'Cuentas a Pagar',
    'cuentas por pagar': 'Cuentas a Pagar',
  };

  return aliases[normalized] || sector;
}
