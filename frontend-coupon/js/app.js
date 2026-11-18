// ============================================================
// Coupon System - Frontend logic
// ใช้ Supabase Auth และ PostgREST โดยตรง พร้อมป้องกันข้อมูลด้วย RLS
// ============================================================

const SUPABASE_URL = window.SUPABASE_URL?.replace(/\/+$/, "");
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
const SESSION_KEY = "cs_supabase_session";
const money = (n) => Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTh = (d) => d ? new Date(d).toLocaleString("th-TH") : "-";

// ---------------- AUTH ----------------
function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}
function setSession(session) { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function ensureSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === "PASTE_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE") {
    throw new Error("กรุณาตั้งค่า Supabase URL และ publishable/anon key ใน index.html");
  }
}

async function sendSupabase(path, options = {}, accessToken = null) {
  ensureSupabaseConfig();
  const headers = new Headers(options.headers || {});
  headers.set("apikey", SUPABASE_ANON_KEY);
  const bearerToken = accessToken || (SUPABASE_ANON_KEY.startsWith("sb_publishable_") ? null : SUPABASE_ANON_KEY);
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  else headers.delete("Authorization");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
}

async function readSupabaseResponse(resp) {
  const text = await resp.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!resp.ok) {
    const message = typeof data === "string"
      ? data
      : data?.msg || data?.message || data?.error_description || data?.error;
    throw new Error(message || `Supabase error (${resp.status})`);
  }
  return data;
}

async function supabaseFetch(path, options = {}) {
  const session = getSession();
  let resp = await sendSupabase(path, options, session?.access_token || null);

  if (resp.status === 401 && session?.refresh_token) {
    try {
      const refreshResp = await sendSupabase(
        "/auth/v1/token?grant_type=refresh_token",
        { method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) }
      );
      const refreshedSession = await readSupabaseResponse(refreshResp);
      setSession(refreshedSession);
      resp = await sendSupabase(path, options, refreshedSession.access_token);
    } catch (err) {
      clearSession();
      showLogin();
      throw new Error(`เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ (${err.message})`);
    }
  }

  if (resp.status === 401 && session) {
    clearSession();
    showLogin();
  }
  return readSupabaseResponse(resp);
}

async function assertAdmin() {
  const session = getSession();
  if (!session?.user?.id) throw new Error("กรุณาเข้าสู่ระบบใหม่");
  const profiles = await supabaseFetch(
    `/rest/v1/admin_users?select=user_id,display_name&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`
  );
  if (!profiles.length) throw new Error("บัญชีนี้ไม่ได้รับสิทธิ์ผู้ดูแลระบบ");
  return profiles[0];
}

function tableRequest(table, query = "", options = {}) {
  return supabaseFetch(`/rest/v1/${table}${query}`, options);
}

function showLogin() {
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}
function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  loadCoupons(); loadCustomers(); loadHistory();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    const session = await supabaseFetch("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setSession(session);
    await assertAdmin();
    showApp();
  } catch (err) {
    clearSession();
    errEl.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  const session = getSession();
  clearSession();
  showLogin();
  if (!session?.access_token) return;
  try {
    const resp = await sendSupabase("/auth/v1/logout", { method: "POST" }, session.access_token);
    await readSupabaseResponse(resp);
  } catch (err) {
    document.getElementById("loginError").textContent = `ออกจากระบบในหน้านี้แล้ว แต่ยกเลิกเซสชันบน Supabase ไม่สำเร็จ: ${err.message}`;
  }
});

// ---------------- THEME ----------------
const BACKGROUND_KEY = "cs_background_color";
function applyBackgroundColor(hex) {
  const root = document.documentElement;
  root.style.setProperty("--bg", hex);
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const isLight = luminance > 0.22;
  root.style.setProperty("--canvas-text", isLight ? "#20243a" : "#ffffff");
  root.style.setProperty("--canvas-muted", isLight ? "#62687d" : "#e4e6f0");
}
(function initBackgroundColor() {
  const input = document.getElementById("backgroundColor");
  const saved = localStorage.getItem(BACKGROUND_KEY) || "#f5f6fb";
  input.value = saved;
  applyBackgroundColor(saved);
})();
document.getElementById("backgroundColor").addEventListener("input", (e) => {
  localStorage.setItem(BACKGROUND_KEY, e.target.value);
  applyBackgroundColor(e.target.value);
});

