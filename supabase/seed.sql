-- =============================================================================
-- Demo seed data for LOCAL DEVELOPMENT ONLY
-- =============================================================================
-- A fictitious hardware store with two branches and a small multi-unit catalog.
-- The VAT and CR numbers are syntactically valid placeholders, not real registrations.
-- Users are not created here: run `pnpm --filter @erp/scripts demo-users` (see docs/setup.md),
-- which uses the Supabase Auth admin API and then attaches memberships.
-- Barcodes use the GS1 in-store prefix "2" (restricted circulation) with valid check digits.

begin;

insert into public.organizations (id, legal_name_en, legal_name_ar, trade_name, vat_number, cr_number, prices_include_vat, default_locale)
values ('00000000-0000-4000-8000-000000000001', 'Demo Hardware Trading Co.', 'شركة العدد التجريبية للتجارة',
        'Demo Hardware', '399999999900003', '1010000000', true, 'ar');

insert into public.branches (id, org_id, code, name_en, name_ar, street, building_number, additional_number, district, city, postal_code)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'RUH', 'Riyadh – Main', 'الرياض – الرئيسي',
   'King Fahd Road', '1234', '5678', 'Al Olaya', 'Riyadh', '12211'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'JED', 'Jeddah', 'جدة',
   'Prince Sultan Street', '4321', '8765', 'Al Rawdah', 'Jeddah', '23435');

do $$
declare
  v_org constant uuid := '00000000-0000-4000-8000-000000000001';
  c_fasteners uuid; c_screws uuid; c_bolts uuid; c_electrical uuid; c_cables uuid; c_switches uuid;
  c_plumbing uuid; c_paint uuid; c_tools uuid; c_power uuid; c_safety uuid; c_building uuid; c_services uuid;
  b_najd uuid; b_falcon uuid; b_gulf uuid; b_desert uuid; b_safeguard uuid;
  v_product uuid;

