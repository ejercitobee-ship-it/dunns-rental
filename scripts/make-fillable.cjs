const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { readFile, writeFile } = require('fs/promises');

const INPUT = 'C:/Users/ejerc/Downloads/MH-Dunn-Residential-Lease-Agreement (Lease).pdf';
const OUTPUT = 'C:/Users/ejerc/Downloads/MH-Dunn-Residential-Lease-Agreement-FILLABLE.pdf';

async function main() {
  const pdfBytes = await readFile(INPUT);
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);

  // Helper: add a text field — positions from pdfjs-dist extraction
  function addText(page, name, x, y, w, h) {
    h = h || 14;
    const field = form.createTextField(name);
    field.addToPage(page, { x, y: y - 2, width: w, height: h,
      borderWidth: 0,
      backgroundColor: rgb(0.96, 0.96, 0.94),
    });
    field.setFontSize(9);
    return field;
  }

  // Helper: add a checkbox — positioned right on top of existing ☐ symbols
  function addCheck(page, name, x, y, size) {
    size = size || 12;
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: x - 1, y: y - 2, width: size, height: size });
    return cb;
  }

  const pages = pdf.getPages();

  // ──────────────────────────────────────────────
  // Phone number fix on pages 2 and 3
  // Exact positions from extraction:
  //   Page 2: y=635.3 x=72 "Phone: (773) 220 0531 · Email: info@mhdunnproperty.net"
  //   Page 3: y=673.5 x=72 "Phone:" + x=108.7 "(773) 220 0531"
  // ──────────────────────────────────────────────

  // Page 2: Cover entire line and redraw
  pages[1].drawRectangle({ x: 70, y: 632, width: 270, height: 16, color: rgb(1, 1, 1) });
  pages[1].drawText('Phone: (773) 991 7112 · Email: info@mhdunnproperty.net', {
    x: 72, y: 635.3, size: 10, font: helvetica, color: rgb(0, 0, 0)
  });

  // Page 3: Cover "Phone:" line and redraw — "Phone:" label at x=72 and number at x=108.7
  pages[2].drawRectangle({ x: 70, y: 670, width: 200, height: 16, color: rgb(1, 1, 1) });
  pages[2].drawText('Phone: (773) 991 7112', {
    x: 72, y: 673.5, size: 10, font: helvetica, color: rgb(0, 0, 0)
  });


  // ──────────────────────────────────────────────
  // PAGE 2 — Lease Summary + Parties
  // Extracted: DETAILS column starts at x=260.3
  // Rows at y: 444, 416.3, 388.5, 360.8, 333, 305.3, 277.5, 249.8, 222.8, 195.8
  // ──────────────────────────────────────────────
  const p2 = pages[1];
  const detX = 260; // DETAILS column x
  const detW = 280; // field width (to right margin)

  // Date of Lease (y=444)
  addText(p2, 'lease_date', detX, 444, detW);

  // Leased Premises (y=416.3)
  addText(p2, 'leased_premises', detX, 416.3, detW);

  // Lease Begin Date and Time (y=388.5)
  addText(p2, 'lease_begin', detX, 388.5, detW);

  // Lease End Date and Time (y=360.8)
  addText(p2, 'lease_end', detX, 360.8, detW);

  // Monthly Rent (y=333, "$" at x=260.3-265.6, field after "$")
  addText(p2, 'monthly_rent', 268, 333, detW - 8);

  // Move In Fee (y=305.3)
  addText(p2, 'move_in_fee', 268, 305.3, detW - 8);

  // Security Deposit (y=277.5)
  addText(p2, 'security_deposit', 268, 277.5, detW - 8);

  // Rent Due Date, Payment Method, Late Fee — already have static text, skip

  // Parties: "Name:" labels at y=93.8
  // Landlord name at x=72 endX=102.6 "Name:", field after
  const ll = addText(p2, 'landlord_name', 106, 93.8, 190);
  ll.setText('MH Dunn Property');
  // Tenant name at x=314.4 endX=345 "Name:", field after
  addText(p2, 'tenant_name_1', 348, 93.8, 190);


  // ──────────────────────────────────────────────
  // PAGE 3 — Contact + Property Details
  // ──────────────────────────────────────────────
  const p3 = pages[2];

  // RIGHT COLUMN — Tenant info
  // "Name:"   y=709.5 x=314.4 endX=345 → field starts at x=348
  // "Phone:"  y=687.8 x=314.4 endX=348.3 → field at x=351
  // "Email:"  y=666   x=314.4 endX=344.4 → field at x=348
  // "Email:"  y=644.3 x=314.4 endX=344.4 → field at x=348
  addText(p3, 'tenant_name_full', 348, 709.5, 192);
  addText(p3, 'tenant_phone', 351, 687.8, 189);
  addText(p3, 'tenant_email_1', 348, 666, 192);
  addText(p3, 'tenant_email_2', 348, 644.3, 192);

  // "Persons authorized..." y=622.5 x=314.4 — field below at ~y=604
  addText(p3, 'authorized_persons', 314.4, 600, 226, 20);

  // LEFT COLUMN — Service of Process
  // "Name:"    y=595.5 x=72 endX=101.4 → field at x=104
  // "Address:" y=573.8 x=72 endX=111.5 → field at x=114
  // "Phone:"   y=552   x=72 endX=103.7 → field at x=106
  addText(p3, 'service_name', 104, 595.5, 196);
  addText(p3, 'service_address', 114, 573.8, 186);
  addText(p3, 'service_phone', 106, 552, 194);

  // PROPERTY DETAILS TABLE
  // Pets (y=444.8): ☐ at x=213.1, "Yes (describe):" ends at x=286.7, field x=290, ☐No at x=420
  addCheck(p3, 'pets_yes', 213.1, 444.8);
  addText(p3, 'pets_desc', 290, 444.8, 125);
  addCheck(p3, 'pets_no', 420, 444.8);

  // Parking (y=417): ☐ at x=213.1, "Yes (space #):" ends at x=284, ☐No at x=417.4
  addCheck(p3, 'parking_yes', 213.1, 417);
  addText(p3, 'parking_num', 287, 417, 125);
  addCheck(p3, 'parking_no', 417.4, 417);

  // Storage (y=389.3): same layout
  addCheck(p3, 'storage_yes', 213.1, 389.3);
  addText(p3, 'storage_num', 287, 389.3, 125);
  addCheck(p3, 'storage_no', 417.4, 389.3);

  // Furnished (y=361.5): ☐Yes at x=213.1, ☐No at x=241.9
  addCheck(p3, 'furnished_yes', 213.1, 361.5);
  addCheck(p3, 'furnished_no', 241.9, 361.5);

  // UTILITIES (y=309) — exact ☐ positions from extraction
  addCheck(p3, 'util_water', 72, 309);        // ☐ at x=72
  addCheck(p3, 'util_electricity', 126.8, 309); // ☐ at x=126.8
  addCheck(p3, 'util_gas', 198.1, 309);        // ☐ at x=198.1
  addCheck(p3, 'util_internet', 245, 309);      // ☐ at x=245
  addCheck(p3, 'util_lawn', 307.4, 309);        // ☐ at x=307.4
  addCheck(p3, 'util_snow', 391.4, 309);        // ☐ at x=391.4
  addCheck(p3, 'util_other', 494.4, 309);       // ☐ at x=494.4

  // APPLIANCES (y=251.3) — exact ☐ positions
  addCheck(p3, 'appl_fridge', 72, 251.3);       // ☐ at x=72
  addCheck(p3, 'appl_micro', 144.9, 251.3);     // ☐ at x=144.9
  addCheck(p3, 'appl_oven', 212.7, 251.3);      // ☐ at x=212.7
  addCheck(p3, 'appl_dishwasher', 288.9, 251.3);// ☐ at x=288.9
  addCheck(p3, 'appl_washer', 361.2, 251.3);    // ☐ at x=361.2
  addCheck(p3, 'appl_dryer', 415.4, 251.3);     // ☐ at x=415.4
  addCheck(p3, 'appl_ac', 459.9, 251.3);        // ☐ at x=459.9
  // A/C units field (y=236.3) and ☐Other at x=230
  addText(p3, 'appl_ac_units', 72, 236.3, 125);
  addCheck(p3, 'appl_other', 230, 236.3);       // ☐ at x=230
  addText(p3, 'appl_other_text', 272, 236.3, 120);

  // Additional Agreements (y=214.5, label ends at x=184.4)
  // Large text area below the label
  addText(p3, 'additional_agreements', 72, 190, 468, 22);


  // ──────────────────────────────────────────────
  // PAGE 4 — Disclosures
  // ──────────────────────────────────────────────
  const p4 = pages[3];

  // Heating: ☐Tenant at x=275.2 y=655.5, ☐Landlord at x=319.2
  addCheck(p4, 'heating_tenant', 275.2, 655.5);
  addCheck(p4, 'heating_landlord', 319.2, 655.5);
  // Heating cost: "is $" ends at x=248, gap until x=379.7 "."
  addText(p4, 'heating_cost', 250, 640.5, 126);

  // Lead Paint: ☐ at x=72 y=578.3, ☐NA at x=344.6
  addCheck(p4, 'lead_attached', 72, 578.3);
  addCheck(p4, 'lead_na', 344.6, 578.3);
  // Pamphlet: ☐ at x=72 y=557.3
  addCheck(p4, 'lead_pamphlet', 72, 557.3);

  // Radon: ☐ at x=72 y=537, ☐NA at x=295.1
  addCheck(p4, 'radon_attached', 72, 537);
  addCheck(p4, 'radon_na', 295.1, 537);
  // Radon pamphlet: ☐ at x=72 y=516
  addCheck(p4, 'radon_pamphlet', 72, 516);

  // Tenant Initials + Date (y=495): "Tenant Initials:" ends at x=135.9, "Date:" at x=280.2
  addText(p4, 'initials_lead', 140, 495, 130);
  addText(p4, 'date_lead', 308, 495, 150);

  // Flooding: ☐is at x=114.8 y=447.8, ☐is not at x=138.5
  addCheck(p4, 'flood_is', 114.8, 447.8);
  addCheck(p4, 'flood_isnot', 138.5, 447.8);
  // Flood times: gap at y=432.8 between x=352.3 and x=487.7
  addText(p4, 'flood_times', 355, 432.8, 130);

  // Flooding 2: ☐is at x=113.7 y=396, ☐is not at x=135.1
  addCheck(p4, 'flood2_is', 113.7, 396);
  addCheck(p4, 'flood2_isnot', 135.1, 396);

  // Habitability: ☐None at x=72 y=298.5, ☐See Attached at x=143.4
  addCheck(p4, 'habit_none', 72, 298.5);
  addCheck(p4, 'habit_attached', 143.4, 298.5);

  // Tenant Initials + Date (y=226.5)
  addText(p4, 'initials_habit', 140, 226.5, 130);
  addText(p4, 'date_habit', 308, 226.5, 150);

  // Acknowledgment checkboxes — ☐ at x=72
  addCheck(p4, 'ack_code', 72, 158.3);
  addCheck(p4, 'ack_bedbug', 72, 137.3);
  addCheck(p4, 'ack_ordinance', 72, 116.3);
  addCheck(p4, 'ack_interest', 72, 95.3);


  // ──────────────────────────────────────────────
  // PAGE 5 — More acknowledgments
  // ──────────────────────────────────────────────
  const p5 = pages[4];

  addCheck(p5, 'ack_safer_homes', 72, 709.5);
  addCheck(p5, 'ack_heating_disc', 72, 688.5);
  addCheck(p5, 'ack_deposit', 72, 667.5);
  addCheck(p5, 'ack_hoa', 72, 646.5);
  addCheck(p5, 'ack_recycling', 72, 625.5);

  // Tenant Initials + Date (y=604.5)
  addText(p5, 'initials_ack', 140, 604.5, 130);
  addText(p5, 'date_ack', 308, 604.5, 150);


  // ──────────────────────────────────────────────
  // PAGE 13 — Guaranty
  // "On ___" y=660.8: "On" ends at x=85.3, text resumes at x=196.2
  // ──────────────────────────────────────────────
  const p13 = pages[12];

  addText(p13, 'guaranty_date', 88, 660.8, 105);

  // Guarantor table — labels at x=82, fields start at ~x=190
  // Name y=558.8, Address y=531, Phone y=503.3, Email y=475.5
  addText(p13, 'guarantor_name', 190, 558.8, 350);
  addText(p13, 'guarantor_address', 190, 531, 350);
  addText(p13, 'guarantor_phone', 190, 503.3, 350);
  addText(p13, 'guarantor_email', 190, 475.5, 350);

  // Signature + Date: labels at y=375.8
  // Signature line is above the label, at ~y=388
  addText(p13, 'guarantor_sig', 72, 388, 216);
  addText(p13, 'guarantor_sig_date', 296, 388, 110);


  // ──────────────────────────────────────────────
  // PAGE 14 — Signatures
  // Tenant slots: "Date:" at y=549.8, 456.8, 364.5
  // Labels below at y=525.8, 433.5, 340.5
  // → signature fields go above the labels, at approx y=536, 443, 350
  // Landlord: "Date:" at y=244.5, 151.5
  // Labels at y=220.5, 127.5
  // → sig fields at y=255, 162
  // ──────────────────────────────────────────────
  const p14 = pages[13];

  // Tenant 1
  addText(p14, 'tenant1_sig', 72, 560, 290);
  addText(p14, 'tenant1_date', 396, 549.8, 144);

  // Tenant 2
  addText(p14, 'tenant2_sig', 72, 467, 290);
  addText(p14, 'tenant2_date', 396, 456.8, 144);

  // Tenant 3
  addText(p14, 'tenant3_sig', 72, 375, 290);
  addText(p14, 'tenant3_date', 396, 364.5, 144);

  // Landlord 1
  addText(p14, 'landlord1_sig', 72, 255, 290);
  addText(p14, 'landlord1_date', 396, 244.5, 144);

  // Landlord 2
  addText(p14, 'landlord2_sig', 72, 162, 290);
  addText(p14, 'landlord2_date', 396, 151.5, 144);


  // ──────────────────────────────────────────────
  // Save
  // ──────────────────────────────────────────────
  form.updateFieldAppearances(helvetica);

  const filledBytes = await pdf.save();
  await writeFile(OUTPUT, filledBytes);
  console.log('Fillable PDF saved to: ' + OUTPUT);
  console.log('Total form fields: ' + form.getFields().length);
}

main().catch(err => { console.error(err); process.exit(1); });