// ---------------- TABS ----------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------------- MODAL ----------------
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.classList.remove("hidden");
}
function closeModal() { modalOverlay.classList.add("hidden"); }
document.getElementById("modalClose").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

// ============================================================
// COUPONS
// ============================================================
let couponRows = [];

function renderCoupons() {
  const tbody = document.querySelector("#couponsTable tbody");
  const query = document.getElementById("couponSearch").value.trim().toLowerCase();
  const summary = document.getElementById("couponSearchSummary");

  if (!couponRows.length) {
    tbody.innerHTML = `<tr><td colspan="9">ยังไม่มีคูปอง</td></tr>`;
    summary.textContent = "0 รายการ";
    return;
  }

  const filtered = couponRows.filter((c) => [
    c.code,
    c.description,
    c.discount_type === "percent" ? "เปอร์เซ็นต์ percent" : "จำนวนเงิน fixed",
    c.value,
    c.max_discount,
    c.min_purchase,
    c.start_date,
    c.end_date,
    c.used_count,
    c.usage_limit,
    c.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"
  ].some((value) => String(value ?? "").toLowerCase().includes(query)));

  summary.textContent = query
    ? `พบ ${filtered.length} จาก ${couponRows.length} รายการ`
    : `${couponRows.length} รายการ`;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9">ไม่พบคูปองที่ตรงกับคำค้น</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((c) => `
    <tr>
      <td><strong>${c.code}</strong></td>
      <td>${c.discount_type === "percent" ? "เปอร์เซ็นต์" : "จำนวนเงิน"}</td>
      <td>${c.discount_type === "percent" ? c.value + "%" : money(c.value) + " บาท"}</td>
      <td>${c.max_discount != null ? money(c.max_discount) + " บาท" : "-"}</td>
      <td>${money(c.min_purchase)} บาท</td>
      <td>${c.start_date} ถึง ${c.end_date}</td>
      <td>${c.used_count}${c.usage_limit != null ? " / " + c.usage_limit : ""}</td>
      <td><span class="badge ${c.is_active ? "badge-on" : "badge-off"}">${c.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span></td>
      <td>
        <button class="btn btn-ghost btn-icon" onclick="editCoupon('${c.id}')">แก้ไข</button>
        <button class="btn btn-ghost btn-icon" onclick="deleteCoupon('${c.id}')">ลบ</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("couponSearch").addEventListener("input", renderCoupons);

async function loadCoupons() {
  const tbody = document.querySelector("#couponsTable tbody");
  const summary = document.getElementById("couponSearchSummary");
  tbody.innerHTML = `<tr><td colspan="9">กำลังโหลด...</td></tr>`;
  summary.textContent = "";
  try {
    couponRows = await tableRequest("coupons", "?select=*&order=created_at.desc");
    renderCoupons();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9">โหลดไม่สำเร็จ: ${err.message}</td></tr>`;
  }
}

function couponFormHtml(c = {}) {
  return `
    <label>รหัสคูปอง <input id="f_code" value="${c.code || ""}" required /></label>
    <label>คำอธิบาย <input id="f_desc" value="${c.description || ""}" /></label>
    <label>ประเภทส่วนลด
      <select id="f_type">
        <option value="percent" ${c.discount_type === "percent" ? "selected" : ""}>เปอร์เซ็นต์ (%)</option>
        <option value="fixed" ${c.discount_type === "fixed" ? "selected" : ""}>จำนวนเงิน (บาท)</option>
      </select>
    </label>
    <label>มูลค่าส่วนลด <input type="number" step="0.01" id="f_value" value="${c.value ?? ""}" required /></label>
    <label>เพดานส่วนลดสูงสุด (บาท, เว้นว่าง = ไม่จำกัด) <input type="number" step="0.01" id="f_max" value="${c.max_discount ?? ""}" /></label>
    <label>ยอดซื้อขั้นต่ำ (บาท) <input type="number" step="0.01" id="f_min" value="${c.min_purchase ?? 0}" /></label>
    <label>วันที่เริ่มใช้ <input type="date" id="f_start" value="${c.start_date || ""}" required /></label>
    <label>วันที่หมดอายุ <input type="date" id="f_end" value="${c.end_date || ""}" required /></label>
    <label>จำนวนครั้งที่ใช้ได้ (เว้นว่าง = ไม่จำกัด) <input type="number" id="f_limit" value="${c.usage_limit ?? ""}" /></label>
    <label class="checkbox-field"><input type="checkbox" id="f_active" ${c.is_active !== false ? "checked" : ""} /><span>เปิดใช้งานคูปอง</span></label>
    <p class="error-text" id="f_err"></p>
    <button class="btn btn-primary btn-block" id="f_save">บันทึก</button>
  `;
}

function readCouponForm() {
  return {
    code: document.getElementById("f_code").value.trim(),
    description: document.getElementById("f_desc").value.trim(),
    discount_type: document.getElementById("f_type").value,
    value: parseFloat(document.getElementById("f_value").value),
    max_discount: document.getElementById("f_max").value === "" ? null : parseFloat(document.getElementById("f_max").value),
    min_purchase: parseFloat(document.getElementById("f_min").value || 0),
    start_date: document.getElementById("f_start").value,
    end_date: document.getElementById("f_end").value,
    usage_limit: document.getElementById("f_limit").value === "" ? null : parseInt(document.getElementById("f_limit").value),
    is_active: document.getElementById("f_active").checked
  };
}

document.getElementById("newCouponBtn").addEventListener("click", () => {
  openModal("เพิ่มคูปองใหม่", couponFormHtml());
  document.getElementById("f_save").addEventListener("click", async () => {
    try {
      await tableRequest("coupons", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(readCouponForm())
      });
      closeModal(); loadCoupons();
    } catch (err) { document.getElementById("f_err").textContent = err.message; }
  });
});

window.editCoupon = async (id) => {
  const rows = await tableRequest("coupons", `?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows.length) throw new Error("ไม่พบคูปองนี้");
  const c = rows[0];
  openModal("แก้ไขคูปอง", couponFormHtml(c));
  document.getElementById("f_save").addEventListener("click", async () => {
    try {
      await tableRequest("coupons", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(readCouponForm())
      });
      closeModal(); loadCoupons();
    } catch (err) { document.getElementById("f_err").textContent = err.message; }
  });
};

window.deleteCoupon = async (id) => {
  if (!confirm("ยืนยันการลบคูปองนี้?")) return;
  await tableRequest("coupons", `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  loadCoupons();
};

// ============================================================
// CUSTOMERS
// ============================================================
let customerRows = [];

function renderCustomers() {
  const tbody = document.querySelector("#customersTable tbody");
  const query = document.getElementById("customerSearch").value.trim().toLowerCase();
  const summary = document.getElementById("customerSearchSummary");

  if (!customerRows.length) {
    tbody.innerHTML = `<tr><td colspan="5">ยังไม่มีลูกค้า</td></tr>`;
    summary.textContent = "0 รายการ";
    return;
  }

  const filtered = customerRows.filter((c) => [
    c.customer_code,
    c.name,
    c.phone,
    c.email
  ].some((value) => String(value ?? "").toLowerCase().includes(query)));

  summary.textContent = query
    ? `พบ ${filtered.length} จาก ${customerRows.length} รายการ`
    : `${customerRows.length} รายการ`;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5">ไม่พบลูกค้าที่ตรงกับคำค้น</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((c) => `
    <tr>
      <td><strong>${c.customer_code}</strong></td>
      <td>${c.name}</td>
      <td>${c.phone || "-"}</td>
      <td>${c.email || "-"}</td>
      <td>
        <button class="btn btn-ghost btn-icon" onclick="editCustomer('${c.id}')">แก้ไข</button>
        <button class="btn btn-ghost btn-icon" onclick="deleteCustomer('${c.id}')">ลบ</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("customerSearch").addEventListener("input", renderCustomers);

async function loadCustomers() {
  const tbody = document.querySelector("#customersTable tbody");
  const summary = document.getElementById("customerSearchSummary");
  tbody.innerHTML = `<tr><td colspan="5">กำลังโหลด...</td></tr>`;
  summary.textContent = "";
  try {
    customerRows = await tableRequest("customers", "?select=*&order=created_at.desc");
    renderCustomers();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">โหลดไม่สำเร็จ: ${err.message}</td></tr>`;
  }
}

function customerFormHtml(c = {}) {
  return `
    <label>รหัสลูกค้า <input id="cf_code" value="${c.customer_code || ""}" required /></label>
    <label>ชื่อ-นามสกุล <input id="cf_name" value="${c.name || ""}" required /></label>
    <label>เบอร์โทร <input id="cf_phone" value="${c.phone || ""}" /></label>
    <label>อีเมล <input id="cf_email" value="${c.email || ""}" /></label>
    <p class="error-text" id="cf_err"></p>
    <button class="btn btn-primary btn-block" id="cf_save">บันทึก</button>
  `;
}
function readCustomerForm() {
  return {
    customer_code: document.getElementById("cf_code").value.trim(),
    name: document.getElementById("cf_name").value.trim(),
    phone: document.getElementById("cf_phone").value.trim(),
    email: document.getElementById("cf_email").value.trim()
  };
}

document.getElementById("newCustomerBtn").addEventListener("click", () => {
  openModal("เพิ่มลูกค้าใหม่", customerFormHtml());
  document.getElementById("cf_save").addEventListener("click", async () => {
    try {
      await tableRequest("customers", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(readCustomerForm())
      });
      closeModal(); loadCustomers();
    } catch (err) { document.getElementById("cf_err").textContent = err.message; }
  });
});

window.editCustomer = async (id) => {
  const rows = await tableRequest("customers", `?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows.length) throw new Error("ไม่พบข้อมูลลูกค้านี้");
  const c = rows[0];
  openModal("แก้ไขข้อมูลลูกค้า", customerFormHtml(c));
  document.getElementById("cf_save").addEventListener("click", async () => {
    try {
      await tableRequest("customers", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(readCustomerForm())
      });
      closeModal(); loadCustomers();
    } catch (err) { document.getElementById("cf_err").textContent = err.message; }
  });
};

window.deleteCustomer = async (id) => {
  if (!confirm("ยืนยันการลบลูกค้านี้?")) return;
  await tableRequest("customers", `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  loadCustomers();
};

// ============================================================
// REDEEM (ตรวจสอบ + ใช้คูปอง)
// ============================================================
function renderRedeemResult(data, confirmed) {
  const box = document.getElementById("redeemResult");
  box.classList.remove("hidden", "ok", "fail");
  const valid = data.valid ?? data.result?.valid;
  const d = data.result ?? data;
  box.classList.add(valid ? "ok" : "fail");
  box.innerHTML = `
    <div class="result-row"><span>สถานะ</span><strong>${valid ? (confirmed ? "✅ ใช้คูปองสำเร็จ" : "✅ ใช้ได้") : "❌ ใช้ไม่ได้"}</strong></div>
    ${!valid ? `<div class="result-row"><span>เหตุผล</span><span>${d.reason || ""}</span></div>` : ""}
    <div class="result-row"><span>ยอดซื้อ</span><span>${money(d.purchaseAmount)} บาท</span></div>
    <div class="result-row"><span>ส่วนลด</span><span>${money(d.discountAmount)} บาท</span></div>
    <div class="result-row"><span>ยอดสุทธิ</span><strong>${money(d.finalAmount)} บาท</strong></div>
  `;
}

function bangkokDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function calculateCoupon(couponCode, purchaseAmount) {
  const rows = await tableRequest(
    "coupons",
    `?code=eq.${encodeURIComponent(couponCode)}&select=*&limit=1`
  );
  const coupon = rows[0];
  if (!coupon) {
    return { valid: false, reason: "ไม่พบรหัสคูปองนี้", purchaseAmount, discountAmount: 0, finalAmount: purchaseAmount };
  }

  const today = bangkokDate();
  let reason = null;
  if (!coupon.is_active) reason = "คูปองนี้ถูกปิดใช้งาน";
  else if (today < coupon.start_date) reason = `คูปองนี้ยังไม่ถึงวันเริ่มใช้งาน (เริ่ม ${coupon.start_date})`;
  else if (today > coupon.end_date) reason = `คูปองนี้หมดอายุแล้ว (หมดอายุ ${coupon.end_date})`;
  else if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) reason = "คูปองนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว";
  else if (purchaseAmount < Number(coupon.min_purchase)) reason = `ยอดซื้อไม่ถึงขั้นต่ำที่กำหนด (${money(coupon.min_purchase)} บาท)`;
  else if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) reason = "กรุณาระบุยอดซื้อที่ถูกต้อง";

  if (reason) {
    return { valid: false, reason, purchaseAmount, discountAmount: 0, finalAmount: purchaseAmount, coupon };
  }

  let discountAmount = coupon.discount_type === "percent"
    ? purchaseAmount * Number(coupon.value) / 100
    : Number(coupon.value);
  if (coupon.max_discount != null) discountAmount = Math.min(discountAmount, Number(coupon.max_discount));
  discountAmount = Math.round((Math.min(discountAmount, purchaseAmount) + Number.EPSILON) * 100) / 100;
  return {
    valid: true,
    reason: null,
    purchaseAmount,
    discountAmount,
    finalAmount: Math.round((purchaseAmount - discountAmount + Number.EPSILON) * 100) / 100,
    coupon
  };
}

document.getElementById("previewBtn").addEventListener("click", async () => {
  const couponCode = document.getElementById("redeemCouponCode").value.trim();
  const purchaseAmount = parseFloat(document.getElementById("redeemAmount").value || 0);
  if (!couponCode) return;
  try {
    const data = await calculateCoupon(couponCode, purchaseAmount);
    renderRedeemResult(data, false);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("redeemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const couponCode = document.getElementById("redeemCouponCode").value.trim();
  const customerCode = document.getElementById("redeemCustomerCode").value.trim() || null;
  const purchaseAmount = parseFloat(document.getElementById("redeemAmount").value || 0);
  try {
    const data = await supabaseFetch("/rest/v1/rpc/redeem_coupon", {
      method: "POST",
      body: JSON.stringify({
        p_coupon_code: couponCode,
        p_customer_code: customerCode,
        p_purchase_amount: purchaseAmount
      })
    });
    renderRedeemResult(data, true);
    loadHistory();
  } catch (err) {
    const box = document.getElementById("redeemResult");
    box.classList.remove("hidden", "ok"); box.classList.add("fail");
    box.innerHTML = `<div class="result-row"><span>เกิดข้อผิดพลาด</span><span>${err.message}</span></div>`;
  }
});

// ============================================================
// HISTORY
// ============================================================
async function loadHistory() {
  const tbody = document.querySelector("#historyTable tbody");
  tbody.innerHTML = `<tr><td colspan="4">กำลังโหลด...</td></tr>`;
  try {
    const list = await tableRequest("coupon_usages", "?select=*&order=used_at.desc&limit=200");
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="4">ยังไม่มีประวัติการใช้</td></tr>`; return; }
    tbody.innerHTML = list.map((u) => `
      <tr>
        <td>${dateTh(u.used_at)}</td>
        <td>${money(u.purchase_amount)} บาท</td>
        <td>${money(u.discount_amount)} บาท</td>
        <td>${money(u.final_amount)} บาท</td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">โหลดไม่สำเร็จ: ${err.message}</td></tr>`;
  }
}
document.getElementById("refreshHistoryBtn").addEventListener("click", loadHistory);

// ---------------- INIT ----------------
(async function initialize() {
  try {
    if (!getSession()) {
      showLogin();
      return;
    }
    await assertAdmin();
    showApp();
  } catch (err) {
    clearSession();
    showLogin();
    document.getElementById("loginError").textContent = err.message;
  }
})();