begin
  -- Categories --------------------------------------------------------------
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Fasteners', 'مثبتات', 'ফাস্টেনার', 10) returning id into c_fasteners;
  insert into public.product_categories (org_id, parent_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, c_fasteners, 'Screws', 'براغي', 'স্ক্রু', 11) returning id into c_screws;
  insert into public.product_categories (org_id, parent_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, c_fasteners, 'Bolts & nuts', 'مسامير وصواميل', 'বোল্ট ও নাট', 12) returning id into c_bolts;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Electrical', 'كهرباء', 'বৈদ্যুতিক', 20) returning id into c_electrical;
  insert into public.product_categories (org_id, parent_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, c_electrical, 'Cables & wires', 'كابلات وأسلاك', 'তার ও কেবল', 21) returning id into c_cables;
  insert into public.product_categories (org_id, parent_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, c_electrical, 'Switches & sockets', 'مفاتيح وأفياش', 'সুইচ ও সকেট', 22) returning id into c_switches;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Plumbing', 'سباكة', 'প্লাম্বিং', 30) returning id into c_plumbing;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Paint', 'دهانات', 'রং', 40) returning id into c_paint;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Hand tools', 'عدد يدوية', 'হাতের যন্ত্র', 50) returning id into c_tools;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Power tools', 'عدد كهربائية', 'পাওয়ার টুলস', 60) returning id into c_power;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Safety', 'معدات السلامة', 'নিরাপত্তা সামগ্রী', 70) returning id into c_safety;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Building materials', 'مواد بناء', 'নির্মাণ সামগ্রী', 80) returning id into c_building;
  insert into public.product_categories (org_id, name_en, name_ar, name_bn, sort_order)
  values (v_org, 'Services', 'خدمات', 'সেবা', 90) returning id into c_services;

  -- Brands (fictitious) -----------------------------------------------------
  insert into public.brands (org_id, name) values (v_org, 'Najd Fasteners') returning id into b_najd;
  insert into public.brands (org_id, name) values (v_org, 'Falcon Tools') returning id into b_falcon;
  insert into public.brands (org_id, name) values (v_org, 'Gulf Cable') returning id into b_gulf;
  insert into public.brands (org_id, name) values (v_org, 'Desert Paint') returning id into b_desert;
  insert into public.brands (org_id, name) values (v_org, 'SafeGuard') returning id into b_safeguard;

  -- Products ----------------------------------------------------------------
  -- Wood screw: sold per piece and per box of 200
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'FST-WS-4X40', 'Wood screw 4 x 40 mm', 'برغي خشب 4 × 40 مم', 'কাঠের স্ক্রু ৪ × ৪০ মিমি', c_screws, b_najd,
          (select id from public.units where code = 'pcs' and org_id is null), 2000)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, '2000000100012', 0.15),
    (v_org, v_product, (select id from public.units where code = 'box' and org_id is null), 200, false, '2000000100029', 25.00);

  -- Hex bolt: piece and pack of 25
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'FST-HB-M10X50', 'Hex bolt M10 x 50 galvanised', 'مسمار سداسي M10 × 50 مجلفن', 'হেক্স বোল্ট M10 × 50', c_bolts, b_najd,
          (select id from public.units where code = 'pcs' and org_id is null), 500)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, '2000000100036', 0.75),
    (v_org, v_product, (select id from public.units where code = 'pack' and org_id is null), 25, false, '2000000100043', 17.50);

  -- Cable: stocked in metres, sold per metre or per 100 m roll
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'ELC-CU-2.5', 'Copper cable 2.5 mm² single core', 'كابل نحاس 2.5 مم² أحادي', 'তামার তার ২.৫ মিমি²', c_cables, b_gulf,
          (select id from public.units where code = 'm' and org_id is null), 500)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'm' and org_id is null), 1, true, '2000000100050', 3.50),
    (v_org, v_product, (select id from public.units where code = 'roll' and org_id is null), 100, false, '2000000100067', 320.00);

  -- PVC pipe: stocked in metres; one "piece" is a 4 m length
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, base_unit_id, reorder_level)
  values (v_org, 'PLB-PVC-0.5', 'PVC pressure pipe 1/2"', 'ماسورة PVC ضغط ½ بوصة', 'পিভিসি পাইপ ½"', c_plumbing,
          (select id from public.units where code = 'm' and org_id is null), 200)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price, is_purchase_unit) values
    (v_org, v_product, (select id from public.units where code = 'm' and org_id is null), 1, true, null, 2.75, false),
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 4, false, '2000000100074', 10.50, true);

  -- Paint: stocked in litres, sold by gallon can and 18 L bucket only
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id)
  values (v_org, 'PNT-INT-WHT', 'Interior emulsion paint – white', 'دهان داخلي مائي – أبيض', 'ইন্টেরিয়র রং – সাদা', c_paint, b_desert,
          (select id from public.units where code = 'l' and org_id is null))
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price, is_sale_unit) values
    (v_org, v_product, (select id from public.units where code = 'l' and org_id is null), 1, true, null, null, false),
    (v_org, v_product, (select id from public.units where code = 'gal' and org_id is null), 3.785412, false, '2000000100081', 45.00, true),
    (v_org, v_product, (select id from public.units where code = 'bucket' and org_id is null), 18, false, '2000000100098', 185.00, true);

  -- Claw hammer
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'TLS-HAM-16', 'Claw hammer 16 oz', 'مطرقة مخلب 16 أونصة', 'ক্ল হাতুড়ি ১৬ আউন্স', c_tools, b_falcon,
          (select id from public.units where code = 'pcs' and org_id is null), 10)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, '2000000100104', 35.00),
    (v_org, v_product, (select id from public.units where code = 'carton' and org_id is null), 12, false, '2000000100111', 390.00);

  -- Cordless drill
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'PWR-DRL-18V', 'Cordless drill driver 18 V', 'دريل لاسلكي 18 فولت', 'কর্ডলেস ড্রিল ১৮ ভোল্ট', c_power, b_falcon,
          (select id from public.units where code = 'pcs' and org_id is null), 3)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, '2000000100128', 449.00);

  -- Work gloves: per pair, carton of 120 pairs
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id, reorder_level)
  values (v_org, 'SAF-GLV-L', 'Work gloves, size L', 'قفازات عمل مقاس L', 'কাজের গ্লাভস, সাইজ L', c_safety, b_safeguard,
          (select id from public.units where code = 'pair' and org_id is null), 60)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pair' and org_id is null), 1, true, '2000000100135', 8.00),
    (v_org, v_product, (select id from public.units where code = 'carton' and org_id is null), 120, false, '2000000100142', 840.00);

  -- Cement: stocked and sold per 50 kg bag
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, base_unit_id, reorder_level)
  values (v_org, 'BLD-CEM-50', 'Portland cement 50 kg bag', 'إسمنت بورتلاندي كيس 50 كجم', 'পোর্টল্যান্ড সিমেন্ট ৫০ কেজি', c_building,
          (select id from public.units where code = 'bag' and org_id is null), 40)
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'bag' and org_id is null), 1, true, '2000000100159', 17.00);

  -- Masking tape: per roll and carton of 48
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, base_unit_id)
  values (v_org, 'PNT-TAPE-48', 'Masking tape 48 mm', 'شريط تغطية 48 مم', 'মাস্কিং টেপ ৪৮ মিমি', c_paint,
          (select id from public.units where code = 'roll' and org_id is null))
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'roll' and org_id is null), 1, true, '2000000100166', 6.50),
    (v_org, v_product, (select id from public.units where code = 'carton' and org_id is null), 48, false, '2000000100173', 285.00);

  -- Wall switch: per piece and box of 10
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, brand_id, base_unit_id)
  values (v_org, 'ELC-SW-1G', 'Wall switch 1-gang 10 A', 'مفتاح جداري فردي 10 أمبير', 'ওয়াল সুইচ ১-গ্যাং ১০A', c_switches, b_gulf,
          (select id from public.units where code = 'pcs' and org_id is null))
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode, sale_price) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, '2000000100180', 12.00),
    (v_org, v_product, (select id from public.units where code = 'box' and org_id is null), 10, false, '2000000100197', 110.00);

  -- Service item (no stock)
  insert into public.products (org_id, sku, name_en, name_ar, name_bn, category_id, product_type, base_unit_id)
  values (v_org, 'SRV-KEY-CUT', 'Key cutting service', 'خدمة نسخ مفاتيح', 'চাবি কাটার সেবা', c_services, 'service',
          (select id from public.units where code = 'pcs' and org_id is null))
  returning id into v_product;
  insert into public.product_units (org_id, product_id, unit_id, factor, is_base, sale_price, is_purchase_unit) values
    (v_org, v_product, (select id from public.units where code = 'pcs' and org_id is null), 1, true, 10.00, false);
end;
$$;

commit;
