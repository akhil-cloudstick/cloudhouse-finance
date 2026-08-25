/* Ambika Gold Finance — admin frontend (prototype, no backend) */
(function(){
'use strict';
const $ = s => document.querySelector(s);
const view = $('#view');
const D = window.DB;

const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtW = n => n.toFixed(1) + ' g';
const custOf = id => D.customers.find(c=>c.id===id) || {name:'—', id};
const schemeOf = id => D.schemes.find(s=>s.id===id) || {name:'—'};
const initials = n => n.split(' ').map(w=>w[0]).slice(0,2).join('');

const statusChip = s => {
  const m = {
    'Active':'green','Closed':'gray','Due Soon':'amber','Overdue':'red',
    'Pending Approval':'blue','Auction Eligible':'red','Verified':'green',
    'Pending':'amber','Failed':'red','Completed':'gray','Approved':'green',
    'Locker Stored':'gold','Bank Pledged':'blue','Ready for Release':'amber',
    'Released':'gray','Notice Issued':'amber','Not Pledged':'gray','Auction Scheduled':'red',
  };
  return `<span class="chip ${m[s]||'gray'}">${s}</span>`;
};

function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* read an image file, downscale to ≤900px JPEG data-URL (keeps localStorage small) */
function shrinkImage(file, cb){
  const rd = new FileReader();
  rd.onload = e => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 900/Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width*sc); cv.height = Math.round(img.height*sc);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.src = e.target.result;
  };
  rd.readAsDataURL(file);
}

