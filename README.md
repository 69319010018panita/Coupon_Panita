# รหัสล็อกอินเพื่อตรวจสอบระบบ
# email : admin@gmail.com รหัสผ่าน : admin1234

# ระบบจัดการคูปองและส่วนลด

สถาปัตยกรรม: **Frontend (HTML/CSS/JS) → Supabase Auth + Data API → PostgreSQL**

หน้าเว็บเรียก Supabase โดยตรง ไม่ต้องรัน backend C# สำหรับการใช้งานแบบนี้ ตารางข้อมูลถูกป้องกันด้วย Row Level Security (RLS) และอนุญาตเฉพาะบัญชีที่ลงทะเบียนเป็นผู้ดูแลระบบ

## 1) ตั้งค่า Supabase

โปรเจกต์: **`gqaaejohqixpcbrwjmso`**

1. เปิด Supabase Dashboard → **SQL Editor** แล้วรันไฟล์ `database-coupon/schema.sql`. ใช้ได้ทั้งฐานข้อมูลใหม่และฐานข้อมูลเดิมที่สร้างจาก schema รุ่นก่อน
2. เปิด **Authentication > Users** แล้วสร้างผู้ใช้ admin ด้วยอีเมลและรหัสผ่านที่ต้องการ
3. เพิ่มผู้ใช้นั้นลงในรายชื่อ admin จาก SQL Editor โดยแทนอีเมลและชื่อ:

   ```sql
   insert into public.admin_users (user_id, display_name)
   select id, 'ผู้ดูแลระบบ'
   from auth.users
   where email = 'admin@example.com'
   on conflict (user_id) do update
   set display_name = excluded.display_name;
   ```

   ตรวจว่าคำสั่งเพิ่มได้หนึ่งแถว หากไม่มีแถว ให้ตรวจอีเมลของผู้ใช้ใน Authentication ก่อน
4. ปิดการสมัครสมาชิกสาธารณะใน **Authentication settings** หากไม่ต้องการให้มีการสร้างบัญชีทั่วไป ผู้ใช้ที่ไม่มีแถวใน `admin_users` จะไม่มีสิทธิ์อ่านหรือแก้ไขข้อมูล แม้จะล็อกอินได้
5. ไปที่ **Project Settings > API Keys** แล้วคัดลอก **publishable key** (หรือ legacy `anon` key) มาใส่ในหน้าเว็บตามหัวข้อถัดไป ห้ามใช้ `service_role` หรือ secret key ใน browser

## 2) ตั้งค่า Frontend

ใน `frontend-coupon/index.html` กำหนด URL และ public key:

```js
window.SUPABASE_URL = "https://gqaaejohqixpcbrwjmso.supabase.co";
window.SUPABASE_ANON_KEY = "ใส่ publishable หรือ anon key";
```

publishable/anon key เป็นค่าฝั่ง client โดยออกแบบมาให้เปิดเผยได้เมื่อ RLS ถูกตั้งถูกต้อง ห้ามแทนที่ด้วย `service_role`/secret key

เปิด PowerShell ที่โฟลเดอร์ workspace แล้วรันเว็บเซิร์ฟเวอร์:

```powershell
cd frontend-coupon
python -m http.server 5500
```

เปิด `http://localhost:5500` แล้วล็อกอินด้วยอีเมลและรหัสผ่านของผู้ใช้ admin ที่สร้างไว้

## ฟีเจอร์หลัก

- ล็อกอิน/ออกจากระบบด้วย Supabase Auth
- จัดการคูปองและข้อมูลลูกค้า
- ค้นหาคูปองตามรหัส/รายละเอียด และค้นหาลูกค้าด้วยรหัส ชื่อ เบอร์โทร หรืออีเมล
- ตรวจสอบและคำนวณส่วนลด
- บันทึกและดูประวัติการใช้คูปอง
- ปรับโทนสีและใช้ได้บนมือถือ/แท็บเล็ต/เดสก์ท็อป

การยืนยันใช้คูปองทำผ่าน PostgreSQL function `redeem_coupon` ซึ่งตรวจเงื่อนไขและบันทึกการใช้พร้อมอัปเดตยอดใน transaction เดียว

## ความปลอดภัยและการย้ายจาก backend เดิม

- ตาราง `admin_users`, `customers`, `coupons` และ `coupon_usages` เปิด RLS; เฉพาะผู้ใช้ Supabase Auth ที่มีแถวใน `admin_users` จัดการข้อมูลได้
- ผู้ใช้ทั่วไปไม่มีสิทธิ์เพิ่มตัวเองเป็น admin ผ่านหน้าเว็บ
- หน้าเว็บไม่ใช้ `service_role` key หรือ backend JWT secret
- ถ้าฐานข้อมูลมีตาราง `admins` จาก schema เดิม ตารางนั้นไม่ได้ใช้กับการล็อกอินใหม่และยังคงอยู่โดยไม่เปิดสิทธิ์ให้ browser; อย่าลบจนกว่าจะตรวจว่าต้องเก็บข้อมูลเดิมหรือไม่
- Backend C# เดิมไม่อยู่ในเส้นทางการเรียกใช้งานของหน้าเว็บ direct-Supabase นี้; หากเคย deploy backend เดิมไว้ ให้ปิด endpoint นั้นด้วย
