import { toCsv } from '@erp/domain';
import { DataError } from '@erp/data';
import ExcelJS from 'exceljs';

/** Upper limits for one import file. Larger files are refused before they are read. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

type CellValue = ExcelJS.CellValue;

/** Text of one cell. Formulas give their calculated result; rich text and links give their text. */
export function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: CellValue }).result;
      return result === undefined ? '' : cellText(result as CellValue);
    }
    if ('richText' in value) return (value as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    if ('text' in value) return String((value as { text: CellValue }).text ?? '');
    if ('error' in value) return '';
  }
  return '';
}

/**
 * Turns the first worksheet of an .xlsx file into CSV text in the product import format, so the
 * same validation applies to Excel and CSV. Empty rows are skipped. Keep barcodes as Text in Excel
 * so leading zeros are not lost.
 */
export async function workbookToCsv(data: ArrayBuffer, options: { maxRows?: number } = {}): Promise<string> {
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new DataError('import.excel_unreadable', 'xlsx');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new DataError('import.excel_empty', 'xlsx');

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    const cells = values.map((v) => cellText(v as CellValue).replace(/\r?\n/g, ' ').trim());
    if (cells.some((c) => c !== '')) rows.push(cells);
  });
  if (rows.length === 0) throw new DataError('import.excel_empty', 'xlsx');
  if (rows.length - 1 > maxRows) throw new DataError('import.too_many_rows', String(maxRows));
  return toCsv(rows);
}
