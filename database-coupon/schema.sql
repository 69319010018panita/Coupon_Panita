-- ======================================================
-- Schema: ระบบจัดการคูปองและส่วนลด (Coupon & Discount System)
-- ใช้งานบน Supabase (PostgreSQL)
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ -> Run
-- ======================================================

create extension if not exists "pgcrypto";

-- ผูกผู้ดูแลระบบกับผู้ใช้ Supabase Auth ที่สร้างไว้ใน Dashboard
create table if not exists admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz default now()
);

-- ตารางลูกค้า
create table if not exists customers (
    id uuid primary key default gen_random_uuid(),
    customer_code text unique not null,   -- รหัสลูกค้า หรือเบอร์โทร ใช้สำหรับค้นหา
    name text not null,
    phone text,
    email text,
    created_at timestamptz default now()
);

-- ชนิดของส่วนลด
do $$
begin
    if not exists (select 1 from pg_type where typname = 'discount_type') then
        create type discount_type as enum ('percent', 'fixed');
    end if;
end$$;

-- ตารางคูปอง
create table if not exists coupons (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,                 -- รหัสคูปอง เช่น SUMMER50
    description text,
    discount_type discount_type not null,      -- percent หรือ fixed (บาท)
    value numeric(12,2) not null,               -- ค่าเปอร์เซ็นต์ (0-100) หรือจำนวนบาท
    max_discount numeric(12,2),                 -- เพดานส่วนลดสูงสุด (บาท) ใช้คู่กับ percent, null = ไม่จำกัด
    min_purchase numeric(12,2) not null default 0, -- ยอดซื้อขั้นต่ำที่ใช้คูปองได้
    start_date date not null,                   -- วันที่เริ่มใช้ได้
    end_date date not null,                     -- วันที่หมดอายุ
    usage_limit int,                            -- จำนวนครั้งที่ใช้ได้ทั้งหมด, null = ไม่จำกัด
    used_count int not null default 0,          -- จำนวนครั้งที่ถูกใช้ไปแล้ว
    is_active boolean not null default true,
    created_at timestamptz default now()
);

-- ตารางประวัติการใช้คูปอง
create table if not exists coupon_usages (
    id uuid primary key default gen_random_uuid(),
    coupon_id uuid not null references coupons(id) on delete cascade,
    customer_id uuid references customers(id) on delete set null,
    purchase_amount numeric(12,2) not null,
    discount_amount numeric(12,2) not null,
    final_amount numeric(12,2) not null,
    used_at timestamptz not null default now()
);

create index if not exists idx_coupons_code on coupons (code);
create index if not exists idx_customers_code on customers (customer_code);
create index if not exists idx_usages_coupon on coupon_usages (coupon_id);
create index if not exists idx_usages_customer on coupon_usages (customer_id);

-- อนุญาตเฉพาะผู้ใช้ Supabase Auth ที่ลงทะเบียนใน admin_users
-- ฟังก์ชัน SECURITY DEFINER ใช้ตรวจสิทธิ์โดยไม่วนเรียก RLS policy ของ admin_users ซ้ำ
alter table admin_users enable row level security;
alter table customers enable row level security;
alter table coupons enable row level security;
alter table coupon_usages enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

grant usage on schema public to authenticated;
revoke all on public.admin_users, public.customers, public.coupons, public.coupon_usages from public, anon, authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.customers, public.coupons, public.coupon_usages to authenticated;

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record"
    on public.admin_users for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Admin-only boundary for admin records" on public.admin_users;
create policy "Admin-only boundary for admin records"
    on public.admin_users as restrictive for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Admins can manage customers" on public.customers;
create policy "Admins can manage customers"
    on public.customers for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

drop policy if exists "Admin-only boundary for customers" on public.customers;
create policy "Admin-only boundary for customers"
    on public.customers as restrictive for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

drop policy if exists "Admins can manage coupons" on public.coupons;
create policy "Admins can manage coupons"
    on public.coupons for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

drop policy if exists "Admin-only boundary for coupons" on public.coupons;
create policy "Admin-only boundary for coupons"
    on public.coupons as restrictive for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

drop policy if exists "Admins can manage coupon usages" on public.coupon_usages;
create policy "Admins can manage coupon usages"
    on public.coupon_usages for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

drop policy if exists "Admin-only boundary for coupon usages" on public.coupon_usages;
create policy "Admin-only boundary for coupon usages"
    on public.coupon_usages as restrictive for all to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

create or replace function public.redeem_coupon(
    p_coupon_code text,
    p_customer_code text,
    p_purchase_amount numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_coupon public.coupons%rowtype;
    v_customer_id uuid;
    v_usage public.coupon_usages%rowtype;
    v_today date := (now() at time zone 'Asia/Bangkok')::date;
    v_discount numeric(12,2);
    v_final_amount numeric(12,2);
begin
    if p_purchase_amount is null or p_purchase_amount < 0 then
        raise exception 'ยอดซื้อต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป';
    end if;

    select * into v_coupon
    from public.coupons
    where code = p_coupon_code
    for update;

    if not found then
        raise exception 'ไม่พบรหัสคูปองนี้';
    end if;
    if not v_coupon.is_active then
        raise exception 'คูปองนี้ถูกปิดใช้งาน';
    end if;
    if v_today < v_coupon.start_date then
        raise exception 'คูปองนี้ยังไม่ถึงวันเริ่มใช้งาน';
    end if;
    if v_today > v_coupon.end_date then
        raise exception 'คูปองนี้หมดอายุแล้ว';
    end if;
    if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
        raise exception 'คูปองนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว';
    end if;
    if p_purchase_amount < v_coupon.min_purchase then
        raise exception 'ยอดซื้อไม่ถึงขั้นต่ำที่กำหนด';
    end if;

    if v_coupon.discount_type = 'percent' then
        v_discount := p_purchase_amount * v_coupon.value / 100;
        if v_coupon.max_discount is not null then
            v_discount := least(v_discount, v_coupon.max_discount);
        end if;
    else
        v_discount := v_coupon.value;
    end if;

    v_discount := round(least(v_discount, p_purchase_amount), 2);
    v_final_amount := round(p_purchase_amount - v_discount, 2);

    if nullif(btrim(p_customer_code), '') is not null then
        select id into v_customer_id
        from public.customers
        where customer_code = btrim(p_customer_code);
    end if;

    insert into public.coupon_usages (
        coupon_id, customer_id, purchase_amount, discount_amount, final_amount
    )
    values (
        v_coupon.id, v_customer_id, p_purchase_amount, v_discount, v_final_amount
    )
    returning * into v_usage;

    update public.coupons
    set used_count = used_count + 1
    where id = v_coupon.id
    returning * into v_coupon;

    return jsonb_build_object(
        'usage', to_jsonb(v_usage),
        'result', jsonb_build_object(
            'valid', true,
            'reason', null,
            'purchaseAmount', p_purchase_amount,
            'discountAmount', v_discount,
            'finalAmount', v_final_amount,
            'coupon', to_jsonb(v_coupon)
        )
    );
end;
$$;

revoke all on function public.redeem_coupon(text, text, numeric) from public, anon;
grant execute on function public.redeem_coupon(text, text, numeric) to authenticated;
