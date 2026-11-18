using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace CouponSystem.Api.Services;

/// <summary>
/// ตัวช่วยเรียก Supabase ผ่าน REST API (PostgREST) โดยใช้ Service Role Key
/// Service Role Key จะอยู่ฝั่ง Backend เท่านั้น ไม่ส่งให้ Frontend เด็ดขาด
/// </summary>
public class SupabaseClient
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public SupabaseClient(HttpClient http, IConfiguration config)
    {
        var url = config["Supabase:Url"]?.TrimEnd('/')
                  ?? throw new InvalidOperationException("ไม่พบ Supabase:Url");
        var key = config["Supabase:ServiceRoleKey"];
        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("กำหนด Supabase:ServiceRoleKey ผ่าน environment variable Supabase__ServiceRoleKey");

        _http = http;
        _http.BaseAddress = new Uri($"{url}/rest/v1/");
        _http.DefaultRequestHeaders.Add("apikey", key);
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
    }

    public async Task<List<T>> GetAsync<T>(string table, string query = "")
    {
        var resp = await _http.GetAsync($"{table}{query}");
        await EnsureSuccess(resp);
        var result = await resp.Content.ReadFromJsonAsync<List<T>>(JsonOpts);
        return result ?? new List<T>();
    }

    public async Task<T?> GetOneAsync<T>(string table, string filterColumn, string filterValue)
    {
        var list = await GetAsync<T>(table, $"?{filterColumn}=eq.{Uri.EscapeDataString(filterValue)}&limit=1");
        return list.Count > 0 ? list[0] : default;
    }

    public async Task<T> InsertAsync<T>(string table, object payload)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, table)
        {
            Content = JsonContent.Create(payload, options: JsonOpts)
        };
        req.Headers.Add("Prefer", "return=representation");
        var resp = await _http.SendAsync(req);
        await EnsureSuccess(resp);
        var list = await resp.Content.ReadFromJsonAsync<List<T>>(JsonOpts);
        return list!.First();
    }

    public async Task<T?> UpdateAsync<T>(string table, string id, object payload)
    {
        var req = new HttpRequestMessage(HttpMethod.Patch, $"{table}?id=eq.{id}")
        {
            Content = JsonContent.Create(payload, options: JsonOpts)
        };
        req.Headers.Add("Prefer", "return=representation");
        var resp = await _http.SendAsync(req);
        await EnsureSuccess(resp);
        var list = await resp.Content.ReadFromJsonAsync<List<T>>(JsonOpts);
        return list is { Count: > 0 } ? list[0] : default;
    }

    public async Task DeleteAsync(string table, string id)
    {
        var resp = await _http.DeleteAsync($"{table}?id=eq.{id}");
        await EnsureSuccess(resp);
    }

    private static async Task EnsureSuccess(HttpResponseMessage resp)
    {
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            throw new HttpRequestException($"Supabase error ({(int)resp.StatusCode}): {body}");
        }
    }
}
