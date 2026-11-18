using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using CouponSystem.Api.Models;
using CouponSystem.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// ---------- Config ----------
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (string.IsNullOrWhiteSpace(jwtSecret) || Encoding.UTF8.GetByteCount(jwtSecret) < 32)
    throw new InvalidOperationException("กำหนด Jwt:Secret ผ่าน environment variable Jwt__Secret ให้มีความยาวอย่างน้อย 32 bytes");

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "CouponSystem";
var jwtExpireMinutes = int.Parse(builder.Configuration["Jwt:ExpiresMinutes"] ?? "480");
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();

// ---------- Services ----------
builder.Services.AddHttpClient<SupabaseClient>();
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddCors(opt =>
{
    opt.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

// ======================================================
// AUTH
// ======================================================
app.MapPost("/api/auth/login", async (LoginRequest req, SupabaseClient db) =>
{
    var admin = await db.GetOneAsync<Admin>("admins", "username", req.Username);
    if (admin is null || !BCrypt.Net.BCrypt.Verify(req.Password, admin.password_hash))
        return Results.Json(new ApiError { Message = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, statusCode: 401);

    var expires = DateTime.UtcNow.AddMinutes(jwtExpireMinutes);
    var claims = new[]
    {
        new Claim(ClaimTypes.NameIdentifier, admin.id),
        new Claim(ClaimTypes.Name, admin.username)
    };
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(jwtIssuer, null, claims, expires: expires, signingCredentials: creds);
    var tokenStr = new JwtSecurityTokenHandler().WriteToken(token);

    return Results.Ok(new LoginResponse(tokenStr, admin.display_name ?? admin.username, expires));
});

// ======================================================
// CUSTOMERS  (ต้อง Login ก่อนใช้งานทุก endpoint ด้านล่าง)
// ======================================================
var customers = app.MapGroup("/api/customers").RequireAuthorization();

customers.MapGet("/", async (SupabaseClient db) =>
    Results.Ok(await db.GetAsync<Customer>("customers", "?order=created_at.desc")));

customers.MapGet("/{id}", async (string id, SupabaseClient db) =>
{
    var c = await db.GetOneAsync<Customer>("customers", "id", id);
    return c is null ? Results.NotFound() : Results.Ok(c);
});

customers.MapPost("/", async (Customer input, SupabaseClient db) =>
{
    var created = await db.InsertAsync<Customer>("customers", new
    {
        customer_code = input.customer_code,
        name = input.name,
        phone = input.phone,
        email = input.email
    });
    return Results.Ok(created);
});

customers.MapPut("/{id}", async (string id, Customer input, SupabaseClient db) =>
{
    var updated = await db.UpdateAsync<Customer>("customers", id, new
    {
        customer_code = input.customer_code,
        name = input.name,
        phone = input.phone,
        email = input.email
    });
    return updated is null ? Results.NotFound() : Results.Ok(updated);
});

customers.MapDelete("/{id}", async (string id, SupabaseClient db) =>
{
    await db.DeleteAsync("customers", id);
    return Results.NoContent();
});

// ======================================================
// COUPONS
// ======================================================
var coupons = app.MapGroup("/api/coupons").RequireAuthorization();

coupons.MapGet("/", async (SupabaseClient db) =>
    Results.Ok(await db.GetAsync<Coupon>("coupons", "?order=created_at.desc")));

coupons.MapGet("/{id}", async (string id, SupabaseClient db) =>
{
    var c = await db.GetOneAsync<Coupon>("coupons", "id", id);
    return c is null ? Results.NotFound() : Results.Ok(c);
});

coupons.MapPost("/", async (Coupon input, SupabaseClient db) =>
{
    if (input.discount_type is not ("percent" or "fixed"))
        return Results.BadRequest(new ApiError { Message = "discount_type ต้องเป็น 'percent' หรือ 'fixed'" });

    var created = await db.InsertAsync<Coupon>("coupons", new
    {
        code = input.code,
        description = input.description,
        discount_type = input.discount_type,
        value = input.value,
        max_discount = input.max_discount,
        min_purchase = input.min_purchase,
        start_date = input.start_date.ToString("yyyy-MM-dd"),
        end_date = input.end_date.ToString("yyyy-MM-dd"),
        usage_limit = input.usage_limit,
        is_active = input.is_active
    });
    return Results.Ok(created);
});

coupons.MapPut("/{id}", async (string id, Coupon input, SupabaseClient db) =>
{
    var updated = await db.UpdateAsync<Coupon>("coupons", id, new
    {
        code = input.code,
        description = input.description,
        discount_type = input.discount_type,
        value = input.value,
        max_discount = input.max_discount,
        min_purchase = input.min_purchase,
        start_date = input.start_date.ToString("yyyy-MM-dd"),
        end_date = input.end_date.ToString("yyyy-MM-dd"),
        usage_limit = input.usage_limit,
        is_active = input.is_active
    });
    return updated is null ? Results.NotFound() : Results.Ok(updated);
});

coupons.MapDelete("/{id}", async (string id, SupabaseClient db) =>
{
    await db.DeleteAsync("coupons", id);
    return Results.NoContent();
});

// ======================================================
// USAGE: ตรวจสอบ/คำนวณ และบันทึกการใช้คูปอง + ดูประวัติ
// ======================================================
var usage = app.MapGroup("/api/usage").RequireAuthorization();

// ตรวจสอบ+คำนวณส่วนลด โดยยังไม่บันทึก (ใช้แสดง preview หน้าหน้าร้าน)
usage.MapPost("/calculate", async (CalculateRequest req, SupabaseClient db) =>
{
    var coupon = await db.GetOneAsync<Coupon>("coupons", "code", req.CouponCode);
    if (coupon is null)
        return Results.NotFound(new ApiError { Message = "ไม่พบรหัสคูปองนี้" });

    var result = DiscountCalculator.Calculate(coupon, req.PurchaseAmount);
    return Results.Ok(result);
});

// คำนวณ + บันทึกการใช้จริง + เพิ่ม used_count
usage.MapPost("/redeem", async (RedeemRequest req, SupabaseClient db) =>
{
    var coupon = await db.GetOneAsync<Coupon>("coupons", "code", req.CouponCode);
    if (coupon is null)
        return Results.NotFound(new ApiError { Message = "ไม่พบรหัสคูปองนี้" });

    var result = DiscountCalculator.Calculate(coupon, req.PurchaseAmount);
    if (!result.Valid)
        return Results.BadRequest(result);

    string? customerId = null;
    if (!string.IsNullOrWhiteSpace(req.CustomerCode))
    {
        var customer = await db.GetOneAsync<Customer>("customers", "customer_code", req.CustomerCode);
        customerId = customer?.id;
    }

    var savedUsage = await db.InsertAsync<CouponUsage>("coupon_usages", new
    {
        coupon_id = coupon.id,
        customer_id = customerId,
        purchase_amount = result.PurchaseAmount,
        discount_amount = result.DiscountAmount,
        final_amount = result.FinalAmount
    });

    await db.UpdateAsync<Coupon>("coupons", coupon.id!, new
    {
        used_count = coupon.used_count + 1
    });

    return Results.Ok(new { usage = savedUsage, result });
});

// ประวัติการใช้ทั้งหมด (เรียงล่าสุดก่อน)
usage.MapGet("/history", async (SupabaseClient db) =>
    Results.Ok(await db.GetAsync<CouponUsage>("coupon_usages", "?order=used_at.desc&limit=200")));

// ประวัติการใช้ตามคูปอง
usage.MapGet("/history/by-coupon/{couponId}", async (string couponId, SupabaseClient db) =>
    Results.Ok(await db.GetAsync<CouponUsage>("coupon_usages", $"?coupon_id=eq.{couponId}&order=used_at.desc")));

// ประวัติการใช้ตามลูกค้า
usage.MapGet("/history/by-customer/{customerId}", async (string customerId, SupabaseClient db) =>
    Results.Ok(await db.GetAsync<CouponUsage>("coupon_usages", $"?customer_id=eq.{customerId}&order=used_at.desc")));

app.Run();
