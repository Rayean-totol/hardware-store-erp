import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { workbookToCsv } from '@/features/products/excel-to-csv';

async function xlsx(build: (ws: ExcelJS.Worksheet) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb.addWorksheet('Products'));
  const out = await wb.xlsx.writeBuffer();
  return out instanceof ArrayBuffer ? out : new Uint8Array(out as ArrayBuffer).buffer;
}

describe('Excel to CSV for the product import', () => {
  it('turns the first sheet into CSV rows with the header first', async () => {
    const data = await xlsx((ws) => {
      ws.addRow(['sku', 'name_en', 'name_ar', 'base_unit', 'unit', 'factor', 'sale_price']);
      ws.addRow(['DEMO-A', 'Demo A (DEMO)', 'تجريبي', 'pcs', 'pcs', 1, 12.5]);
    });
    const csv = await workbookToCsv(data);
    expect(csv.split('\r\n')[0]).toBe('sku,name_en,name_ar,base_unit,unit,factor,sale_price');
    expect(csv).toContain('DEMO-A,Demo A (DEMO),تجريبي,pcs,pcs,1,12.5');
  });

  it('keeps the calculated value of formula cells', async () => {
    const data = await xlsx((ws) => {
      ws.addRow(['sku', 'sale_price']);
      ws.addRow(['DEMO-F', { formula: '2*6', result: 12 }]);
    });
    expect(await workbookToCsv(data)).toContain('DEMO-F,12');
  });

  it('keeps leading zeros of barcodes stored as text', async () => {
    const data = await xlsx((ws) => {
      ws.addRow(['sku', 'barcode']);
      ws.addRow(['DEMO-B', '0012345678905']);
    });
    expect(await workbookToCsv(data)).toContain('DEMO-B,0012345678905');
  });

  it('skips empty rows', async () => {
    const data = await xlsx((ws) => {
      ws.addRow(['sku', 'name_en']);
      ws.addRow([]);
      ws.addRow(['DEMO-C', 'C']);
    });
    const lines = (await workbookToCsv(data)).trim().split('\r\n');
    expect(lines).toHaveLength(2);
  });

  it('refuses a file with more rows than allowed', async () => {
    const data = await xlsx((ws) => {
      ws.addRow(['sku']);
      ws.addRow(['A']);
      ws.addRow(['B']);
      ws.addRow(['C']);
    });
    await expect(workbookToCsv(data, { maxRows: 2 })).rejects.toMatchObject({ code: 'import.too_many_rows' });
  });

  it('refuses bytes that are not an Excel file, without crashing', async () => {
    const junk = new TextEncoder().encode('this is not a workbook').buffer as ArrayBuffer;
    await expect(workbookToCsv(junk)).rejects.toMatchObject({ code: 'import.excel_unreadable' });
  });

  it('refuses an empty sheet', async () => {
    const data = await xlsx(() => undefined);
    await expect(workbookToCsv(data)).rejects.toMatchObject({ code: 'import.excel_empty' });
  });
});
