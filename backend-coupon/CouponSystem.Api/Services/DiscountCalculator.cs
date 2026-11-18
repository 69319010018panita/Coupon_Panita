using CouponSystem.Api.Models;

namespace CouponSystem.Api.Services;

public static class DiscountCalculator
{
    /// <summary>
    /// ตรวจสอบเงื่อนไขคูปอง (วันที่, ยอดซื้อขั้นต่ำ, จำนวนครั้งที่ใช้ได้, สถานะเปิดใช้งาน)
    /// และคำนวณส่วนลด ไม่เกินเพดาน (max_discount) และไม่เกินยอดซื้อจริง
    /// </summary>
    public static CalculateResult Calculate(Coupon coupon, decimal purchaseAmount)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(7)); // เทียบเวลาไทย (UTC+7)

        if (!coupon.is_active)
            return Fail(coupon, purchaseAmount, "คูปองนี้ถูกปิดใช้งาน");

        if (today < coupon.start_date)
            return Fail(coupon, purchaseAmount, $"คูปองนี้ยังไม่ถึงวันเริ่มใช้งาน (เริ่ม {coupon.start_date:dd/MM/yyyy})");

        if (today > coupon.end_date)
            return Fail(coupon, purchaseAmount, $"คูปองนี้หมดอายุแล้ว (หมดอายุ {coupon.end_date:dd/MM/yyyy})");

        if (coupon.usage_limit.HasValue && coupon.used_count >= coupon.usage_limit.Value)
            return Fail(coupon, purchaseAmount, "คูปองนี้ถูกใช้ครบจำนวนสิทธิ์แล้ว");

        if (purchaseAmount < coupon.min_purchase)
            return Fail(coupon, purchaseAmount, $"ยอดซื้อไม่ถึงขั้นต่ำที่กำหนด ({coupon.min_purchase:N2} บาท)");

        decimal discount;
        if (coupon.discount_type == "percent")
        {
            discount = purchaseAmount * (coupon.value / 100m);
            if (coupon.max_discount.HasValue && discount > coupon.max_discount.Value)
                discount = coupon.max_discount.Value;
        }
        else // fixed (บาท)
        {
            discount = coupon.value;
        }

        // ส่วนลดต้องไม่เกินยอดซื้อจริง
        if (discount > purchaseAmount) discount = purchaseAmount;
        discount = Math.Round(discount, 2, MidpointRounding.AwayFromZero);

        var final = Math.Round(purchaseAmount - discount, 2, MidpointRounding.AwayFromZero);

        return new CalculateResult(true, null, purchaseAmount, discount, final, coupon);
    }

    private static CalculateResult Fail(Coupon coupon, decimal purchaseAmount, string reason)
        => new(false, reason, purchaseAmount, 0, purchaseAmount, coupon);
}
