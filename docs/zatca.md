# ZATCA e-invoicing (FATOORA) — design notes

> **Compliance status: NOT COMPLIANT. Nothing is implemented yet (planned for Phase 6).**
> This document summarises our understanding of the published requirements to guide the design.
> It is not legal or tax advice. Before implementation, re-read the current official documents
> (they are revised periodically): *E-Invoicing Regulation*, *Resolution on the Controls,
> Requirements, Technical Specifications and Procedural Rules*, *XML Implementation Standard*,
> *Security Features Implementation Standard*, *Data Dictionary*, and the *Developer Portal* /
> Fatoora API documentation. Compliance may only be claimed after validation with ZATCA's SDK,
> the sandbox, the simulation environment and successful production onboarding.

## Requirements as currently understood

| Topic | Requirement (summary) | Our design |
| --- | --- | --- |
| Phase 1 "Generation" | Electronic invoices from a compliant solution. Simplified invoices carry a QR code. | Superseded by Phase 2 for our target customers. |
| Phase 2 "Integration" | Rolled out in taxpayer waves. Invoices are UBL 2.1 XML, integrated with FATOORA. | Built in Phase 6, before any production POS use. |
| Standard tax invoice (B2B, `0100000`) | **Clearance**: submit to ZATCA and receive the cleared/stamped invoice *before* giving it to the buyer. | Requires connectivity. The POS queues the sale as "pending clearance" and does not hand over the invoice until it is cleared. |
| Simplified tax invoice (B2C, `0200000`) | Issued and signed by the taxpayer's solution, **reported** within 24 hours. | Signed on the device, works offline, reported by the sync engine. A dashboard alarm fires when the 24 h deadline is near. |
| Credit / debit notes | Reference the original invoice. Same clearance/reporting rules as the invoice type. | Returns create credit notes, never edits. |
| Invoice identity | UUID, Invoice Counter Value (ICV, sequential per EGS unit), Previous Invoice Hash (PIH) chain. The first PIH is the hash of `"0"`. | Per-device counter and hash chain stored in the device's local DB and mirrored to the server. Counters can never be reused, including after reinstall (they are recovered from the server). |
| Cryptography | SHA-256 invoice hash, ECDSA on secp256k1, XAdES-style signature, X.509 certificate (CSID) issued by ZATCA. | Private key generated on the device and kept in Android Keystore or Windows DPAPI (Tauri). It never leaves the device. |
| QR code | Base64 TLV. Tags 1–5 (seller name, VAT no., timestamp, total incl. VAT, VAT total), plus in Phase 2 tags 6–9 (hash, signature, public key, CA signature for simplified). | Generated in `@erp/domain` (TLV encoder) with unit tests against ZATCA sample invoices. |
| Onboarding | Per EGS unit: CSR → OTP from the FATOORA portal → compliance CSID → compliance checks (sample invoices of each type) → production CSID. CSIDs expire and must be renewed. | Device registration flow in Phase 6. Each POS device and the back-office server are separate EGS units. |
| Seller data | Arabic seller name, VAT number (15 digits, starts and ends with 3), CR or other ID, national address (building no. 4 digits, postal code 5 digits, street, district, city). | **Phase 1 stores these fields and validates the format only** (`packages/domain/src/saudi.ts`). |
| Buyer data (B2B) | VAT number and address of the buyer for standard invoices. | Customer master (Phase 5). |
| Line VAT category | UNCL5305 category S (15%), Z, E, O. Exemption reason code (`VATEX-SA-…`) required for Z/E/O. | Phase 1 stores `tax_category` and `tax_exemption_reason_code` on products. The DB requires a reason code for Z/E/O. |
| Archiving | Retain invoices (XML) for the statutory period, in KSA. | Supabase project region and backup policy must satisfy data residency. Decide before production (open question). |

## Validation plan (Phase 6 exit criteria)

1. Unit tests: TLV QR encoding, canonicalisation and hashing against ZATCA SDK sample files.
2. Every generated invoice type passes `fatoora -validate` (ZATCA SDK) in CI.
3. Compliance CSID obtained in the **sandbox** (developer portal), all compliance checks pass.
4. End-to-end run on the **simulation** environment, including offline reporting after 24 h of simulated outage, credit notes, and clearance rejection handling.
5. External review by a ZATCA-experienced consultant or solution provider.
6. Only then may documentation or marketing use the word "compliant".

## Open questions

* Data residency of the Supabase project (KSA region availability) vs. archiving requirements.
* Whether each Android POS device is treated as its own EGS unit, or the back-office signs on the device's behalf. The current plan is per device, so signing works offline.
* Wave / deadline applicable to each customer organization.
