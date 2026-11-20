package main

// Page styles of the bond templates, copied from backend/modules/Loan/controllers (indemnity_bond.go, tml_documents.go).

const bondStyleEn = `
body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;line-height:1.55;font-size:14px;padding:0}
h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol li{margin-bottom:10px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:130px}
.lender-sig img{width:100%;max-height:40px;object-fit:contain;display:block}
/* The KML letter has no Borrower/Lender row; the lender signs over the
 * "Loan Sanctioned" line instead, right-aligned. The <img> only exists when
 * the business has uploaded a signature, so the line keeps a fixed gap above
 * it for a wet-ink signature either way. */
.sanction-sig{width:210px;margin:-30px 0 0 auto;text-align:center}
.sanction-sig .slot{height:46px;display:flex;align-items:flex-end;justify-content:center}
.sanction-sig .sig-img{max-height:44px;max-width:170px;display:block}
.sanction-sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:2px;font-size:12.5px}
/* No forced page-break here (unlike the Gujarati deed's .sig-page below) —
 * this bond's whole point is fitting the short KML letterhead letter onto
 * ONE A4 page for a plain print. The signature/release block now just
 * flows naturally after the main content. This does mean a bond sent for
 * Aadhaar eSign no longer has a guaranteed page-bottom landing spot for
 * Setu's stamp the way the old forced-second-page version did — re-verify
 * StartIndemnityBondSign's eSign stamp placement after this change. */
.sig-page{}
/* GML deeds only (gml-bond-english/gujarati.html): the Schedule, Place/Date
 * and the signing block are one .deed-end page that always starts on a fresh
 * sheet, so the Schedule is never separated from the signatures. min-height is
 * the A4 printable height (11.69in less the 0.75in header and 0.55in footer
 * bands = 10.39in = 264mm, minus a hair so it never spills onto a blank page),
 * and .sig-bottom's margin-top:auto pins the Borrower/Lender row to the bottom
 * of that page. UPDATE: no longer pinned — a fixed 56px gap follows the Place/Date lines instead, so the last page is not mostly empty space; the eSign stamp position is measured from the rendered block (see esignSlotsJS), not fixed. */
.deed-end{page-break-before:always;break-inside:avoid}
.deed-end .sig-bottom{margin-top:56px}
/* Borrower/Lender row: a taller gap between the party label and its line, so the 36pt eSign stamp (data-esign-dy) fits between them instead of overlapping "The Borrower". The lender image is re-seated to match. */
.deed-end .sig-bottom .sig span{margin-top:68px}
.deed-end .sig-bottom .sig:last-child .lender-sig{top:42px}
`

const bondStyleMl = `
body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:0;line-height:1.6;font-size:14px;padding:0}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 10px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #999;padding:4px 7px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:8px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:20px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center}
.sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:16px;font-size:12.5px}
/* Lender's signature over the "Loan Sanctioned" line — see bondPageStyle. */
.sanction-sig{width:210px;margin:-30px 0 0 auto;text-align:center}
.sanction-sig .slot{height:46px;display:flex;align-items:flex-end;justify-content:center}
.sanction-sig .sig-img{max-height:44px;max-width:170px;display:block}
.sanction-sig span{display:block;border-top:1px solid #333;padding-top:4px;margin-top:2px;font-size:12.5px}
/* No forced page-break — see bondPageStyle's .sig-page comment. */
.sig-page{}
`

const bondStyleGu = `
body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;margin:0;line-height:1.7;font-size:14px;padding:0}
h1{font-size:19px;text-align:center;margin:0 0 2px;letter-spacing:.3px}
h2{font-size:14px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
th{background:#f3ede1} .num{text-align:right}
ol{padding-left:22px} ol li{margin-bottom:12px;text-align:justify}
.sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
.sig{break-inside:avoid}
.sig>div{flex:1;text-align:center;position:relative}
.sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
/* Absolutely positioned — sits inside the existing blank gap the .sig
 * span's own 44px margin-top already reserves, rather than adding its
 * own height to the flow (which would push the Lender's line lower than
 * the image-less Borrower's line beside it — see print.ts's identical
 * fix for the on-screen/print copy of this same bond). */
.lender-sig{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:130px}
.lender-sig img{width:100%;max-height:40px;object-fit:contain;display:block}
/* GML deeds only (gml-bond-english/gujarati.html): the Schedule, Place/Date
 * and the signing block are one .deed-end page that always starts on a fresh
 * sheet, so the Schedule is never separated from the signatures. min-height is
 * the A4 printable height (11.69in less the 0.75in header and 0.55in footer
 * bands = 10.39in = 264mm, minus a hair so it never spills onto a blank page),
 * and .sig-bottom's margin-top:auto pins the Borrower/Lender row to the bottom
 * of that page. UPDATE: no longer pinned — a fixed 56px gap follows the Place/Date lines instead, so the last page is not mostly empty space; the eSign stamp position is measured from the rendered block (see esignSlotsJS), not fixed. */
.deed-end{page-break-before:always;break-inside:avoid}
.deed-end .sig-bottom{margin-top:56px}
/* Borrower/Lender row: a taller gap between the party label and its line, so the 36pt eSign stamp (data-esign-dy) fits between them instead of overlapping "The Borrower". The lender image is re-seated to match. */
.deed-end .sig-bottom .sig span{margin-top:68px}
.deed-end .sig-bottom .sig:last-child .lender-sig{top:42px}
`