/* open a print-friendly window with the given document body and trigger print */
function printDoc(title, body){
  const w = window.open('', '_blank');
  if(!w){ toast('Popup blocked — please allow popups for this site to print'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
    h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
    h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
    th{background:#f3ede1} .num{text-align:right}
    ol li{margin-bottom:10px;text-align:justify}
    .sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
    .sig div{flex:1;text-align:center}
    .sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
    .muted{color:#666;font-size:12.5px}
    @media print{.noprint{display:none}}
  </style></head><body>${body}
  <div class="noprint" style="text-align:center;margin-top:30px">
    <button onclick="window.print()" style="padding:10px 26px;font-size:14px;cursor:pointer">🖨 Print</button></div>
  </body></html>`);
  w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
}

/* ── modal helpers ─────────────────────────── */
function openModal(html, wide){
  $('#modalBox').className = 'modal' + (wide?' wide':'');
  $('#modalBox').innerHTML = html;
  $('#modalBg').classList.add('open');
}
function closeModal(){ $('#modalBg').classList.remove('open'); }
window.closeModal = closeModal;
$('#modalBg') && $('#modalBg').addEventListener('click', e=>{ if(e.target.id==='modalBg') closeModal(); });

/* ── ROUTES ────────────────────────────────── */
const routes = {
  dashboard: renderDashboard,
  customers: renderCustomers,
  customer:  renderCustomerDetail,
  loans:     renderLoans,
  loan:      renderLoanDetail,
  newloan:   renderNewLoan,
  schemes:   renderSchemes,
  goldrates: renderGoldRates,
  packets:   renderPackets,
  cash:      renderCash,
  calendar:  renderCalendar,
  requests:  renderRequests,
  bankpledge:renderBankPledge,
  auctions:  renderAuctions,
  reports:   renderReports,
  employees: renderEmployees,
};

function router(){
  const hash = location.hash.replace('#','') || 'dashboard';
  const [route, arg] = hash.split('/');
  const fn = routes[route] || renderDashboard;
  document.querySelectorAll('.nav a').forEach(a=>{
    a.classList.toggle('on', a.getAttribute('href')==='#'+route ||
      (route==='loan'&&a.getAttribute('href')==='#loans') ||
      (route==='customer'&&a.getAttribute('href')==='#customers'));
  });
  $('#crumb').innerHTML = 'Ambika Gold Finance &nbsp;/&nbsp; <b>' + (titles[route]||'Dashboard') + '</b>';
  $('#side').classList.remove('open');
  view.innerHTML = '';
  fn(arg);
  window.scrollTo(0,0);
  refreshRateChip();
}
const titles = {
  dashboard:'Dashboard', customers:'Customers & KYC', customer:'Customer 360°',
  loans:'Loans', loan:'Loan Details', newloan:'New Gold Loan', schemes:'Loan Schemes',
  goldrates:'Gold Rates', packets:'Packets & Lockers', cash:'Cash & Expenses',
  calendar:'Reminder Calendar', requests:'Extensions & Release', bankpledge:'Bank Re-Pledge',
  auctions:'Auctions', reports:'Reports', employees:'Employees',
};

function refreshRateChip(){
  $('#rateChip').innerHTML = `<span class="dot"></span> 22K <b>${fmt(D.rates.k22)}/g</b> · 24K <b>${fmt(D.rates.k24)}/g</b>`;
}

/* ── DASHBOARD ─────────────────────────────── */
function renderDashboard(){
  const active   = D.loans.filter(l=>['Active','Due Soon','Overdue'].includes(l.status));
  const overdue  = D.loans.filter(l=>l.status==='Overdue');
  const dueSoon  = D.loans.filter(l=>l.status==='Due Soon');
  const pledged  = D.loans.filter(l=>l.pledge==='Bank Pledged');
  const outstanding = active.reduce((s,l)=>s+l.outstanding,0);
  const pendingReq  = D.requests.filter(r=>r.status==='Pending');
  const expToday    = D.expenses.filter(e=>e.d==='2026-07-30').reduce((s,e)=>s+e.amt,0);
  const openedToday = D.loans.filter(l=>l.opened==='2026-07-30').length;

  view.innerHTML = `
  <div class="page-h">
    <div><h1>Business Overview</h1><p>Wednesday, 30 July 2026 · Koratty (Head Office)</p></div>
    <div class="sp"></div>
    <button class="btn" onclick="openRateModal()">${icon('coin')} Set Today's Gold Rate</button>
    <a class="btn ghost" href="#newloan">${icon('plus')} New Loan</a>
    <button class="btn ghost" onclick="openCustomerModal()">${icon('user')} Register Customer</button>
  </div>
  <hr class="gold-rule">

  <div class="grid cols21">
    <div class="grid">
      <div class="kpis">
        ${kpi('Cash in Hand', fmt(482350), 'Opening ₹5,10,000', 'ok')}
        ${kpi('Loans Opened Today', openedToday, '2 more in draft')}
        ${kpi('Active Loans', active.length, fmt(outstanding)+' outstanding')}
        ${kpi('Due Soon', dueSoon.length, 'within 14 days', dueSoon.length?'warn':'')}
        ${kpi('Overdue Loans', overdue.length, fmt(overdue.reduce((s,l)=>s+l.outstanding,0))+' at risk', overdue.length?'warn':'')}
        ${kpi('Pending Approvals', D.approvals.length, 'awaiting sanction', D.approvals.length?'warn':'')}
        ${kpi('Extension Requests', pendingReq.filter(r=>r.type==='Extension').length, 'from mobile app')}
        ${kpi('Gold Release Requests', pendingReq.filter(r=>r.type==='Release').length, 'settlement review')}
        ${kpi('Bank-Pledged Loans', pledged.length, fmt(pledged.reduce((s,l)=>s+l.principal,0))+' re-pledged')}
        ${kpi('Auction Cases', D.auctions.length, 'notice stage', D.auctions.length?'warn':'')}
        ${kpi("Today's Expenses", fmt(expToday), D.expenses.filter(e=>e.status==='Pending').length+' pending approval')}
        ${kpi('Interest Collected (Jul)', fmt(48210), '↑ 12% vs June', 'ok')}
      </div>

      <div class="card gtop">
        <div class="hd"><h3>Loan Portfolio — Disbursement (last 6 months)</h3><div class="sp"></div><a href="#reports" style="font-size:12.5px">All reports →</a></div>
        <div class="bd">
          <div class="bars">
            ${[['Feb',6.2],['Mar',7.4],['Apr',5.9],['May',8.1],['Jun',7.2],['Jul',9.3]].map(([m,v])=>
              `<div class="b"><em>₹${v}L</em><i style="height:${v/9.3*100}%"></i><span>${m}</span></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>Needs Attention</h3><div class="sp"></div><a href="#requests" style="font-size:12.5px">View all →</a></div>
        <div class="bd" style="padding-top:6px">
          <ul class="mini-list">
            ${D.approvals.map(a=>`
              <li><span class="ic">${icon('stamp')}</span>
                <span class="tx"><b>Loan approval — ${a.loan}</b><small>${a.cust} · ${fmt(a.amt)} · at ${a.stage} stage</small></span>
                <span class="rt"><a class="btn sm" href="#loan/${a.loan}">Review</a></span></li>`).join('')}
            ${pendingReq.map(r=>`
              <li><span class="ic">${icon(r.type==='Extension'?'clock':'unlock')}</span>
                <span class="tx"><b>${r.type} request — ${r.loan}</b><small>${r.cust} · ${r.detail}</small></span>
                <span class="rt"><a class="btn sm ghost" href="#requests">Open</a></span></li>`).join('')}
            ${D.auctions.map(a=>`
              <li><span class="ic" style="background:var(--red-bg);color:var(--red)">${icon('gavel')}</span>
                <span class="tx"><b>Auction case — ${a.loan}</b><small>${a.cust} · ${fmt(a.outstanding)} outstanding · ${a.stage}</small></span>
                <span class="rt"><a class="btn sm ghost" href="#auctions">Open</a></span></li>`).join('')}
          </ul>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card gtop">
        <div class="hd"><h3>Today's Gold Rate</h3><div class="sp"></div><span style="font-size:11.5px;color:var(--muted)">${D.rates.date}</span></div>
        <div class="bd">
          <div class="rates3" style="grid-template-columns:1fr">
            ${rateTile('24K · 999', D.rates.k24)}
            ${rateTile('22K · 916', D.rates.k22)}
            ${rateTile('18K · 750', D.rates.k18)}
          </div>
        </div>
        <div class="ft">Set by ${D.rates.setBy} · applies to all valuations today</div>
      </div>

      <div class="card">
        <div class="hd"><h3>Gold Loan Calculator</h3></div>
        <div class="bd">
          <div class="frow c2">
            <div><label class="f">Weight (grams)</label><input class="inp" id="calcW" type="number" value="10" min="0"></div>
            <div><label class="f">Purity</label>
              <select class="inp" id="calcP"><option value="k24">24K</option><option value="k22" selected>22K</option><option value="k18">18K</option></select></div>
          </div>
          <div class="frow"><div><label class="f">Scheme</label>
            <select class="inp" id="calcS">${D.schemes.filter(s=>s.active).map(s=>`<option value="${s.id}">${s.name} — ${s.ltv}% LTV @ ${s.rate}%</option>`).join('')}</select></div></div>
          <div style="background:#fdf6dd;border:1px solid var(--gold-light);border-radius:8px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>Gross Gold Value</span><b id="calcGross">—</b></div>
            <div style="display:flex;justify-content:space-between;font-size:15px"><span style="font-weight:600">Eligible Loan Amount</span><b id="calcElig" style="color:var(--gold-deep);font-size:17px">—</b></div>
          </div>
        </div>
        <div class="ft">Weight × Rate = Gross Value · Gross × LTV = Eligible</div>
      </div>

      <div class="card">
        <div class="hd"><h3>Upcoming Reminders</h3><div class="sp"></div><a href="#calendar" style="font-size:12.5px">Calendar →</a></div>
        <div class="bd" style="padding-top:6px">
          <ul class="mini-list">
            ${[['GL-2044 interest due','Lakshmi Menon · 02 Aug','due'],
               ['Follow-up: Thomas George','Auction notice discussion · 07 Aug','fup'],
               ['GL-2035 interest due','Ananya Pillai · 12 Aug','due'],
               ['PTP: Suresh Kumar','Promised ₹4,200 · 15 Aug','fup']].map(([t,s,c])=>`
              <li><span class="ic" style="${c==='fup'?'background:var(--blue-bg);color:var(--blue)':''}">${icon(c==='fup'?'phone':'bell')}</span>
              <span class="tx"><b>${t}</b><small>${s}</small></span></li>`).join('')}
          </ul>
        </div>
      </div>

      <div class="card">
        <div class="hd"><h3>Expense Summary — July</h3></div>
        <div class="bd">${donut([['Salaries',96000,'#9a6f0f'],['Rent & Utilities',18500,'#d4af37'],['Marketing',7500,'#3b5f7a'],['Others',5470,'#b3a980']])}</div>
      </div>
    </div>
  </div>`;

  const recalc = ()=>{
    const w = parseFloat($('#calcW').value)||0;
    const rate = D.rates[$('#calcP').value];
    const sch = D.schemes.find(s=>s.id===$('#calcS').value);
    const gross = w*rate;
    $('#calcGross').textContent = fmt(gross);
    $('#calcElig').textContent = fmt(gross*sch.ltv/100);
  };
  ['calcW','calcP','calcS'].forEach(id=>$('#'+id).addEventListener('input',recalc));
  recalc();
}

function kpi(l,v,s,cls){ return `<div class="kpi ${cls||''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s||''}</div></div>`; }
function rateTile(k,r){ return `<div class="rate-tile"><div class="k">${k}</div><div class="r">${fmt(r)}</div><div class="u">per gram</div></div>`; }

function donut(parts){
  const total = parts.reduce((s,p)=>s+p[1],0);
  let acc=0; const stops = parts.map(p=>{ const a=acc/total*360; acc+=p[1]; return `${p[2]} ${a}deg ${acc/total*360}deg`; }).join(',');
  return `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(${stops})"><div class="c"><b>${fmt(total)}</b><small>total</small></div></div>
    <ul class="legend">${parts.map(p=>`<li><i style="background:${p[2]}"></i>${p[0]}<b>${fmt(p[1])}</b></li>`).join('')}</ul></div>`;
}

/* ── SET RATE MODAL ────────────────────────── */
window.openRateModal = function(){
  openModal(`
    <div class="hd"><h3>Set Today's Gold Rate</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="notice" style="margin-bottom:16px">${icon('shield')} Rate changes apply to all new valuations and are recorded in the audit trail.</div>
      <div class="frow c3">
        <div><label class="f">24K · 999 (₹/g)</label><input class="inp" id="r24" type="number" value="${D.rates.k24}"></div>
        <div><label class="f">22K · 916 (₹/g)</label><input class="inp" id="r22" type="number" value="${D.rates.k22}"></div>
        <div><label class="f">18K · 750 (₹/g)</label><input class="inp" id="r18" type="number" value="${D.rates.k18}"></div>
      </div>
      <div class="frow"><div><label class="f">Remarks (optional)</label><input class="inp" id="rRem" placeholder="e.g. MCX morning reference"></div></div>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveRate()">${icon('check')} Publish Rate</button>
    </div>`);
};
window.saveRate = function(){
  const r = { date: new Date().toISOString().slice(0,10),
    k24:+$('#r24').value||D.rates.k24, k22:+$('#r22').value||D.rates.k22, k18:+$('#r18').value||D.rates.k18,
    setBy:'Rajesh Menon' };
  Object.assign(D.rates, r);
  D.saveRates(r);
  closeModal(); toast('Gold rate published for today'); router();
};

/* ── REGISTER CUSTOMER MODAL ───────────────── */
window.openCustomerModal = function(){
  openModal(`
    <div class="hd"><h3>Register Customer</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow c2">
        <div><label class="f">Full Name *</label><input class="inp" id="ncName" placeholder="e.g. Anil Varma"></div>
        <div><label class="f">Mobile Number *</label><input class="inp" id="ncPhone" placeholder="10-digit mobile" maxlength="11"></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Date of Birth</label><input class="inp" id="ncDob" type="date"></div>
        <div><label class="f">Branch</label>
          <select class="inp" id="ncBranch"><option>Koratty</option><option>Angamaly</option><option>Kodakara</option></select></div>
      </div>
      <div class="frow"><div><label class="f">Address</label><input class="inp" id="ncAddr" placeholder="House / street, town, district"></div></div>
      <div class="frow c2">
        <div><label class="f">PAN Number</label><input class="inp" id="ncPan" placeholder="ABCDE1234F" maxlength="10" style="text-transform:uppercase"></div>
        <div><label class="f">Aadhaar (last 4 digits)</label><input class="inp" id="ncAad" placeholder="XXXX" maxlength="4"></div>
      </div>
      <div class="frow"><div><label class="f">Customer Photograph</label><input class="inp" id="ncPhoto" type="file" accept="image/*"></div></div>
      <div class="notice">${icon('shield')} PAN & Aadhaar verification runs through the authorized KYC service after registration. Loans stay blocked until KYC passes.</div>
      <p id="ncErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveCustomer()">${icon('check')} Register Customer</button>
    </div>`);
};
window.saveCustomer = function(){
  const name = $('#ncName').value.trim();
  const phone = $('#ncPhone').value.trim();
  const err = $('#ncErr');
  if(name.length < 3){ err.textContent = 'Please enter the customer’s full name.'; return; }
  if(!/^\d[\d ]{8,}$/.test(phone)){ err.textContent = 'Please enter a valid mobile number.'; return; }
  const nextNum = 1000 + D.customers.length + 1;
  const c = {
    id: 'CUST-' + nextNum,
    name, phone,
    dob: $('#ncDob').value || '—',
    addr: $('#ncAddr').value.trim() || '—',
    pan: 'P',
    aadhaar: 'P',
    kyc: 'Pending',
    photo: name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(),
    branch: $('#ncBranch').value,
    loans: [],
    since: new Date().toISOString().slice(0,10),
  };
  D.addCustomer(c);
  closeModal();
  toast(`${name} registered — ${c.id} · KYC verification pending`);
  location.hash = 'customer/' + c.id;
  if(location.hash === '#customer/' + c.id) router();
};

/* ── CUSTOMERS ─────────────────────────────── */
function renderCustomers(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Customers & KYC</h1><p>${D.customers.length} customers · PAN & Aadhaar verification status</p></div>
    <div class="sp"></div>
    <div class="search">${icon('search')}<input class="inp" id="cSearch" placeholder="Search name, phone, ID…"></div>
    <button class="btn" onclick="openCustomerModal()">${icon('plus')} Register Customer</button>
  </div>
  <hr class="gold-rule">
  <div class="card"><div class="tbl-wrap"><table class="tbl" id="cTbl">
    <thead><tr><th>Customer</th><th>Contact</th><th>Branch</th><th>PAN</th><th>Aadhaar / KYC</th><th>KYC Status</th><th class="num">Loans</th><th></th></tr></thead>
    <tbody></tbody></table></div></div>`;

  const vmark = v => v==='V' ? '<span class="chip green">Verified</span>' : v==='P' ? '<span class="chip amber">Pending</span>' : '<span class="chip red">Failed</span>';
  const draw = q => {
    const rows = D.customers.filter(c=>!q || (c.name+c.phone+c.id).toLowerCase().includes(q.toLowerCase()));
    $('#cTbl tbody').innerHTML = rows.map(c=>`
      <tr class="click" onclick="location.hash='customer/${c.id}'">
        <td><span class="id">${c.id}</span><span class="sub" style="font-size:13.5px;color:var(--charcoal);font-weight:500">${c.name}</span></td>
        <td>${c.phone}<span class="sub">${c.addr}</span></td>
        <td>${c.branch}</td>
        <td>${vmark(c.pan)}</td><td>${vmark(c.aadhaar)}</td>
        <td>${statusChip(c.kyc)}</td>
        <td class="num">${c.loans.length}</td>
        <td style="text-align:right;color:var(--gold-deep)">›</td>
      </tr>`).join('') || `<tr><td colspan="8" class="empty">No customers match your search.</td></tr>`;
  };
  $('#cSearch').addEventListener('input', e=>draw(e.target.value));
  draw('');
}

function renderCustomerDetail(id){
  const c = D.customers.find(x=>x.id===id);
  if(!c){ view.innerHTML = '<div class="empty">Customer not found.</div>'; return; }
  const cLoans = D.loans.filter(l=>l.cust===c.id);
  const disbursed = cLoans.reduce((s,l)=>s+l.principal,0);
  const out = cLoans.reduce((s,l)=>s+(l.status==='Closed'?0:l.outstanding),0);
  view.innerHTML = `
  <div class="page-h">
    <div class="dhead">
      <div class="big-av">${initials(c.name)}</div>
      <div><h1 style="font-size:26px">${c.name}</h1><p>${c.id} · Customer since ${c.since} · ${c.branch} branch</p></div>
    </div>
    <div class="sp"></div>
    <button class="btn ghost sm" onclick="toast('SMS/WhatsApp composer — full build')">${icon('chat')} Message</button>
    <a class="btn sm" href="#newloan">${icon('plus')} New Loan</a>
  </div>
  <hr class="gold-rule">
  <div class="grid cols12">
    <div class="grid">
      <div class="card gtop"><div class="hd"><h3>KYC & Verification</h3></div>
        <div class="bd">
          <div class="kv">
            <div class="i"><div class="k">PAN</div><div class="v">${c.pan==='V'?'✔ Verified':(c.pan==='P'?'⏳ Pending':'✖ Failed')}</div></div>
            <div class="i"><div class="k">Aadhaar / KYC</div><div class="v">${c.aadhaar==='V'?'✔ Verified':(c.aadhaar==='P'?'⏳ Pending':'✖ Failed')}</div></div>
            <div class="i"><div class="k">Overall</div><div class="v">${statusChip(c.kyc)}</div></div>
            <div class="i"><div class="k">Date of Birth</div><div class="v">${c.dob}</div></div>
            <div class="i"><div class="k">Phone</div><div class="v">${c.phone}</div></div>
            <div class="i"><div class="k">Address</div><div class="v">${c.addr}</div></div>
          </div>
          ${c.kyc!=='Verified' ? `<div class="notice" style="margin-top:14px">${icon('shield')} Loan operations are blocked until mandatory KYC checks pass.</div>`:''}
        </div></div>
      <div class="card"><div class="hd"><h3>Relationship Summary</h3></div>
        <div class="bd"><div class="kv">
          <div class="i"><div class="k">Total Disbursed</div><div class="v">${fmt(disbursed)}</div></div>
          <div class="i"><div class="k">Outstanding</div><div class="v">${fmt(out)}</div></div>
          <div class="i"><div class="k">Active Loans</div><div class="v">${cLoans.filter(l=>l.status!=='Closed').length}</div></div>
          <div class="i"><div class="k">Closed Loans</div><div class="v">${cLoans.filter(l=>l.status==='Closed').length}</div></div>
          <div class="i"><div class="k">SMS Reminders</div><div class="v">6 sent</div></div>
          <div class="i"><div class="k">Follow-ups</div><div class="v">2 recorded</div></div>
        </div></div></div>
    </div>
    <div class="card"><div class="hd"><h3>Loan History</h3></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Loan</th><th>Scheme</th><th>Opened / Due</th><th class="num">Principal</th><th class="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
        <tbody>${cLoans.map(l=>loanRow(l)).join('')||'<tr><td colspan="7" class="empty">No loans yet.</td></tr>'}</tbody>
      </table></div></div>
  </div>`;
}

/* ── LOANS ─────────────────────────────────── */
function loanRow(l){
  const c = custOf(l.cust);
  return `<tr class="click" onclick="location.hash='loan/${l.id}'">
    <td><span class="id">${l.id}</span><span class="sub">${c.name}</span></td>
    <td>${schemeOf(l.scheme).name}</td>
    <td>${l.opened}<span class="sub">due ${l.due}</span></td>
    <td class="num">${fmt(l.principal)}</td>
    <td class="num">${l.outstanding?fmt(l.outstanding):'—'}</td>
    <td>${statusChip(l.pledge)}</td>
    <td>${statusChip(l.status)}</td></tr>`;
}

function renderLoans(){
  const cats = ['All','Active','Due Soon','Overdue','Pending Approval','Auction Eligible','Closed'];
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Loans</h1><p>All customer loans with search and status filters</p></div>
    <div class="sp"></div>
    <div class="search">${icon('search')}<input class="inp" id="lSearch" placeholder="Search loan ID or customer…"></div>
    <a class="btn" href="#newloan">${icon('plus')} New Gold Loan</a>
  </div>
  <hr class="gold-rule">
  <div style="margin-bottom:14px" class="tabs" id="lTabs">${cats.map((c,i)=>`<button class="${i===0?'on':''}" data-c="${c}">${c}</button>`).join('')}</div>
  <div class="card"><div class="tbl-wrap"><table class="tbl" id="lTbl">
    <thead><tr><th>Loan / Customer</th><th>Scheme</th><th>Opened / Due</th><th class="num">Principal</th><th class="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
    <tbody></tbody></table></div></div>`;

  let cat='All', q='';
  const draw = ()=>{
    const rows = D.loans.filter(l=>(cat==='All'||l.status===cat) &&
      (!q || (l.id+custOf(l.cust).name).toLowerCase().includes(q.toLowerCase())));
    $('#lTbl tbody').innerHTML = rows.map(loanRow).join('') || `<tr><td colspan="7" class="empty">No loans in this category.</td></tr>`;
  };
  $('#lTabs').addEventListener('click', e=>{
    if(e.target.tagName!=='BUTTON')return;
    document.querySelectorAll('#lTabs button').forEach(b=>b.classList.remove('on'));
    e.target.classList.add('on'); cat=e.target.dataset.c; draw();
  });
  $('#lSearch').addEventListener('input', e=>{q=e.target.value;draw()});
  draw();
}

function renderLoanDetail(id){
  const l = D.loans.find(x=>x.id===id);
  if(!l){ view.innerHTML = '<div class="empty">Loan not found.</div>'; return; }
  const c = custOf(l.cust), s = schemeOf(l.scheme);
  const orns = D.ornaments[l.id]||[];
  const led  = D.ledger[l.id]||[];

  // photos come from the New Loan form (o.img); agf_orn_photos keeps any older attachments
  const legacyPhotos = (JSON.parse(localStorage.getItem('agf_orn_photos') || '{}'))[l.id] || {};
  const photoOf = i => (orns[i] && orns[i].img) || legacyPhotos[i] || null;
  window.viewLoanOrnImg = function(i){
    openModal(`
      <div class="hd"><h3>${orns[i].n} — ${l.id}</h3><button class="x" onclick="closeModal()">×</button></div>
      <div class="bd" style="text-align:center"><img src="${photoOf(i)}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`, true);
  };
  const trackStages = ['Loan Created','Packet Generated','Locker Stored','Bank Pledged','Returned','Ready for Release','Released'];
  const doneUpto = l.status==='Closed'?7 : l.pledge==='Bank Pledged'?4 : l.packet==='—'?1 : l.status==='Auction Eligible'?3:3;

  view.innerHTML = `
  <div class="page-h">
    <div><h1>${l.id} ${statusChip(l.status)}</h1>
      <p><a href="#customer/${c.id}">${c.name}</a> · ${s.name} · opened ${l.opened} · due ${l.due}</p></div>
    <div class="sp"></div>
    ${l.status==='Pending Approval'
      ? `<button class="btn" onclick="toast('Approved (demo) — moves to next sanction level in full build')">${icon('check')} Approve</button>
         <button class="btn danger" onclick="toast('Rejected (demo)')">Reject</button>`
      : `<button class="btn ghost sm" onclick="toast('Receipt/statement PDF — full build')">${icon('doc')} Statement</button>
         ${l.status!=='Closed'&&l.pledge!=='Bank Pledged'?`<button class="btn ghost sm" onclick="openRepledgeModal('${l.id}')">${icon('bank')} Repledge to Bank</button>`:''}
         ${l.status!=='Closed'?`<button class="btn sm" onclick="openPaymentModal('${l.id}')">${icon('coin')} Record Payment</button>`:''}`}
  </div>
  <hr class="gold-rule">

  <div class="grid cols21">
    <div class="grid">
      <div class="card gtop"><div class="hd"><h3>Pledged Ornaments — ${fmtW(l.weight)} total</h3></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Ornament</th><th>Purity</th><th class="num">Gross (g)</th><th class="num">Net (g)</th><th class="num">Qty</th><th class="num">Gold Value</th><th style="text-align:center">Photo</th></tr></thead>
          <tbody>${orns.map((o,i)=>`<tr><td>${o.n}</td><td><span class="chip gold">${o.purity}</span></td>
            <td class="num">${o.gross.toFixed(1)}</td><td class="num">${o.net.toFixed(1)}</td>
            <td class="num">${o.qty}</td><td class="num">${fmt(o.val)}</td>
            <td style="text-align:center;white-space:nowrap">
              ${photoOf(i)
                ? `<img src="${photoOf(i)}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line);cursor:pointer;vertical-align:middle" title="View photo" onclick="viewLoanOrnImg(${i})">
                   <button class="btn plain sm" style="padding:4px 8px;vertical-align:middle" onclick="viewLoanOrnImg(${i})">View</button>`
                : `<span style="color:var(--muted)">—</span>`}
            </td></tr>`).join('')}</tbody>
        </table></div>
        <div class="ft">Purity testing recorded by Anitha K · jewellery images linked to loan record</div></div>

      <div class="card"><div class="hd"><h3>Payment Ledger</h3></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th>Mode</th><th>Ref</th></tr></thead>
          <tbody>${led.length?led.map(e=>`<tr><td>${e.d}</td><td>${e.desc}</td>
            <td class="num">${e.debit?fmt(e.debit):'—'}</td><td class="num" style="color:var(--green)">${e.credit?fmt(e.credit):'—'}</td>
            <td>${e.mode}</td><td style="color:var(--muted);font-size:12px">${e.ref}</td></tr>`).join('')
            :'<tr><td colspan="6" class="empty">No ledger entries recorded in this demo.</td></tr>'}</tbody>
        </table></div></div>

      <div class="card"><div class="hd"><h3>Gold Packet Tracking — ${l.packet}</h3></div>
        <div class="bd"><div class="track">
          ${trackStages.map((st,i)=>`<div class="st ${i<doneUpto?'done':''}">${st}</div>`).join('')}
        </div></div>
        <div class="ft">Current location: <b>${l.locker}</b> · complete movement history maintained with employee & timestamp</div></div>
    </div>

    <div class="grid">
      <div class="card gtop"><div class="hd"><h3>Financial Summary</h3></div>
        <div class="bd"><div class="kv" style="grid-template-columns:1fr 1fr">
          <div class="i"><div class="k">Principal</div><div class="v">${fmt(l.principal)}</div></div>
          <div class="i"><div class="k">Outstanding</div><div class="v" style="color:var(--gold-deep);font-weight:600">${l.outstanding?fmt(l.outstanding):'—'}</div></div>
          <div class="i"><div class="k">Scheme Rate</div><div class="v">${s.rate}% p.a.</div></div>
          <div class="i"><div class="k">LTV</div><div class="v">${s.ltv}%</div></div>
          <div class="i"><div class="k">Interest Method</div><div class="v">${s.method}</div></div>
          <div class="i"><div class="k">Penal Interest</div><div class="v">${s.penal!=null?s.penal+'% / month':'—'}</div></div>
        </div></div></div>
      <div class="card"><div class="hd"><h3>Bank Pledge</h3></div>
        <div class="bd">
          ${l.pledge==='Bank Pledged'
            ? `<div class="kv" style="grid-template-columns:1fr 1fr">
                <div class="i"><div class="k">Bank</div><div class="v">${l.bank}</div></div>
                <div class="i"><div class="k">Reference</div><div class="v">${l.bankRef}</div></div>
                ${l.pledgeDate?`<div class="i"><div class="k">Pledged On</div><div class="v">${l.pledgeDate}</div></div>`:''}
                ${l.pledgeAmt?`<div class="i"><div class="k">Pledged Amount</div><div class="v">${fmt(l.pledgeAmt)}</div></div>`:''}
                <div class="i"><div class="k">Gold Covered</div><div class="v">${fmtW(l.weight)}</div></div>
                <div class="i"><div class="k">Status</div><div class="v">${statusChip('Bank Pledged')}</div></div></div>
               <div class="notice" style="margin-top:12px">${icon('shield')} Closure requires bank release process first.</div>`
            : `<p style="font-size:13.5px;color:var(--muted)">Gold is ${l.pledge==='Released'?'released to customer':'held in-house'} — ${statusChip(l.pledge)}</p>`}
        </div></div>
      <div class="card"><div class="hd"><h3>Settlement Preview</h3></div>
        <div class="bd" style="font-size:13.5px">
          <div style="display:flex;justify-content:space-between;padding:4px 0"><span>Principal</span><b>${fmt(l.principal)}</b></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0"><span>Interest accrued</span><b>${fmt(Math.max(0,l.outstanding-l.principal))}</b></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0"><span>Penal / charges</span><b>₹0</b></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0 2px;border-top:1px dashed var(--line);margin-top:6px">
            <span style="font-weight:600">Final settlement</span><b style="color:var(--gold-deep)">${l.outstanding?fmt(l.outstanding):'—'}</b></div>
        </div></div>
    </div>
  </div>`;
}

/* ── RECORD PAYMENT MODAL ──────────────────── */
window.openPaymentModal = function(loanId){
  const l = D.loans.find(x=>x.id===loanId);
  if(!l){ toast('Loan not found'); return; }
  const today = new Date().toISOString().slice(0,10);
  openModal(`
    <div class="hd"><h3>Record Payment — ${l.id}</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="notice" style="margin-bottom:16px">${icon('coin')} Current outstanding: <b>${l.outstanding?fmt(l.outstanding):'—'}</b></div>
      <div class="frow"><div><label class="f">Payment Mode *</label>
        <select class="inp" id="pmMode" onchange="pmModeChanged()">
          <option value="">Select payment mode…</option>
          <option>Bank Transfer</option>
          <option>UPI</option>
          <option>Cash</option>
        </select></div></div>
      <div class="frow" id="pmExtra" style="display:none"></div>
      <div class="frow c2">
        <div><label class="f">Amount (₹) *</label><input class="inp" id="pmAmt" type="number" min="1" placeholder="e.g. 5000"></div>
        <div><label class="f">Payment Date *</label><input class="inp" id="pmDate" type="date" value="${today}"></div>
      </div>
      <p id="pmErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="savePayment('${l.id}')">${icon('check')} Record Payment</button>
    </div>`);
};
window.pmModeChanged = function(){
  const mode = $('#pmMode').value;
  const extra = $('#pmExtra');
  if(mode === 'Bank Transfer'){
    extra.style.display = '';
    extra.innerHTML = `<div><label class="f">Bank *</label>
      <select class="inp" id="pmBank">
        <option value="">Select bank…</option>
        ${D.banks.map(b=>`<option>${b.name}</option>`).join('')}
      </select></div>`;
  } else if(mode === 'UPI'){
    extra.style.display = '';
    extra.innerHTML = `<div><label class="f">UPI Transaction ID *</label>
      <input class="inp" id="pmTxn" placeholder="e.g. 417229038511" style="text-transform:uppercase"></div>`;
  } else {
    extra.style.display = 'none';
    extra.innerHTML = '';
  }
};
window.savePayment = function(loanId){
  const mode = $('#pmMode').value;
  const amt  = +$('#pmAmt').value;
  const date = $('#pmDate').value;
  const err  = $('#pmErr');
  if(!mode){ err.textContent = 'Please select a payment mode.'; return; }
  let desc = 'Payment received', ref = 'PAY-' + String(Date.now()).slice(-4);
  if(mode === 'Bank Transfer'){
    const bank = $('#pmBank').value;
    if(!bank){ err.textContent = 'Please select the bank the transfer was received in.'; return; }
    desc = 'Payment received — ' + bank;
  }
  if(mode === 'UPI'){
    const txn = $('#pmTxn').value.trim().toUpperCase();
    if(!txn){ err.textContent = 'Please enter the UPI transaction ID.'; return; }
    ref = txn;
  }
  if(!amt || amt <= 0){ err.textContent = 'Please enter a valid payment amount.'; return; }
  if(!date){ err.textContent = 'Please select the payment date.'; return; }
  const entry = { d: date, desc, debit: 0, credit: amt, mode, ref };
  if(!D.addPayment(loanId, entry)){ err.textContent = 'Could not save the payment — storage is full.'; return; }
  closeModal(); toast(`Payment of ${fmt(amt)} recorded (${mode})`); router();
};

/* ── REPLEDGE TO BANK MODAL ────────────────── */
window.openRepledgeModal = function(loanId){
  const l = D.loans.find(x=>x.id===loanId);
  if(!l){ toast('Loan not found'); return; }
  const today = new Date().toISOString().slice(0,10);
  openModal(`
    <div class="hd"><h3>Repledge Gold to Bank — ${l.id}</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="notice" style="margin-bottom:16px">${icon('bank')} Packet <b>${l.packet}</b> · ${fmtW(l.weight)} gold · currently at <b>${l.locker}</b></div>
      <div class="frow"><div><label class="f">Bank *</label>
        <select class="inp" id="rpBank">
          <option value="">Select bank…</option>
          ${D.banks.map(b=>`<option>${b.name}</option>`).join('')}
        </select></div></div>
      <div class="frow c2">
        <div><label class="f">Pledge Reference (optional)</label><input class="inp" id="rpRef" placeholder="Bank pledge ref — auto if blank" style="text-transform:uppercase"></div>
        <div><label class="f">Pledged Amount (₹, optional)</label><input class="inp" id="rpAmt" type="number" min="1" placeholder="amount raised from bank"></div>
      </div>
      <div class="frow"><div><label class="f">Pledge Date *</label><input class="inp" id="rpDate" type="date" value="${today}"></div></div>
      <p id="rpErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveRepledge('${l.id}')">${icon('check')} Repledge to Bank</button>
    </div>`);
};
window.saveRepledge = function(loanId){
  const bank = $('#rpBank').value;
  const date = $('#rpDate').value;
  const amt  = +$('#rpAmt').value || 0;
  const err  = $('#rpErr');
  if(!bank){ err.textContent = 'Please select the bank to repledge with.'; return; }
  if(!date){ err.textContent = 'Please select the pledge date.'; return; }
  const bankRef = $('#rpRef').value.trim().toUpperCase() ||
    (bank.split(' ').map(w=>w[0]).join('').toUpperCase() + '/RPL/' + String(Date.now()).slice(-4));
  const fields = { pledge:'Bank Pledged', bank, bankRef, pledgeDate: date,
    locker: 'Bank: ' + bank };
  if(amt) fields.pledgeAmt = amt;
  if(!D.updateLoan(loanId, fields)){ err.textContent = 'Could not save — storage is full.'; return; }
  D.addPayment(loanId, { d: date, desc: 'Gold repledged — ' + bank, debit: 0, credit: 0, mode: '—', ref: bankRef });
  closeModal(); toast(`Gold repledged to ${bank} (${bankRef})`); router();
};

/* ── ADD CASH / TAKE CASH OUT MODALS ───────── */
window.openAddCashModal = function(){
  const today = new Date().toISOString().slice(0,10);
  openModal(`
    <div class="hd"><h3>Add Cash</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow"><div><label class="f">Source of Cash *</label>
        <select class="inp" id="acSource" onchange="acSourceChanged()">
          <option value="">Select source…</option>
          <option>Savings</option>
          <option>Loan</option>
        </select></div></div>
      <div class="frow" id="acExtra" style="display:none"></div>
      <div class="frow c2">
        <div><label class="f">Cash Amount (₹) *</label><input class="inp" id="acAmt" type="number" min="1" placeholder="e.g. 100000"></div>
        <div><label class="f" id="acDateLbl">Date *</label><input class="inp" id="acDate" type="date" value="${today}"></div>
      </div>
      <p id="acErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveAddCash()">${icon('check')} Add Cash</button>
    </div>`);
};
window.acSourceChanged = function(){
  const src = $('#acSource').value;
  const extra = $('#acExtra');
  $('#acDateLbl').textContent = src==='Loan' ? 'Date of Loan *' : 'Date *';
  if(src === 'Loan'){
    extra.style.display = '';
    extra.innerHTML = `<div><label class="f">Bank *</label>
      <select class="inp" id="acBank">
        <option value="">Select bank…</option>
        ${D.banks.map(b=>`<option>${b.name}</option>`).join('')}
      </select></div>`;
  } else {
    extra.style.display = 'none';
    extra.innerHTML = '';
  }
};
window.saveAddCash = function(){
  const src  = $('#acSource').value;
  const amt  = +$('#acAmt').value;
  const date = $('#acDate').value;
  const err  = $('#acErr');
  if(!src){ err.textContent = 'Please select where the cash is coming from.'; return; }
  let bank = '';
  if(src === 'Loan'){
    bank = $('#acBank').value;
    if(!bank){ err.textContent = 'Please select the bank the loan was taken from.'; return; }
  }
  if(!amt || amt <= 0){ err.textContent = 'Please enter a valid cash amount.'; return; }
  if(!date){ err.textContent = src==='Loan' ? 'Please select the date of the loan.' : 'Please select the date.'; return; }
  const m = { d: date, type:'in', source: src, bank, amount: amt };
  if(src === 'Loan') m.status = 'Open';
  if(!D.addCashMovement(m)){ err.textContent = 'Could not save — storage is full.'; return; }
  closeModal(); toast(`${fmt(amt)} added to cash (${src})`); router();
};

window.openCashOutModal = function(){
  const today = new Date().toISOString().slice(0,10);
  openModal(`
    <div class="hd"><h3>Take Cash Out</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow"><div><label class="f">Purpose *</label>
        <input class="inp" id="coPurpose" placeholder="e.g. Bank deposit, owner drawing, vendor advance…"></div></div>
      <div class="frow"><div><label class="f">Bank (optional)</label>
        <select class="inp" id="coBank">
          <option value="">— None / not applicable —</option>
          ${D.banks.map(b=>`<option>${b.name}</option>`).join('')}
        </select></div></div>
      <div class="frow c2">
        <div><label class="f">Amount (₹) *</label><input class="inp" id="coAmt" type="number" min="1" placeholder="e.g. 50000"></div>
        <div><label class="f">Date *</label><input class="inp" id="coDate" type="date" value="${today}"></div>
      </div>
      <p id="coErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveCashOut()">${icon('check')} Take Cash Out</button>
    </div>`);
};
window.saveCashOut = function(){
  const purpose = $('#coPurpose').value.trim();
  const bank = $('#coBank').value;
  const amt  = +$('#coAmt').value;
  const date = $('#coDate').value;
  const err  = $('#coErr');
  if(!purpose){ err.textContent = 'Please enter the purpose of taking cash out.'; return; }
  if(!amt || amt <= 0){ err.textContent = 'Please enter a valid amount.'; return; }
  if(!date){ err.textContent = 'Please select the date.'; return; }
  if(!D.addCashMovement({ d: date, type:'out', purpose, bank, amount: amt })){
    err.textContent = 'Could not save — storage is full.'; return; }
  closeModal(); toast(`${fmt(amt)} taken out of cash`); router();
};

window.openExpenseModal = function(){
  const today = new Date().toISOString().slice(0,10);
  const cats = ['Rent & Utilities','Salaries','Transportation','Marketing','Bank Charges','Maintenance','Stationery & Office','Other'];
  openModal(`
    <div class="hd"><h3>Record Expense</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow"><div><label class="f">Description *</label>
        <input class="inp" id="exDesc" placeholder="e.g. AC service — Koratty branch"></div></div>
      <div class="frow c2">
        <div><label class="f">Amount (₹) *</label><input class="inp" id="exAmt" type="number" min="1" placeholder="e.g. 3200"></div>
        <div><label class="f">Date *</label><input class="inp" id="exDate" type="date" value="${today}"></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Category</label>
          <select class="inp" id="exCat">${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div><label class="f">Payment Mode</label>
          <select class="inp" id="exMode"><option>Cash</option><option>UPI</option><option>Bank</option></select></div>
      </div>
      <div class="frow"><div><label class="f">Receipt / Bill Image (optional)</label>
        <input class="inp" id="exImg" type="file" accept="image/*"></div></div>
      <p id="exErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveExpense()">${icon('check')} Record Expense</button>
    </div>`);
};
window.saveExpense = function(){
  const desc = $('#exDesc').value.trim();
  const amt  = +$('#exAmt').value;
  const date = $('#exDate').value;
  const err  = $('#exErr');
  if(!desc){ err.textContent = 'Please enter a description for the expense.'; return; }
  if(!amt || amt <= 0){ err.textContent = 'Please enter a valid amount.'; return; }
  if(!date){ err.textContent = 'Please select the date.'; return; }
  const e = { d: date, cat: $('#exCat').value, amt, mode: $('#exMode').value,
    desc, payee: desc, branch: 'Koratty', status: 'Approved' };
  const done = () => {
    if(!D.addExpense(e)){ err.textContent = 'Could not save the expense — storage is full.'; return; }
    closeModal(); toast(`Expense of ${fmt(amt)} recorded`); router();
  };
  const file = $('#exImg').files[0];
  if(file){ shrinkImage(file, url => { e.img = url; done(); }); }
  else done();
};

window.toggleCashLoan = function(id){
  const m = D.cashMovements.find(x=>x.id===id);
  if(!m) return;
  const next = m.status==='Closed' ? 'Open' : 'Closed';
  D.setCashLoanStatus(id, next);
  toast(`Loan from ${m.bank} marked ${next.toLowerCase()}`); router();
};

/* ── NEW LOAN ──────────────────────────────── */
function renderNewLoan(){
  const provId = 'GL-' + (Math.max(0, ...D.loans.map(l=>+String(l.id).slice(3)||0)) + 1);
  view.innerHTML = `
  <div class="page-h"><div><h1>New Gold Loan</h1><p>Select a verified customer, choose a scheme, and record pledged ornaments</p></div></div>
  <hr class="gold-rule">
  <div class="grid cols21">
    <div class="card gtop"><div class="bd">
      <div class="frow c2">
        <div><label class="f">Customer (verified only)</label>
          <select class="inp" id="nlCust">${D.customers.filter(c=>c.kyc==='Verified').map(c=>`<option value="${c.id}">${c.name} — ${c.id}</option>`).join('')}</select></div>
        <div><label class="f">Scheme</label>
          <select class="inp" id="nlScheme">${D.schemes.filter(s=>s.active).map(s=>`<option value="${s.id}">${s.name} — ${s.ltv}% LTV @ ${s.rate}%</option>`).join('')}</select></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Locker / Storage</label>
          <select class="inp" id="nlLocker">
            <option value="">— Assign later —</option>
            ${D.lockers.filter(k=>k.status==='Active').map(k=>`<option value="${k.id}">${k.id} — ${k.branch} (${k.packets}/${k.cap} packets)</option>`).join('')}
          </select></div>
        <div><label class="f">Loan No (auto)</label><input class="inp" value="${provId}" disabled></div>
      </div>
      <label class="f" style="margin-top:6px">Pledged Ornaments</label>
      <div class="tbl-wrap"><table class="tbl" id="ornTbl" style="min-width:640px">
        <thead><tr><th>Ornament</th><th>Purity</th><th class="num">Net Wt (g)</th><th class="num">Qty</th><th class="num">Value</th><th style="text-align:center">Photo</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
      <button class="btn plain sm" style="margin-top:10px" onclick="addOrnRow()">${icon('plus')} Add Ornament</button>
    </div>
    <div class="ft" style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding:14px 18px">
      <button class="btn ghost" onclick="printPacketLabel()">🏷 Print Label</button>
      <button class="btn ghost" onclick="printPledgeSlip()">🖨 Print Slip</button>
      <button class="btn ghost" onclick="printIndemnity('en')">🖨 Indemnity Bond</button>
      <button class="btn ghost" onclick="printIndemnity('gu')">🖨 વળતર બોન્ડ (ગુજરાતી)</button>
      <button class="btn ghost" onclick="toast('Draft saved (demo)')">Save Draft</button>
      <button class="btn" onclick="submitNewLoan()">${icon('check')} Submit for Approval</button>
    </div></div>

    <div class="grid">
      <div class="card gtop"><div class="hd"><h3>Valuation</h3></div>
        <div class="bd" style="font-size:13.5px">
          <div style="display:flex;justify-content:space-between;padding:5px 0"><span>Total net weight</span><b id="nlW">0.0 g</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0"><span>Gross gold value</span><b id="nlGross">₹0</b></div>
          <div style="display:flex;justify-content:space-between;padding:5px 0"><span>Scheme LTV</span><b id="nlLtv">—</b></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0 2px;border-top:1px dashed var(--line);margin-top:8px">
            <span style="font-weight:600">Eligible loan amount</span><b id="nlElig" style="color:var(--gold-deep);font-size:17px">₹0</b></div>
        </div>
        <div class="ft">Uses today's published rates (22K ${fmt(D.rates.k22)}/g)</div></div>
      <div class="notice">${icon('shield')} Loans above ₹2,00,000 require Branch Manager + Management sanction (multi-level approval).</div>
    </div>
  </div>`;

  const ORN_TYPES_KEY = 'agf_ornament_types';
  let ornTypes = JSON.parse(localStorage.getItem(ORN_TYPES_KEY) || 'null')
    || ['Gold Chain','Necklace','Bangle','Ring','Earring Set','Bracelet','Pendant'];

  window._ornRows = [];
  window.addOrnRow = function(pre){
    const i = window._ornRows.length;
    window._ornRows.push(pre||{n:'Gold Chain',p:'k22',w:10,q:1});
    drawOrn();
  };
  window.delOrnRow = function(i){ window._ornRows.splice(i,1); drawOrn(); };
  window.updOrn = function(i,k,v){ window._ornRows[i][k] = (k==='w'||k==='q')?(+v||0):v; calcNl(); };

  window.ornTypeChanged = function(i, sel){
    if(sel.value !== '__add__'){ updOrn(i,'n',sel.value); return; }
    const name = (prompt('New ornament type:')||'').trim();
    if(name){
      const existing = ornTypes.find(t=>t.toLowerCase()===name.toLowerCase());
      if(existing){ toast(`"${existing}" already exists`); window._ornRows[i].n = existing; }
      else {
        ornTypes.push(name);
        localStorage.setItem(ORN_TYPES_KEY, JSON.stringify(ornTypes));
        window._ornRows[i].n = name;
        toast(`Ornament type "${name}" added`);
      }
    }
    drawOrn();
  };

  window.ornImgPicked = function(i, inp){
    const f = inp.files && inp.files[0];
    if(!f) return;
    if(!f.type.startsWith('image/')){ toast('Please choose an image file'); inp.value=''; return; }
    shrinkImage(f, url => { window._ornRows[i].img = url; window._ornRows[i].imgName = f.name; drawOrn(); });
  };
  window.delOrnImg = function(i){ delete window._ornRows[i].img; delete window._ornRows[i].imgName; drawOrn(); };
  window.viewOrnImg = function(i){
    const r = window._ornRows[i];
    openModal(`
      <div class="hd"><h3>${r.n}${r.imgName?' — '+r.imgName:''}</h3><button class="x" onclick="closeModal()">×</button></div>
      <div class="bd" style="text-align:center"><img src="${r.img}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`, true);
  };

  function drawOrn(){
    $('#ornTbl tbody').innerHTML = window._ornRows.map((r,i)=>`
      <tr>
        <td><select class="inp" style="padding:6px 8px" onchange="ornTypeChanged(${i},this)">
          ${ornTypes.map(o=>`<option ${o===r.n?'selected':''}>${o}</option>`).join('')}
          <option value="__add__">＋ Add new type…</option></select></td>
        <td><select class="inp" style="padding:6px 8px;width:82px" onchange="updOrn(${i},'p',this.value)">
          <option value="k24" ${r.p==='k24'?'selected':''}>24K</option><option value="k22" ${r.p==='k22'?'selected':''}>22K</option><option value="k18" ${r.p==='k18'?'selected':''}>18K</option></select></td>
        <td class="num"><input class="inp" style="padding:6px 8px;width:84px;text-align:right" type="number" value="${r.w}" oninput="updOrn(${i},'w',this.value)"></td>
        <td class="num"><input class="inp" style="padding:6px 8px;width:64px;text-align:right" type="number" value="${r.q}" oninput="updOrn(${i},'q',this.value)"></td>
        <td class="num orn-val">—</td>
        <td style="text-align:center;white-space:nowrap">
          <input type="file" accept="image/*" id="ornFile${i}" style="display:none" onchange="ornImgPicked(${i},this)">
          ${r.img
            ? `<img src="${r.img}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line);cursor:pointer;vertical-align:middle" title="View photo" onclick="viewOrnImg(${i})">
               <button class="btn plain sm" style="padding:4px 7px" title="Replace photo" onclick="document.getElementById('ornFile${i}').click()">↺</button>
               <button class="btn plain sm" style="padding:4px 7px" title="Remove photo" onclick="delOrnImg(${i})">✕</button>`
            : `<button class="btn plain sm" style="padding:4px 9px" title="Upload ornament photo" onclick="document.getElementById('ornFile${i}').click()">📷 Upload</button>`}
        </td>
        <td style="text-align:center"><button class="btn danger sm" onclick="delOrnRow(${i})">✕</button></td>
      </tr>`).join('');
    calcNl();
  }
  function calcNl(){
    let w=0, gross=0;
    document.querySelectorAll('#ornTbl .orn-val').forEach((el,i)=>{
      const r = window._ornRows[i];
      const v = r.w*r.q*D.rates[r.p];
      w += r.w*r.q; gross += v;
      el.textContent = fmt(v);
    });
    const sch = D.schemes.find(s=>s.id===$('#nlScheme').value);
    $('#nlW').textContent = w.toFixed(1)+' g';
    $('#nlGross').textContent = fmt(gross);
    $('#nlLtv').textContent = sch.ltv+'%';
    $('#nlElig').textContent = fmt(gross*sch.ltv/100);
  }
  function nlDraft(){
    const c = D.customers.find(x=>x.id===$('#nlCust').value) || {};
    const sch = D.schemes.find(s=>s.id===$('#nlScheme').value);
    const purLabel = {k24:'24K', k22:'22K', k18:'18K'};
    let weight=0, gross=0;
    const orns = window._ornRows.filter(r=>r.w>0 && r.q>0).map(r=>{
      const v = r.w*r.q*D.rates[r.p];
      weight += r.w*r.q; gross += v;
      return { n:r.n, purity:purLabel[r.p], net:r.w, qty:r.q, val:Math.round(v), img:r.img||null };
    });
    const locker = D.lockers.find(k=>k.id===$('#nlLocker').value);
    return { c, sch, orns, weight, gross, eligible:Math.round(gross*sch.ltv/100), locker };
  }

  window.printPledgeSlip = function(){
    const d = nlDraft();
    if(!d.orns.length){ toast('Add at least one ornament with weight and qty first'); return; }
    printDoc('Pledge Slip — '+provId, `
      <h1>AMBIKA GOLD FINANCE</h1><h2>Gold Loan Pledge Slip</h2>
      <table>
        <tr><th style="width:110px">Loan No</th><td>${provId}</td><th style="width:110px">Date</th><td>${new Date().toLocaleDateString('en-IN')}</td></tr>
        <tr><th>Customer</th><td>${d.c.name} (${d.c.id})</td><th>Phone</th><td>${d.c.phone||'—'}</td></tr>
        <tr><th>Address</th><td>${d.c.addr||'—'}</td><th>Branch</th><td>${d.c.branch||'—'}</td></tr>
        <tr><th>Scheme</th><td>${d.sch.name} @ ${d.sch.rate}% p.a. (LTV ${d.sch.ltv}%)</td>
            <th>Locker</th><td>${d.locker ? d.locker.id+' — '+d.locker.branch : 'Not assigned'}</td></tr>
      </table>
      <table>
        <thead><tr><th>#</th><th>Ornament</th><th>Purity</th><th class="num">Net Wt (g)</th><th class="num">Qty</th><th class="num">Value</th><th>Photo</th></tr></thead>
        <tbody>
          ${d.orns.map((o,i)=>`<tr><td>${i+1}</td><td>${o.n}</td><td>${o.purity}</td>
            <td class="num">${o.net.toFixed(1)}</td><td class="num">${o.qty}</td><td class="num">${fmt(o.val)}</td>
            <td style="text-align:center">${o.img?`<img src="${o.img}" style="width:56px;height:56px;object-fit:cover">`:'—'}</td></tr>`).join('')}
          <tr><th colspan="3">Total</th><th class="num">${d.weight.toFixed(1)}</th><th></th><th class="num">${fmt(d.gross)}</th><th></th></tr>
        </tbody>
      </table>
      <p><b>Eligible loan amount: ${fmt(d.eligible)}</b> &nbsp;<span class="muted">(at today's published rates — 22K ${fmt(D.rates.k22)}/g)</span></p>
      <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`);
  };

  window.printIndemnity = function(lang){
    const d = nlDraft(), c = d.c;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,'0'), mm = String(now.getMonth()+1).padStart(2,'0');
    const yy = String(now.getFullYear()).slice(2);
    const monthName = now.toLocaleString('en-IN',{month:'long'});
    const age = c.dob ? Math.floor((now - new Date(c.dob))/31557600000) : '____';
    const B = '________________';

    if(lang === 'gu'){
      printDoc('વળતર બોન્ડ — '+provId, `
        <h1>વળતર બોન્ડ (INDEMNITY BOND)</h1>
        <p>તારીખ: ${dd} / ${mm} / 20${yy}</p>
        <p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>અંબિકા ગોલ્ડ ફાઇનાન્સ (NBFC)<br>${c.branch||B} શાખા</p>
        <p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. ${provId} અંગે વળતર બોન્ડ</b></p>
        <p>હું/અમે, શ્રી/શ્રીમતી <b>${c.name||B}</b>, ઉંમર <b>${age}</b> વર્ષ, રહેવાસી <b>${c.addr||B}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
        <ol>
          <li>હું/અમે ઉપરોક્ત ગોલ્ડ લોન એકાઉન્ટના કાયદેસર લોનધારક (Borrower) છીએ.</li>
          <li>ઉપરોક્ત ગોલ્ડ લોનની સુરક્ષા (Security) તરીકે મેં/અમે બેંક/NBFC પાસે સોનાના દાગીના/વસ્તુઓ ગીરવે મૂકેલ છે.</li>
          <li>હું/અમે આથી જાહેર કરું/કરીએ છીએ કે બેંક/NBFC પાસે ગીરવે મૂકવામાં આવેલ તમામ સોનાના દાગીના/વસ્તુઓ મારા/અમારા કાયદેસરના અને સંપૂર્ણ માલિકીના છે. આ સોના પર અન્ય કોઈપણ વ્યક્તિનો માલિકી હક, હિત, દાવો, ગીરો, અધિકાર અથવા અન્ય કોઈ પ્રકારનો હક નથી.</li>
          <li>હું/અમે વધુમાં જાહેર કરું/કરીએ છીએ કે ગીરવે મૂકવામાં આવેલ સોનું કાયદેસર રીતે પ્રાપ્ત કરાયેલ છે અને તે કોઈપણ ગેરકાયદેસર પ્રવૃત્તિ, ચોરી, છેતરપિંડી, ગુનાહિત કૃત્ય, મની લોન્ડરિંગ અથવા અન્ય કોઈ ગેરકાયદેસર સ્ત્રોતમાંથી પ્રાપ્ત થયેલ નથી.</li>
          <li>ઉપરોક્ત સોનાની માલિકી, સ્ત્રોત, ગીરો અથવા તેની મુક્તિ સંબંધિત કોઈપણ પ્રકારના દાવા, વિવાદ, નુકસાન, જવાબદારી, ખર્ચ, કાનૂની કાર્યવાહી અથવા અન્ય પરિણામો માટે હું/અમે સંપૂર્ણપણે જવાબદાર રહીશ/રહીશું અને બેંક/NBFC તથા તેના અધિકારીઓ, કર્મચારીઓ અને પ્રતિનિધિઓને આવા તમામ નુકસાન, ખર્ચ અને જવાબદારીઓ સામે સંપૂર્ણ વળતર (Indemnity) આપવા તથા તેમને નિર્દોષ રાખવા સંમત છીએ.</li>
          <li>જો ભવિષ્યમાં કોઈપણ વ્યક્તિ અથવા સંસ્થા ઉપરોક્ત સોનાની માલિકી, કબજો અથવા તેના સ્ત્રોત અંગે કોઈ દાવો, વાંધો અથવા કાનૂની કાર્યવાહી કરે, તો તે અંગેનો સંપૂર્ણ ખર્ચ, જવાબદારી અને તેનો નિકાલ હું/અમે મારી/અમારી જવાબદારી પર કરીશ/કરીશું અને તેનાથી બેંક/NBFCને થનારા તમામ નુકસાન, ખર્ચ અથવા જવાબદારીઓ માટે હું/અમે સંપૂર્ણ વળતર આપીશ/આપીશું.</li>
          <li>હું/અમે જાહેર કરું/કરીએ છીએ કે આ બોન્ડમાં દર્શાવેલ તમામ વિગતો મારી/અમારી જાણ અને માન્યતા મુજબ સાચી, સંપૂર્ણ અને યથાર્થ છે. બેંક/NBFC આ ઘોષણા પર વિશ્વાસ રાખીને ગોલ્ડ લોન મંજૂર કરે છે અથવા ચાલુ રાખે છે તે બાબત મને/અમને સંપૂર્ણ જાણ છે.</li>
          <li>આ વળતર બોન્ડ મારા/અમારા તેમજ મારા/અમારા કાનૂની વારસદારો, પ્રતિનિધિઓ, વહીવટદારો અને ઉત્તરાધિકારીઓ પર બંધનકર્તા રહેશે અને આ બોન્ડ હેઠળની તમામ જવાબદારીઓ પૂર્ણ ન થાય ત્યાં સુધી અમલમાં રહેશે.</li>
        </ol>
        <p>આથી હું/અમે આ વળતર બોન્ડ આજ રોજ <b>${dd} / ${mm} / 20${yy}</b> ના રોજ સ્વેચ્છાએ અને કોઈપણ દબાણ વિના હસ્તાક્ષર કરીને અમલમાં મૂકીએ છીએ.</p>
        <p style="margin-top:56px">લોનધારકની સહી: ${B}</p>
        <p>નામ: <b>${c.name||B}</b><br><br>સરનામું: <b>${c.addr||B}</b></p>
        <hr style="margin:24px 0">
        <p>મોબાઇલ નં.: <b>${c.phone||B}</b></p>
        <p><b>સાક્ષીઓ</b></p>
        <p><b>સાક્ષી – ૧</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>
        <p style="margin-top:28px"><b>સાક્ષી – ૨</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>`);
      return;
    }

    printDoc('Indemnity Bond — '+provId, `
      <h1>INDEMNITY BOND</h1>
      <p>Date: ${dd} / ${mm} / 20${yy}</p>
      <p>To<br>The Branch Manager<br>Ambika Gold Finance (NBFC)<br>${c.branch||B} Branch</p>
      <p><b>Subject: Indemnity Bond in respect of Gold Loan Account No. ${provId}</b></p>
      <p>I/We, Mr./Ms. <b>${c.name||B}</b>, aged <b>${age}</b> years, residing at <b>${c.addr||B}</b>, do hereby solemnly affirm, declare and undertake as under:</p>
      <ol>
        <li>That I/we am/are the borrower(s) under Gold Loan Account No. <b>${provId}</b> with your Bank/NBFC.</li>
        <li>That I/we have pledged certain gold ornaments/articles with the Bank/NBFC as security for the above-mentioned gold loan.</li>
        <li>I/We hereby declare that the gold ornaments/articles pledged with the Bank/NBFC are my/our lawful property and that I/we am/are the sole and absolute owner(s) thereof. No other person has any ownership, title, interest, claim, lien or right of any nature whatsoever in respect of the said gold.</li>
        <li>I/We further declare that the said gold has been acquired through lawful means and has not been obtained, purchased, possessed, or derived from any illegal activity, criminal offence, theft, fraud, money laundering, or any other unlawful source.</li>
        <li>I/We hereby agree to indemnify and keep indemnified the Bank/NBFC, its officers, employees, successors and assigns against any loss, claim, demand, liability, damage, cost, expense, legal proceedings or consequences whatsoever arising out of or in connection with the ownership, title, source, pledge or release of the said gold ornaments/articles.</li>
        <li>In the event that any third party raises any claim, objection, dispute or legal proceedings regarding the ownership, possession or source of the pledged gold, I/we shall be solely responsible for resolving the same at my/our own cost and shall fully indemnify and hold harmless the Bank/NBFC against all losses, damages, costs, expenses and liabilities arising therefrom.</li>
        <li>I/We declare that all statements made herein are true, correct and complete to the best of my/our knowledge and belief. I/We understand that this declaration is being relied upon by the Bank/NBFC for the purpose of granting and/or continuing the above-mentioned gold loan.</li>
        <li>This Indemnity Bond shall be irrevocable and shall remain valid, binding and enforceable upon me/us and my/our legal heirs, executors, administrators and representatives until all obligations arising hereunder have been fully discharged.</li>
      </ol>
      <p>IN WITNESS WHEREOF, I/we have executed this Indemnity Bond on this <b>${now.getDate()}</b> day of <b>${monthName}</b>, 20${yy}.</p>
      <p style="margin-top:56px"><b>Signature of Borrower</b></p>
      <p>Name: <b>${c.name||B}</b><br><br>Address: <b>${c.addr||B}</b></p>
      <hr style="margin:24px 0">
      <p>Mobile No.: <b>${c.phone||B}</b></p>
      <p><b>Witnesses</b></p>
      <p><b>Witness No. 1</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>
      <p style="margin-top:28px"><b>Witness No. 2</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>`);
  };

  window.printPacketLabel = function(){
    const d = nlDraft(), c = d.c;
    const url = location.origin + '/app.html#loan/' + provId;
    // render QR off-screen, then embed as image in the label window
    const tmp = document.createElement('div');
    new QRCode(tmp, { text:url, width:256, height:256, correctLevel:QRCode.CorrectLevel.M });
    const cv = tmp.querySelector('canvas');
    const qr = cv ? cv.toDataURL('image/png') : (tmp.querySelector('img')||{}).src;
    if(!qr){ toast('Could not generate QR code'); return; }

    const w = window.open('', '_blank');
    if(!w){ toast('Popup blocked — please allow popups for this site to print'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${provId}</title><style>
      @page{size:50mm 30mm;margin:0}
      body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
      .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
        border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
      .label img{width:25mm;height:25mm;flex:none}
      .t{font-size:2.5mm;line-height:1.45;min-width:0}
      .t .brand{font-size:2mm;letter-spacing:0.3mm;color:#7a5c14}
      .t .id{font-size:3.4mm;font-weight:bold}
      .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .noprint{text-align:center;margin:8mm;font-family:Arial}
      @media print{.noprint{display:none} .label{border:none}}
    </style></head><body>
      <div class="label">
        <img src="${qr}" alt="QR">
        <div class="t">
          <div class="brand">AMBIKA GOLD FINANCE</div>
          <div class="id">${provId} · PKT-${provId.slice(3)}</div>
          <div>${c.name||'—'}</div>
          <div>${c.id||'—'} · ${c.phone||''}</div>
          <div>${new Date().toLocaleDateString('en-IN')} · ${d.weight.toFixed(1)} g · ${d.orns.length} item(s)</div>
        </div>
      </div>
      <div class="noprint">
        <p style="font-size:13px;color:#555">50mm × 30mm packet label — scanning the QR opens ${url}</p>
        <button onclick="window.print()" style="padding:10px 26px;font-size:14px;cursor:pointer">🖨 Print Label</button>
      </div>
    </body></html>`);
    w.document.close();
    setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
  };

  window.submitNewLoan = function(){
    const rows = window._ornRows.filter(r=>r.w>0 && r.q>0);
    if(!rows.length){ toast('Add at least one ornament with weight and qty'); return; }
    const sch = D.schemes.find(s=>s.id===$('#nlScheme').value);
    const maxN = Math.max(0, ...D.loans.map(l=>+String(l.id).slice(3)||0));
    const id = 'GL-' + (maxN+1);
    const purLabel = {k24:'24K', k22:'22K', k18:'18K'};
    let weight=0, gross=0;
    const orns = rows.map(r=>{
      const v = r.w*r.q*D.rates[r.p];
      weight += r.w*r.q; gross += v;
      return { n:r.n, purity:purLabel[r.p], gross:r.w, net:r.w, qty:r.q, val:Math.round(v), img:r.img||null };
    });
    const principal = Math.round(gross*sch.ltv/100);
    const months = parseInt(sch.duration)||12;
    const opened = new Date(), due = new Date(opened);
    due.setMonth(due.getMonth()+months);
    const iso = d=>d.toISOString().slice(0,10);
    const lockerId = $('#nlLocker').value;
    const ok = D.addLoan({ id, cust:$('#nlCust').value, scheme:sch.id, opened:iso(opened), due:iso(due),
      principal, outstanding:principal, weight:+weight.toFixed(1), status:'Pending Approval',
      pledge:'Not Pledged', packet:lockerId?('PKT-'+(maxN+1)):'—', locker:lockerId||'—' }, orns);
    toast(ok ? `Loan ${id} submitted for approval` : `Loan ${id} created, but browser storage is full — photos may not persist`);
    location.hash = '#loan/'+id;
  };

  $('#nlScheme').addEventListener('change', calcNl);
  addOrnRow({n:'Gold Chain',p:'k22',w:12.5,q:1});
  addOrnRow({n:'Bangle',p:'k22',w:8.2,q:2});
}

/* ── SCHEME EDITOR MODAL ───────────────────── */
window.openSchemeModal = function(id){
  const s = id ? D.schemes.find(x=>x.id===id) : null;
  openModal(`
    <div class="hd"><h3>${s ? 'Edit Scheme — ' + s.name : 'New Loan Scheme'}</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow c2">
        <div><label class="f">Scheme Name *</label><input class="inp" id="scName" value="${s?s.name:''}" placeholder="e.g. Swarna Premium"></div>
        <div><label class="f">Interest Rate (% p.a.) *</label><input class="inp" id="scRate" type="number" step="0.1" min="0" value="${s?s.rate:''}" placeholder="12.5"></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Loan Duration *</label>
          <select class="inp" id="scDur">${['3 months','6 months','9 months','12 months','18 months','24 months']
            .map(d=>`<option ${s&&s.duration===d?'selected':''}>${d}</option>`).join('')}</select></div>
        <div><label class="f">LTV (%) *</label><input class="inp" id="scLtv" type="number" min="1" max="90" value="${s?s.ltv:''}" placeholder="max 90"></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Interest Calculation Method</label>
          <select class="inp" id="scMethod">${['Monthly simple interest','Flat monthly','Quarterly simple','Compound monthly']
            .map(m=>`<option ${s&&s.method===m?'selected':''}>${m}</option>`).join('')}</select></div>
        <div><label class="f">Penal Charges (% / month) *</label>
          <input class="inp" id="scPenal" type="number" step="0.1" min="0" max="10" value="${s&&s.penal!=null?s.penal:''}" placeholder="e.g. 2"></div>
      </div>
      <div class="frow"><div><label class="f">Applicable Conditions</label>
        <input class="inp" id="scCond" value="${s?s.cond.replace(/"/g,'&quot;'):''}" placeholder="e.g. Interest payable monthly; penal 2%/m after due"></div></div>
      <div class="frow"><div><label class="f">Status</label>
        <select class="inp" id="scActive">
          <option value="1" ${!s||s.active?'selected':''}>Active</option>
          <option value="0" ${s&&!s.active?'selected':''}>Inactive</option>
        </select></div></div>
      <div class="notice">${icon('shield')} Scheme changes are restricted to authorized administrators and recorded in the audit trail.</div>
      <p id="scErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveScheme(${s?`'${s.id}'`:'null'})">${icon('check')} ${s?'Save Changes':'Create Scheme'}</button>
    </div>`);
};
window.saveScheme = function(id){
  const name = $('#scName').value.trim();
  const rate = parseFloat($('#scRate').value);
  const ltv  = parseInt($('#scLtv').value, 10);
  const err  = $('#scErr');
  if(name.length < 3){ err.textContent = 'Please enter a scheme name.'; return; }
  if(!(rate > 0)){ err.textContent = 'Please enter a valid interest rate.'; return; }
  if(!(ltv >= 1 && ltv <= 90)){ err.textContent = 'LTV must be between 1 and 90%.'; return; }
  const penal = parseFloat($('#scPenal').value);
  if(!(penal >= 0 && penal <= 10)){ err.textContent = 'Please enter penal charges between 0 and 10% per month.'; return; }
  const vals = {
    name, rate, ltv, penal,
    duration: $('#scDur').value,
    method: $('#scMethod').value,
    cond: $('#scCond').value.trim() || '—',
    active: $('#scActive').value === '1',
  };
  if(id){
    Object.assign(D.schemes.find(x=>x.id===id), vals);
  }else{
    const nums = D.schemes.map(x=>parseInt(x.id.replace('SCH-',''),10)||0);
    const nid = 'SCH-' + String(Math.max(0,...nums)+1).padStart(2,'0');
    D.schemes.push(Object.assign({id:nid}, vals));
  }
  D.saveSchemes();
  closeModal();
  toast(id ? `Scheme "${name}" updated` : `Scheme "${name}" created`);
  router();
};

/* ── SCHEMES ───────────────────────────────── */
function renderSchemes(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Loan Schemes</h1><p>Interest rates, tenure, LTV and calculation rules per scheme</p></div>
    <div class="sp"></div><button class="btn" onclick="openSchemeModal()">${icon('plus')} New Scheme</button>
  </div>
  <hr class="gold-rule">
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
    ${D.schemes.map(s=>`
      <div class="card gtop"><div class="hd"><h3>${s.name}</h3><div class="sp"></div>${s.active?'<span class="chip green">Active</span>':'<span class="chip gray">Inactive</span>'}</div>
        <div class="bd"><div class="kv" style="grid-template-columns:1fr 1fr">
          <div class="i"><div class="k">Interest</div><div class="v" style="color:var(--gold-deep);font-weight:600">${s.rate}% p.a.</div></div>
          <div class="i"><div class="k">Duration</div><div class="v">${s.duration}</div></div>
          <div class="i"><div class="k">LTV</div><div class="v">${s.ltv}%</div></div>
          <div class="i"><div class="k">Method</div><div class="v">${s.method}</div></div>
          <div class="i"><div class="k">Penal Charges</div><div class="v" style="color:var(--red);font-weight:600">${s.penal!=null?s.penal+'% / month':'—'}</div></div>
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin-top:12px;border-top:1px dashed var(--line);padding-top:10px">${s.cond}</p></div>
        <div class="ft" style="display:flex;gap:8px"><span>${s.id}</span><span style="flex:1"></span>
          <a href="#" onclick="openSchemeModal('${s.id}');return false">Edit</a></div>
      </div>`).join('')}
  </div>`;
}

/* ── GOLD RATES ────────────────────────────── */
function renderGoldRates(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Gold Rates</h1><p>Daily published rates by purity · full history maintained for audit</p></div>
    <div class="sp"></div><button class="btn" onclick="openRateModal()">${icon('coin')} Set Today's Rate</button>
  </div>
  <hr class="gold-rule">
  <div class="rates3" style="max-width:720px;margin-bottom:20px">
    ${rateTile('24K · 999', D.rates.k24)}${rateTile('22K · 916', D.rates.k22)}${rateTile('18K · 750', D.rates.k18)}
  </div>
  <div class="card"><div class="hd"><h3>Rate History</h3></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th class="num">24K ₹/g</th><th class="num">22K ₹/g</th><th class="num">18K ₹/g</th><th>Published By</th></tr></thead>
      <tbody>${D.rateHistory.map(r=>`<tr><td>${r.date}</td><td class="num">${fmt(r.k24)}</td>
        <td class="num">${fmt(r.k22)}</td><td class="num">${fmt(r.k18)}</td><td>${r.by}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

/* ── PACKETS & LOCKERS ─────────────────────── */
function renderPackets(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Gold Packets & Lockers</h1><p></p></div>
    <div class="sp"></div>
    <button class="btn ghost" onclick="toast('Barcode scanner — full build')">${icon('scan')} Scan Packet</button>
    <button class="btn" onclick="openLockerModal()">${icon('plus')} Add Locker</button>
  </div>
  <hr class="gold-rule">
  <div class="grid cols21">
    <div class="card"><div class="hd"><h3>Packets</h3></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Packet / QR</th><th>Loan</th><th>Customer</th><th class="num">Items</th><th class="num">Weight</th><th>Location</th><th>Status</th></tr></thead>
        <tbody>${D.packets.map(p=>`<tr>
          <td><span class="id">${p.id}</span><span class="sub">▦ ${p.qr}</span></td>
          <td><a href="#loan/${p.loan}">${p.loan}</a></td><td>${p.cust}</td>
          <td class="num">${p.items}</td><td class="num">${fmtW(p.weight)}</td>
          <td>${p.locker}</td><td>${statusChip(p.status)}</td></tr>`).join('')}</tbody>
      </table></div></div>
    <div class="grid">
      ${D.lockers.map(l=>`
        <div class="card gtop"><div class="hd"><h3>${l.id}</h3><div class="sp"></div><span class="chip green">${l.status}</span>
            <button class="btn danger sm" style="margin-left:8px;padding:4px 9px" title="Remove locker" onclick="removeLocker('${l.id}')">✕</button></div>
          <div class="bd">
            <div class="kv" style="grid-template-columns:1fr 1fr">
              <div class="i"><div class="k">Branch</div><div class="v">${l.branch}</div></div>
              <div class="i"><div class="k">Packets</div><div class="v">${l.packets} / ${l.cap}</div></div>
            </div>
            <div style="height:7px;background:#efe7cd;border-radius:4px;margin-top:12px;overflow:hidden">
              <div style="height:100%;width:${l.packets/l.cap*100}%;min-width:4%;background:linear-gradient(90deg,var(--gold-light),var(--gold-deep))"></div>
            </div>
          </div>
          <div class="ft">Check-in / check-out history maintained</div></div>`).join('')}
    </div>
  </div>`;
}

window.openLockerModal = function(){
  const branches = [...new Set(D.lockers.map(l=>l.branch).concat(D.customers.map(c=>c.branch)))].filter(Boolean);
  openModal(`
    <div class="hd"><h3>Add Locker</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow c2">
        <div><label class="f">Locker ID *</label><input class="inp" id="lkId" placeholder="e.g. LKR-B2"></div>
        <div><label class="f">Capacity (packets) *</label><input class="inp" id="lkCap" type="number" min="1" value="30"></div>
      </div>
      <div class="frow"><div><label class="f">Branch *</label>
        <input class="inp" id="lkBranch" list="lkBranches" placeholder="e.g. Koratty">
        <datalist id="lkBranches">${branches.map(b=>`<option value="${b}">`).join('')}</datalist></div></div>
      <p id="lkErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveNewLocker()">${icon('check')} Add Locker</button>
    </div>`);
};

window.saveNewLocker = function(){
  const id = $('#lkId').value.trim().toUpperCase();
  const cap = parseInt($('#lkCap').value, 10);
  const branch = $('#lkBranch').value.trim();
  const err = $('#lkErr');
  if(!/^[A-Z0-9-]{3,15}$/.test(id)){ err.textContent = 'Please enter a locker ID (letters, numbers, dashes — e.g. LKR-B2).'; return; }
  if(D.lockers.some(l=>l.id===id)){ err.textContent = `Locker ${id} already exists.`; return; }
  if(!(cap >= 1)){ err.textContent = 'Please enter a valid capacity.'; return; }
  if(!branch){ err.textContent = 'Please enter a branch.'; return; }
  D.lockers.push({ id, branch, packets:0, cap, status:'Active' });
  D.saveLockers();
  closeModal();
  toast(`Locker ${id} added`);
  renderPackets();
};

window.removeLocker = function(id){
  const l = D.lockers.find(x=>x.id===id);
  if(!l) return;
  const inUse = l.packets > 0 || D.packets.some(p=>p.locker===id) || D.loans.some(x=>x.locker===id);
  if(inUse){ toast(`${id} has packets assigned — move them out before removing`); return; }
  if(!confirm(`Remove locker ${id} (${l.branch})?`)) return;
  D.lockers.splice(D.lockers.indexOf(l), 1);
  D.saveLockers();
  toast(`Locker ${id} removed`);
  renderPackets();
};

/* ── CASH & EXPENSES ───────────────────────── */
function renderCash(){
  const total = D.expenses.reduce((s,e)=>s+e.amt,0);
  const cashIn  = D.cashMovements.filter(m=>m.type==='in').reduce((s,m)=>s+m.amount,0);
  const cashOut = D.cashMovements.filter(m=>m.type==='out').reduce((s,m)=>s+m.amount,0);
  const movementRow = m => {
    const isLoan = m.type==='in' && m.source==='Loan';
    return `<tr>
      <td>${m.d}</td>
      <td>${m.type==='in'?'<span class="chip green">Cash In</span>':'<span class="chip red">Cash Out</span>'}</td>
      <td>${m.type==='in' ? m.source : (m.purpose||'—')}</td>
      <td>${m.bank||'—'}</td>
      <td class="num" style="color:${m.type==='in'?'var(--green)':'var(--red)'}">${m.type==='in'?'+':'−'}${fmt(m.amount)}</td>
      <td>${isLoan
        ? `<span class="chip ${m.status==='Closed'?'gray':'amber'}">${m.status||'Open'}</span>
           <button class="btn plain sm" style="padding:3px 8px;margin-left:6px" onclick="toggleCashLoan('${m.id}')">${m.status==='Closed'?'Reopen':'Mark Closed'}</button>`
        : '—'}</td></tr>`;
  };
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Cash-in-Hand & Expenses</h1><p>Opening Cash + Collections − Disbursements − Expenses = Expected Cash in Hand</p></div>
    <div class="sp"></div>
    <button class="btn ghost" onclick="openCashOutModal()">${icon('coin')} Take Cash Out</button>
    <button class="btn ghost" onclick="openAddCashModal()">${icon('coin')} Add Cash</button>
    <button class="btn" onclick="openExpenseModal()">${icon('plus')} Record Expense</button>
  </div>
  <hr class="gold-rule">
  <div class="kpis" style="margin-bottom:18px">
    ${kpi('Opening Cash (today)', fmt(510000))}
    ${kpi('Collections / Income', fmt(96350), 'interest + principal', 'ok')}
    ${kpi('Loan Disbursements', fmt(118000), 'GL-2051 (new)')}
    ${kpi("Expenses (today)", fmt(6000))}
    ${kpi('Expected Cash in Hand', fmt(482350 + cashIn - cashOut), 'auto-calculated', 'ok')}
  </div>
  <div class="card" style="margin-bottom:18px"><div class="hd"><h3>Cash Movements</h3><div class="sp"></div>
    <span style="font-size:12.5px;color:var(--muted)">In ${fmt(cashIn)} · Out ${fmt(cashOut)}</span></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Type</th><th>Source / Purpose</th><th>Bank</th><th class="num">Amount</th><th>Loan Status</th></tr></thead>
      <tbody>${D.cashMovements.length ? D.cashMovements.map(movementRow).join('')
        : '<tr><td colspan="6" class="empty">No cash movements recorded yet. Use “Add Cash” or “Take Cash Out”.</td></tr>'}</tbody>
    </table></div>
    <div class="ft">Cash added from a loan stays flagged until the loan is marked closed · all movements adjust Expected Cash in Hand</div></div>
  <div class="card"><div class="hd"><h3>Expense Register</h3><div class="sp"></div><span style="font-size:12.5px;color:var(--muted)">Total ${fmt(total)}</span></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Category</th><th class="num">Amount</th><th>Mode</th><th>Description / Payee</th><th>Branch</th><th>Status</th><th style="text-align:center">Receipt</th></tr></thead>
      <tbody>${D.expenses.map((e,i)=>`<tr><td>${e.d}</td><td>${e.cat}</td><td class="num">${fmt(e.amt)}</td>
        <td>${e.mode}</td><td>${e.desc||e.payee}</td><td>${e.branch}</td><td>${statusChip(e.status)}</td>
        <td style="text-align:center">${e.img
          ? `<img src="${e.img}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line);cursor:pointer;vertical-align:middle" title="View receipt" onclick="viewExpenseReceipt(${i})">`
          : '<span style="color:var(--muted)">—</span>'}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="ft">Cash expenses automatically reflect in Cash-in-Hand calculations · receipt images attached to expense records</div></div>`;

  window.viewExpenseReceipt = function(i){
    const e = D.expenses[i];
    openModal(`
      <div class="hd"><h3>Receipt — ${e.desc||e.payee} (${fmt(e.amt)})</h3><button class="x" onclick="closeModal()">×</button></div>
      <div class="bd" style="text-align:center"><img src="${e.img}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`, true);
  };
}

/* ── CALENDAR ──────────────────────────────── */
function renderCalendar(){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // July 2026: starts Wednesday(3), 31 days
  const startDow = 3, nDays = 31, today = 30;
  let cells = [], week = new Array(startDow).fill('');
  for(let d=1; d<=nDays; d++){
    week.push(d);
    if(week.length===7){ cells.push(week); week=[]; }
  }
  if(week.length){ while(week.length<7) week.push(''); cells.push(week); }
  view.innerHTML = `
  <div class="page-h">
    <div><h1>EMI / Interest Reminder Calendar</h1><p>July 2026 · due dates, overdue loans, follow-ups & promise-to-pay</p></div>
    <div class="sp"></div>
    <span class="chip amber">Due</span> <span class="chip red">Overdue</span> <span class="chip blue">Follow-up</span> <span class="chip green">Payment</span>
  </div>
  <hr class="gold-rule">
  <div class="card"><div class="bd" style="padding:10px;overflow-x:auto">
    <table class="cal">
      <thead><tr>${days.map(d=>`<th>${d}</th>`).join('')}</tr></thead>
      <tbody>${cells.map(w=>`<tr>${w.map(d=>{
        if(!d) return '<td style="background:#faf6ea"></td>';
        const evs = (D.calendarEvents[d]||[]).map(e=>`<span class="ev ${e.c}">${e.t}</span>`).join('');
        return `<td class="${d===today?'today':''}"><span class="d">${d}</span>${evs}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="ft">SMS & WhatsApp reminders are sent automatically for due/overdue events · full communication history kept per loan</div></div>`;
}

/* ── REQUESTS (extension / release) ─────────── */
function renderRequests(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Loan Extensions & Gold Release</h1><p>Requests submitted by customers through the Android app</p></div>
  </div>
  <hr class="gold-rule">
  <div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Request</th><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th></th></tr></thead>
    <tbody>${D.requests.map(r=>`<tr>
      <td><span class="id">${r.id}</span></td>
      <td><span class="chip ${r.type==='Extension'?'blue':'gold'}">${r.type}</span></td>
      <td><a href="#loan/${r.loan}">${r.loan}</a></td><td>${r.cust}</td><td>${r.detail}</td><td>${r.date}</td>
      <td>${statusChip(r.status)}</td>
      <td style="white-space:nowrap;text-align:right">${r.status==='Pending'
        ?`<button class="btn sm" onclick="toast('${r.type} approved (demo)')">Approve</button>
          <button class="btn danger sm" onclick="toast('Rejected (demo)')">Reject</button>`:''}</td>
      </tr>`).join('')}</tbody>
  </table></div>
  <div class="ft">Release settlement = Principal + Interest + Penal + Charges − Payments/Waivers · verified against packet location & bank pledge status</div></div>`;
}

/* ── BANK PLEDGE ───────────────────────────── */
function renderBankPledge(){
  const pledged = D.loans.filter(l=>l.pledge==='Bank Pledged');
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Bank & Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
    <div class="sp"></div><button class="btn" onclick="toast('Re-pledge entry — full build')">${icon('plus')} New Re-Pledge</button>
  </div>
  <hr class="gold-rule">
  <div class="grid cols21">
    <div class="card"><div class="hd"><h3>Re-Pledged Loans</h3></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Loan</th><th>Customer</th><th>Bank</th><th>Reference</th><th class="num">Weight</th><th class="num">Bank Amount</th><th>Status</th></tr></thead>
        <tbody>${pledged.map(l=>`<tr>
          <td><a href="#loan/${l.id}">${l.id}</a></td><td>${custOf(l.cust).name}</td>
          <td>${l.bank}</td><td style="color:var(--muted);font-size:12.5px">${l.bankRef}</td>
          <td class="num">${fmtW(l.weight)}</td><td class="num">${fmt(l.principal*0.85)}</td>
          <td>${statusChip('Bank Pledged')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div></div>
    <div class="grid">
      ${D.banks.map(b=>`
        <div class="card gtop"><div class="hd"><h3>${b.name}</h3></div>
          <div class="bd"><div class="kv" style="grid-template-columns:1fr 1fr">
            <div class="i"><div class="k">Branch</div><div class="v">${b.branch}</div></div>
            <div class="i"><div class="k">IFSC</div><div class="v">${b.ifsc}</div></div>
            <div class="i"><div class="k">Pledged Loans</div><div class="v">${b.pledged}</div></div>
            <div class="i"><div class="k">Exposure</div><div class="v">${fmt(b.amt)}</div></div>
          </div></div></div>`).join('')}
    </div>
  </div>`;
}

/* ── AUCTIONS ──────────────────────────────── */
function renderAuctions(){
  const stages = ['Overdue','Default','Auction Eligible','Notice Issued','Auction Scheduled','Auctioned','Settled'];
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Auction Management</h1><p>Defaulted loans progressing through the regulated auction workflow</p></div>
  </div>
  <hr class="gold-rule">
  ${D.auctions.map(a=>{
    const idx = stages.indexOf(a.stage);
    return `<div class="card gtop" style="margin-bottom:16px">
      <div class="hd"><h3>${a.loan} — ${a.cust}</h3><div class="sp"></div>${statusChip(a.stage)}</div>
      <div class="bd">
        <div class="track" style="margin-bottom:14px">
          ${stages.map((s,i)=>`<div class="st ${i<=idx?'done':''}">${s}</div>`).join('')}
        </div>
        <div class="kv">
          <div class="i"><div class="k">Gold Weight</div><div class="v">${fmtW(a.weight)}</div></div>
          <div class="i"><div class="k">Outstanding</div><div class="v" style="color:var(--red);font-weight:600">${fmt(a.outstanding)}</div></div>
          <div class="i"><div class="k">Eligible Since</div><div class="v">${a.eligible}</div></div>
          <div class="i"><div class="k">Notice Issued</div><div class="v">${a.notice}</div></div>
          <div class="i"><div class="k">Auction Date</div><div class="v">${a.auctionDate}</div></div>
          <div class="i"><div class="k">Sale Amount</div><div class="v">${a.sale?fmt(a.sale):'—'}</div></div>
        </div>
      </div>
      <div class="ft" style="display:flex;gap:10px;align-items:center">
        Notices & auction SMS history maintained · surplus/shortfall computed after sale
        <span style="flex:1"></span>
        ${idx >= stages.indexOf('Auction Scheduled')
          ? `<button class="btn ghost sm" onclick="openAuctionModal('${a.loan}')">Reschedule</button>
             <button class="btn sm" onclick="printAuctionLetter('${a.loan}')">${icon('doc')} Print Auction Letter</button>`
          : `<button class="btn sm" onclick="openAuctionModal('${a.loan}')">${icon('gavel')} Schedule Auction</button>`}
      </div>
    </div>`;
  }).join('')}
  <div class="notice">${icon('shield')} Workflow: Overdue → Default → Auction Eligible → Notice Issued → Auction Scheduled → Auctioned → Settled, with customer notice history and settlement records at every step.</div>`;
}

/* ── REPORTS ───────────────────────────────── */
function renderReports(){
  const reps = [
    ['Daily Loan Disbursement','Loans opened per day with amounts','chart'],
    ['Active / Closed / Overdue Loans','Portfolio status breakdown','list'],
    ['Interest & Penal Collection','Collections by month and branch','coin'],
    ['Outstanding Principal','Exposure by scheme & branch','chart'],
    ['Gold / Ornament & Weight','Total pledged weight by purity','scale'],
    ['Packet Tracking & Locker','Movement & storage audit','scan'],
    ['Bank Pledge & Liability','External pledge exposure','bank'],
    ['Gold Release / Closure','Settlements and releases','unlock'],
    ['Auction Reports','Cases, notices, recovery','gavel'],
    ['Expense & Cash Flow','Cash movement and expense heads','coin'],
    ['KYC Verification','PAN/Aadhaar verification log','shield'],
    ['Gold Rate History','Published daily rates','coin'],
    ['Employee Performance','Loans, collections & follow-ups per employee','user'],
    ['Communication History','SMS / WhatsApp sent per loan','chat'],
  ];
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Reports</h1><p>Filterable reports, exportable to PDF / Excel</p></div>
  </div>
  <hr class="gold-rule">
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">
    ${reps.map(([t,s,ic])=>`
      <div class="card" style="cursor:pointer" onclick="toast('${t} report — generated in full build (PDF/Excel)')">
        <div class="bd" style="display:flex;gap:13px;align-items:center">
          <span class="ic" style="width:40px;height:40px;border-radius:9px;background:#f8eecb;color:var(--gold-deep);display:grid;place-content:center">${icon(ic)}</span>
          <div><b style="font-size:14.5px;color:var(--charcoal)">${t}</b>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${s}</div></div>
        </div>
      </div>`).join('')}
  </div>`;
}

/* ── EMPLOYEES ─────────────────────────────── */
function renderEmployees(){
  view.innerHTML = `
  <div class="page-h">
    <div><h1>Employees & Roles</h1><p>Role-based access · performance across loans, collections and follow-ups</p></div>
    <div class="sp"></div><button class="btn" onclick="openEmployeeModal()">${icon('plus')} Add Employee</button>
  </div>
  <hr class="gold-rule">
  <div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Employee</th><th>Role</th><th>Branch</th><th class="num">Loans Processed</th><th class="num">Collections</th><th class="num">Follow-ups</th><th class="num">Pending</th></tr></thead>
    <tbody>${D.employees.map(e=>`<tr>
      <td><span style="display:inline-flex;align-items:center;gap:10px">
        <span class="av" style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--gold-light),var(--gold-deep));color:#2b2001;display:grid;place-content:center;font-weight:600;font-size:11.5px">${initials(e.name)}</span>
        <span><b>${e.name}</b><span class="sub">${e.id}</span></span></span></td>
      <td><span class="chip ${e.role==='Administrator'?'gold':e.role==='Branch Manager'?'blue':'gray'}">${e.role}</span></td>
      <td>${e.branch}</td>
      <td class="num">${e.loans||'—'}</td><td class="num">${fmt(e.collections)}</td>
      <td class="num">${e.followups}</td><td class="num">${e.pending}</td></tr>`).join('')}</tbody>
  </table></div>
  <div class="ft">Roles: Administrator · Management · Branch Manager · Loan Operator · Cashier · Accountant · Collection Staff · Auction Admin · Auditor. Sensitive actions (rate changes, waivers, reversals, closures) sit behind approval workflows with a full audit trail.</div></div>`;
}

window.openEmployeeModal = function(){
  const roles = ['Administrator','Management','Branch Manager','Loan Operator','Cashier','Accountant','Collection Staff','Auction Admin','Auditor'];
  openModal(`
    <div class="hd"><h3>Add Employee</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="frow c2">
        <div><label class="f">Full Name *</label><input class="inp" id="emName" placeholder="e.g. Arun Kumar"></div>
        <div><label class="f">Mobile Number</label><input class="inp" id="emPhone" placeholder="10-digit mobile" maxlength="11"></div>
      </div>
      <div class="frow c2">
        <div><label class="f">Role *</label>
          <select class="inp" id="emRole"><option value="">Select role…</option>${roles.map(r=>`<option>${r}</option>`).join('')}</select></div>
        <div><label class="f">Branch *</label>
          <select class="inp" id="emBranch"><option>Koratty</option><option>Angamaly</option><option>Kodakara</option></select></div>
      </div>
      <div class="notice">${icon('shield')} The employee gets role-based access — sensitive actions stay behind approval workflows with a full audit trail.</div>
      <p id="emErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveEmployee()">${icon('check')} Add Employee</button>
    </div>`);
};
window.saveEmployee = function(){
  const name = $('#emName').value.trim();
  const role = $('#emRole').value;
  const err  = $('#emErr');
  if(name.length < 3){ err.textContent = 'Please enter the employee’s full name.'; return; }
  if(!role){ err.textContent = 'Please select a role.'; return; }
  const phone = $('#emPhone').value.trim();
  const id = D.addEmployee({ name, role, branch: $('#emBranch').value, phone,
    loans: 0, collections: 0, followups: 0, pending: 0 });
  if(!id){ err.textContent = 'Could not save — storage is full.'; return; }
  closeModal(); toast(`${name} added as ${role} (${id})`); router();
};

/* ── SCHEDULE AUCTION MODAL & LETTER ───────── */
window.openAuctionModal = function(loan){
  const a = D.auctions.find(x=>x.loan===loan);
  if(!a){ toast('Auction case not found'); return; }
  const today = new Date().toISOString().slice(0,10);
  openModal(`
    <div class="hd"><h3>Schedule Auction — ${a.loan}</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="notice" style="margin-bottom:16px">${icon('gavel')} ${a.cust} · ${fmtW(a.weight)} gold · outstanding <b>${fmt(a.outstanding)}</b> · notice issued ${a.notice}</div>
      <div class="frow c2">
        <div><label class="f">Auction Date *</label><input class="inp" id="auDate" type="date" min="${today}" value="${a.auctionDate!=='—'?a.auctionDate:''}"></div>
        <div><label class="f">Venue</label><input class="inp" id="auVenue" value="${a.venue||'Ambika Gold Finance, Koratty Branch'}"></div>
      </div>
      <p id="auErr" style="color:var(--red);font-size:12.5px;min-height:16px;margin-top:8px"></p>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveAuctionSchedule('${a.loan}')">${icon('check')} Schedule Auction</button>
    </div>`);
};
window.saveAuctionSchedule = function(loan){
  const date  = $('#auDate').value;
  const venue = $('#auVenue').value.trim() || 'Ambika Gold Finance, Koratty Branch';
  const err   = $('#auErr');
  if(!date){ err.textContent = 'Please choose the auction date.'; return; }
  if(!D.updateAuction(loan, { stage:'Auction Scheduled', auctionDate: date, venue })){
    err.textContent = 'Could not save — storage is full.'; return; }
  router();
  openModal(`
    <div class="hd"><h3>Auction Scheduled</h3><button class="x" onclick="closeModal()">×</button></div>
    <div class="bd">
      <div class="notice">${icon('check')} Auction for <b>${loan}</b> is scheduled on <b>${date}</b> at ${venue}.
      You can now print the auction letter for the customer notice and public announcement.</div>
    </div>
    <div class="ft">
      <button class="btn ghost" onclick="closeModal()">Close</button>
      <button class="btn" onclick="closeModal();printAuctionLetter('${loan}')">${icon('doc')} Print Auction Letter</button>
    </div>`);
};
window.printAuctionLetter = function(loan){
  const a = D.auctions.find(x=>x.loan===loan);
  if(!a || a.auctionDate==='—'){ toast('Schedule the auction first'); return; }
  const l = D.loans.find(x=>x.id===loan) || {};
  const c = custOf(l.cust);
  const orns = D.ornaments[loan] || [];
  const today = new Date().toISOString().slice(0,10);
  printDoc('Auction Letter — ' + loan, `
    <h1>AMBIKA GOLD FINANCE</h1>
    <h2>Koratty, Thrissur, Kerala · Ph: 0480-2730000</h2>
    <p class="muted">Ref: AGF/AUC/${loan.replace('GL-','')} · Date: ${today}</p>
    <p><b>To,</b><br>${c.name||a.cust}<br>${c.addr||''}<br>Ph: ${c.phone||''}</p>
    <p><b>Subject: Final notice — public auction of gold ornaments pledged against loan ${loan}</b></p>
    <p>Dear Sir/Madam,</p>
    <ol>
      <li>Despite our repeated reminders and the registered notice dated <b>${a.notice}</b>, the dues against
        your gold loan <b>${loan}</b> (outstanding <b>${fmt(a.outstanding)}</b> as on date, eligible for auction
        since ${a.eligible}) remain unpaid.</li>
      <li>You are hereby given final notice that the gold ornaments pledged against the said loan will be sold in
        <b>PUBLIC AUCTION</b> on <b>${a.auctionDate}</b> at <b>${a.venue||'Ambika Gold Finance, Koratty Branch'}</b>,
        if the entire dues are not settled before the auction date.</li>
      <li>Details of the pledged ornaments to be auctioned:</li>
    </ol>
    <table>
      <tr><th>Ornament</th><th>Purity</th><th class="num">Gross (g)</th><th class="num">Net (g)</th><th class="num">Qty</th></tr>
      ${orns.map(o=>`<tr><td>${o.n}</td><td>${o.purity}</td><td class="num">${o.gross.toFixed(1)}</td><td class="num">${o.net.toFixed(1)}</td><td class="num">${o.qty}</td></tr>`).join('')
        || `<tr><td colspan="5">Pledged gold — ${a.weight.toFixed(1)} g total</td></tr>`}
    </table>
    <ol start="4">
      <li>Any surplus from the auction sale after adjusting the principal, interest, penal charges and auction
        expenses will be refunded to you; any shortfall shall remain recoverable from you.</li>
      <li>You may redeem the ornaments by settling the full outstanding with charges at our branch on any working
        day <b>before ${a.auctionDate}</b>.</li>
    </ol>
    <p>This notice is issued as per the terms of the loan agreement and applicable regulations.</p>
    <div class="sig"><div><span>Authorized Signatory</span></div><div><span>Branch Manager</span></div></div>`);
};

/* ── icons ─────────────────────────────────── */
function icon(n){
  const p = {
    coin:'<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    check:'<path d="M4 12.5 9.5 18 20 6.5"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
    bell:'<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.5"/>',
    unlock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/>',
    stamp:'<path d="M6 20h12M9 14c-2.5 0-4 1-4 3h14c0-2-1.5-3-4-3l-1-6.5a2.5 2.5 0 0 0-4 0Z"/>',
    gavel:'<path d="m9 7 6 6M12 4l6 6M3 21h9M7.5 8.5 12 4l6 6-4.5 4.5zM14 13l6 6"/>',
    shield:'<path d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6Z"/>',
    doc:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    chat:'<path d="M4 5h16v11H8l-4 4z"/>',
    phone:'<path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a1.5 1.5 0 0 1-1.7 1.5C10 19.7 4.3 14 3.5 5.7A1.5 1.5 0 0 1 5 4Z"/>',
    scan:'<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16"/>',
    bank:'<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    scale:'<path d="M12 4v16M6 7l-3 6a3.5 3.5 0 0 0 6 0zM18 7l-3 6a3.5 3.5 0 0 0 6 0zM7 4h10M9 20h6"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    home:'<path d="m3 11 9-7 9 7v9h-6v-6h-6v6H3z"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chart:'<path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8"/>',
    cal:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    box:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p[n]||p.doc}</svg>`;
}
window._icon = icon;

/* ── nav build ─────────────────────────────── */
const NAV = [
  ['Overview', [
    ['dashboard','Dashboard','home'],
    ['calendar','Reminder Calendar','cal'],
    ['reports','Reports','chart'],
  ]],
  ['Lending', [
    ['loans','Loans','list'],
    ['newloan','New Gold Loan','plus'],
    ['schemes','Loan Schemes','doc'],
    ['goldrates','Gold Rates','coin'],
    ['requests','Extensions & Release','unlock'],
  ]],
  ['Customers', [
    ['customers','Customers & KYC','user'],
  ]],
  ['Gold Custody', [
    ['packets','Packets & Lockers','box'],
    ['bankpledge','Bank Re-Pledge','bank'],
    ['auctions','Auctions','gavel'],
  ]],
  ['Operations', [
    ['cash','Cash & Expenses','coin'],
    ['employees','Employees & Roles','user'],
  ]],
];
$('#navBox').innerHTML = NAV.map(([g,items])=>
  `<div class="grp">${g}</div>` + items.map(([r,t,ic])=>
    `<a href="#${r}">${icon(ic)}${t}${r==='requests'?'<span class="pill">3</span>':r==='auctions'?'<span class="pill">1</span>':''}</a>`).join('')
).join('');

$('#burger').addEventListener('click', ()=>$('#side').classList.toggle('open'));

/* ── global search ─────────────────────────── */
(function(){
  const inp = $('#gsInput'), box = $('#gsResults');
  let sel = -1;

  function searchAll(q){
    q = q.toLowerCase();
    const hit = s => (s||'').toLowerCase().includes(q);
    const groups = [];
    const loans = D.loans.filter(l => hit(l.id) || hit(custOf(l.cust).name) || hit(l.status)).slice(0,5)
      .map(l => ({href:'#loan/'+l.id, ic:'list', t:l.id+' — '+custOf(l.cust).name, s:schemeOf(l.scheme).name+' · '+fmt(l.principal), chip:l.status}));
    if(loans.length) groups.push(['Loans', loans]);
    const custs = D.customers.filter(c => hit(c.name) || hit(c.id) || hit(c.phone) || hit(c.addr)).slice(0,5)
      .map(c => ({href:'#customer/'+c.id, ic:'user', t:c.name, s:c.id+' · '+c.phone+' · '+c.branch, chip:c.kyc}));
    if(custs.length) groups.push(['Customers', custs]);
    const schs = D.schemes.filter(s => hit(s.name) || hit(s.id)).slice(0,4)
      .map(s => ({href:'#schemes', ic:'doc', t:s.name, s:s.rate+'% p.a. · '+s.ltv+'% LTV · penal '+s.penal+'%/m', chip:s.active?'Active':'Inactive'}));
    if(schs.length) groups.push(['Schemes', schs]);
    const pkts = D.packets.filter(p => hit(p.id) || hit(p.qr) || hit(p.cust)).slice(0,4)
      .map(p => ({href:'#packets', ic:'box', t:p.id+' — '+p.cust, s:p.weight.toFixed(1)+' g · '+p.locker, chip:p.status}));
    if(pkts.length) groups.push(['Gold Packets', pkts]);
    const emps = D.employees.filter(e => hit(e.name) || hit(e.id) || hit(e.role)).slice(0,4)
      .map(e => ({href:'#employees', ic:'user', t:e.name, s:e.role+' · '+e.branch, chip:null}));
    if(emps.length) groups.push(['Employees', emps]);
    return groups;
  }

  function draw(){
    const q = inp.value.trim();
    sel = -1;
    if(q.length < 2){ box.classList.remove('open'); box.innerHTML=''; return; }
    const groups = searchAll(q);
    box.innerHTML = groups.length
      ? groups.map(([g,items]) => `<div class="gs-grp">${g}</div>` + items.map(r =>
          `<a href="${r.href}"><span class="ic">${icon(r.ic)}</span>
           <span class="tx"><b>${r.t}</b><small>${r.s}</small></span>
           ${r.chip ? statusChip(r.chip) : ''}</a>`).join('')).join('')
      : `<div class="gs-none">No results for “${q.replace(/</g,'&lt;')}”</div>`;
    box.classList.add('open');
  }

  function close(){ box.classList.remove('open'); }
  function items(){ return [...box.querySelectorAll('a')]; }

  inp.addEventListener('input', draw);
  inp.addEventListener('focus', ()=>{ if(inp.value.trim().length>=2) draw(); });
  inp.addEventListener('keydown', e => {
    const list = items();
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();
      if(!list.length) return;
      sel = e.key==='ArrowDown' ? (sel+1)%list.length : (sel-1+list.length)%list.length;
      list.forEach((a,i)=>a.classList.toggle('sel', i===sel));
      list[sel].scrollIntoView({block:'nearest'});
    }else if(e.key==='Enter'){
      const target = sel>=0 ? list[sel] : list[0];
      if(target){ location.hash = target.getAttribute('href'); inp.value=''; close(); inp.blur(); }
    }else if(e.key==='Escape'){
      inp.value=''; close(); inp.blur();
    }
  });
  box.addEventListener('click', e => {
    if(e.target.closest('a')){ inp.value=''; close(); }
  });
  document.addEventListener('click', e => { if(!e.target.closest('.gsearch')) close(); });
  document.addEventListener('keydown', e => {
    if(e.key==='/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){
      e.preventDefault(); inp.focus();
    }
  });
})();
window.toast = toast;
window.addEventListener('hashchange', router);
router();
})();
