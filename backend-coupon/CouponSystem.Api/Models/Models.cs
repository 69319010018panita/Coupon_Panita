using System.Text.Json.Serialization;

namespace CouponSystem.Api.Models;

// ---------- Admin / Auth ----------
public class Admin
{
    public string id { get; set; } = "";
    public string username { get; set; } = "";
    public string password_hash { get; set; } = "";
    public string? display_name { get; set; }
}

public record LoginRequest(string Username, string Password);
public record LoginResponse(string Token, string DisplayName, DateTime ExpiresAt);

// ---------- Customer ----------
public class Customer
{
    public string? id { get; set; }
    public string customer_code { get; set; } = "";
    public string name { get; set; } = "";
    public string? phone { get; set; }
    public string? email { get; set; }
    public DateTime? created_at { get; set; }
}

// ---------- Coupon ----------
// discount_type: "percent" | "fixed"
public class Coupon
{
    public string? id { get; set; }
    public string code { get; set; } = "";
    public string? description { get; set; }
    public string discount_type { get; set; } = "percent";
    public decimal value { get; set; }
    public decimal? max_discount { get; set; }
    public decimal min_purchase { get; set; } = 0;
    public DateOnly start_date { get; set; }
    public DateOnly end_date { get; set; }
    public int? usage_limit { get; set; }
    public int used_count { get; set; } = 0;
    public bool is_active { get; set; } = true;
    public DateTime? created_at { get; set; }
}

// ---------- Usage ----------
public class CouponUsage
{
    public string? id { get; set; }
    public string coupon_id { get; set; } = "";
    public string? customer_id { get; set; }
    public decimal purchase_amount { get; set; }
    public decimal discount_amount { get; set; }
    public decimal final_amount { get; set; }
    public DateTime? used_at { get; set; }
}

public record CalculateRequest(string CouponCode, decimal PurchaseAmount);
public record RedeemRequest(string CouponCode, string? CustomerCode, decimal PurchaseAmount);

public record CalculateResult(
    bool Valid,
    string? Reason,
    decimal PurchaseAmount,
    decimal DiscountAmount,
    decimal FinalAmount,
    Coupon? Coupon
);

public class ApiError
{
    [JsonPropertyName("message")]
    public string Message { get; set; } = "";
}