const bondStyleTml = `
@page{size:A4;margin:.2in .3in .2in .3in}
*{box-sizing:border-box}
body{margin:0;padding:0;width:100%;font-family:Arial,'Noto Sans Tamil','Nirmala UI',sans-serif;font-size:13px;color:#000;line-height:1.3}
table{border-collapse:collapse}
td,th{overflow-wrap:anywhere}
.serif{font-family:'Times New Roman',Times,serif}
.hdr{position:relative;height:140px;border:3px solid #000;text-align:center;padding:5px 190px 0;overflow:hidden}
.hdr .logo{position:absolute;left:20px;top:22px;width:110px;height:90px;object-fit:contain}
.hdr h1{margin:0;color:var(--brand,#423591);font-family:'Times New Roman',Georgia,serif;font-size:34px;line-height:40px;letter-spacing:2px;text-transform:uppercase}
.hdr b{display:block;font-size:13px;line-height:16px}
.hdr b.ad{font-family:'Times New Roman',serif;font-size:19px;line-height:22px}
.hdr .tag{display:inline-block;width:162px;height:26px;line-height:24px;border:1px solid #000;margin-top:3px;font-family:'Times New Roman',serif;font-size:19px}
.hdr .by{position:absolute;right:12px;top:62px;width:168px}
.hdr .by span{display:block;text-align:center;font-family:'Times New Roman',serif;font-size:15px;margin-bottom:5px}
.hdr .by div{height:41px;line-height:39px;border:1px solid #000;padding:0 9px;font-size:15px;white-space:nowrap}
.top{display:flex;margin-top:10px;min-height:142px;align-items:flex-start}
.cust{width:213px;height:142px;table-layout:fixed}
.cust td{border:2px solid #000;padding:2px 7px;font-weight:700;font-size:13px;vertical-align:top}
.cust tr:first-child td,.cust tr:last-child td{height:25px;vertical-align:middle}
.cust td:first-child{width:84px;white-space:nowrap;font-size:12.5px}
.pbox{margin-left:9px;width:281px;height:142px;position:relative}
.pbox .lbl{position:absolute;top:0;width:134px;text-align:center;font-family:'Times New Roman',serif;font-weight:700;font-size:14px;text-decoration:underline}
.pbox .frame{position:absolute;left:0;right:0;bottom:0;height:120px;border:1px solid #000}
.photo{position:absolute;top:3px;width:134px;height:112px;display:flex;align-items:center;justify-content:center;text-align:center;color:#888;font-size:11px;overflow:hidden}
.photo img{width:100%;height:100%;object-fit:cover}
.p1{left:3px}
.p2{left:144px}
.loan{margin-left:13px;width:210px;height:116px;table-layout:fixed}
.loan td{border:1px solid #000;padding:2px 6px;font-family:'Times New Roman',serif;font-size:13px;line-height:14px}
.loan td:first-child{width:66px}
.loan td:last-child{font-family:Arial,sans-serif;font-weight:700;font-size:13px}
/* The declaration, amount in words and signature box stack in flow (the box sits
 * right under the words, leaving the rest of the block free for signing), so a
 * long name or a two-line amount moves the box down instead of running under
 * it. Left-aligned: justifying long Tamil words in this column left wide gaps
 * between them. */
.mid{display:flex;margin-top:12px;min-height:262px;align-items:stretch}
.decl{display:flex;flex-direction:column;width:418px;line-height:21px;font-size:12.5px;text-align:left;overflow-wrap:anywhere}
.decl .tx{margin:0;word-spacing:4px}
.decl .words{margin:6px 0 4px;font-family:'Times New Roman',serif;font-size:14px;line-height:18px}
.sig{margin-top:4px;width:229px;height:38px;flex-shrink:0;border:1px solid #000;padding:0 8px;display:flex;align-items:center;font-family:'Times New Roman',serif;font-size:15px;line-height:17px}
.esign-slot{display:inline-block;width:150px}
.right{margin-left:16px;width:302px}
.items{width:100%;table-layout:fixed;font-size:13px}
.items th,.items td{border:1px solid #000;padding:3px 6px;text-align:left}
.items th{font-family:'Times New Roman',serif;font-size:14px;line-height:15px}
.items.main{border:2px solid #000;border-bottom:0}
.items.main tr.pad td{height:28px;border-top:0;border-bottom:0}
.items.main td:last-child,.items.main th:last-child,.items.tot td,.items.tot th{text-align:center}
.items.tot{border:2px solid #000;margin-top:0}
.items.tot th{font-size:13px;height:19px;padding:1px 6px}
.items.tot td{font-family:Arial,sans-serif;font-weight:700;font-size:14px;height:33px}
.pay{display:grid;grid-template-columns:213px 230px 1fr auto;border-bottom:1.5px solid #000;margin-top:30px;padding:0 40px 3px 4px;font-family:'Times New Roman',serif;font-size:14px;line-height:16px}
.pay span:last-child{text-align:right}
.recv{margin:6px 0 0;font-size:12.5px;line-height:21px;word-spacing:2px;overflow-wrap:anywhere}
.foot{display:flex;margin-top:12px;padding-left:28px;font-size:14px;line-height:18px}
.foot span:nth-child(1){width:264px}
.foot span:nth-child(2){width:219px}
.cut{border-top:1.5px dashed #000;margin:4px 0 6px}
.rcpt{display:flex;height:352px;break-inside:avoid;page-break-inside:avoid}
.rcpt .l{position:relative;margin-left:16px;width:454px;height:352px;border:1px solid #000;overflow:hidden}
.rcpt .l .lg{position:absolute;left:12px;top:24px;width:80px;height:60px;object-fit:contain}
.rcpt .l .hd{position:absolute;left:0;right:0;top:4px;text-align:center;line-height:15px}
.rcpt h2{margin:0;color:var(--brand,#423591);font-family:'Times New Roman',Georgia,serif;font-size:27px;line-height:29px;letter-spacing:1px;text-transform:uppercase}
.rcpt .hd .ad{font-family:'Times New Roman',serif;font-size:15px;font-weight:700;line-height:16px}
.rcpt .hd .ct{font-size:11.5px;font-weight:700;line-height:14px}
.rcpt .hd .gl{font-family:'Times New Roman',serif;font-size:14px;font-weight:700;line-height:17px}
.rcpt .l .rule{position:absolute;left:6px;right:6px;top:100px;border-top:1px solid #000}
/* Body band between the header rule and the terms (106px–278px): the table's
 * fixed height spreads its six rows evenly over it. Labels hold one line in a
 * fixed column; a long value (the customer name) wraps under itself, after the
 * colon, and takes its extra line from the spare row height. */
.rg{position:absolute;left:5px;top:106px;width:206px;height:172px;font-size:13px;table-layout:fixed}
.rg td{padding:0 4px 0 0;font-family:'Times New Roman',serif;font-size:13px;line-height:15px;vertical-align:middle}
.rg td:first-child{width:68px;white-space:nowrap}
.rg td+td{font-weight:700;padding-left:18px;text-indent:-8px;overflow-wrap:anywhere}
.rg tr:first-child td+td{white-space:nowrap}
.orn{position:absolute;left:214px;top:106px;width:124px;font-family:'Times New Roman',serif;font-size:14px;line-height:19px}
.orn u{font-weight:700;white-space:nowrap}
.orn .oi{display:block;white-space:nowrap}
/* Jewel photo at the top of the band, the authorised signature at its foot. */
.jw{position:absolute;left:335px;top:106px;width:112px;height:172px;display:flex;flex-direction:column;align-items:center;text-align:center;font-family:'Times New Roman',serif;font-size:14px;line-height:17px}
.jw u{font-weight:700}
.sm{width:92px;height:64px;margin:4px auto 0;border:1px solid #000;font-size:10px;color:#888;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sm img{width:100%;height:100%;object-fit:cover}
.jw .ls{margin-top:auto;height:24px;display:flex;align-items:flex-end;justify-content:center}
.jw .ls .sig-img{max-height:20px;max-width:90px;display:block}
.jw small{display:block;font-size:11px;line-height:13px;white-space:nowrap}
.terms{position:absolute;left:6px;right:6px;bottom:4px;text-align:center;font-family:'Times New Roman','Noto Sans Tamil',serif;font-size:10.5px;line-height:14px;border-top:1px solid #000;padding-top:3px}
.terms div{white-space:nowrap;overflow:hidden}
html[lang=ta] .terms{font-size:9.4px}
.rcpt .r{margin-left:24px;border-left:1.5px dashed #999;padding:30px 0 0 16px;flex:1;font-size:14px;line-height:22px;overflow:hidden}
.rcpt .r h3{margin:0 0 4px;font-size:17px;line-height:22px}
/* Package Details: same label / value columns as the receipt, so a wrapped
 * name continues under itself instead of under the labels. */
.pk td{padding:0;font-size:14px;line-height:22px;vertical-align:top}
.pk td:first-child{width:76px;font-weight:700;white-space:nowrap}
.pk td+td{padding-left:8px;text-indent:-8px;overflow-wrap:anywhere}
.pk tr:last-child td{font-weight:700}
.pqr{margin-top:8px;text-align:center;font-size:11px;line-height:13px;width:130px}
.pqr img{display:block;width:118px;height:118px;margin:0 auto 2px}
`
