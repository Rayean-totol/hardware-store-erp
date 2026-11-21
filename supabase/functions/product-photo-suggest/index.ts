// Supabase Edge Function: suggests product fields from a photo. Disabled unless AI_PHOTO_ENABLED=true.
// Secrets (set with `supabase secrets set`, never committed): GEMINI_API_KEY, ALLOWED_ORIGIN.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform. The caller's own login token is
// forwarded, so the database checks catalog.write and the monthly budget as that user.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import {
  PROVIDER,
  buildGeminiBody,
  checkPhotoRequest,
  monthlyCapSarMicro,
  parseGeminiText,
  validateSuggestion,
  worstCaseCostSarMicro,
  type OrgChoices,
} from './logic.ts';

const PROVIDER_TIMEOUT_MS = 20_000;

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'null',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'content-type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (Deno.env.get('AI_PHOTO_ENABLED') !== 'true') return json(503, { error: 'disabled' });

  const auth = req.headers.get('authorization');
  if (!auth) return json(401, { error: 'unauthenticated' });

  let body: { orgId?: unknown; mimeType?: unknown; imageBase64?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }
  const check = checkPhotoRequest(body);
  if (!check.ok) return json(400, { error: check.reason });
  const orgId = body.orgId as string;

  // Runs as the caller, so row policies apply to every read below.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Permission and monthly budget, checked and reserved in one database call.
  const reserve = await db.rpc('ai_photo_reserve', {
    p_org_id: orgId,
    p_cost_sar_micro: worstCaseCostSarMicro(),
    p_cap_sar_micro: monthlyCapSarMicro(),
  });
  if (reserve.error) {
    const forbidden = /forbidden/i.test(reserve.error.message);
    return json(forbidden ? 403 : 500, { error: forbidden ? 'forbidden' : 'unavailable' });
  }
  const reservation = reserve.data as { allowed: boolean; reason?: string } | null;
  if (!reservation?.allowed) return json(429, { error: reservation?.reason ?? 'budget_exhausted' });

  // 2. The org's own lists, so the model can only choose from what exists.
  const [cats, units] = await Promise.all([
    db.from('product_categories').select('id, name_en').eq('is_active', true),
    db.from('units').select('id, code'),
  ]);
  if (cats.error || units.error) return json(500, { error: 'unavailable' });
  const choices: OrgChoices = {
    categories: (cats.data ?? []).map((c: { id: string; name_en: string }) => ({ id: c.id, nameEn: c.name_en })),
    units: (units.data ?? []).map((u: { id: string; code: string }) => ({ id: u.id, code: u.code })),
  };

  // 3. The provider call. The key stays on the server.
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json(503, { error: 'not_configured' });
  let providerPayload: unknown;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDER.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(
          buildGeminiBody({
            imageBase64: body.imageBase64 as string,
            mimeType: body.mimeType as string,
            choices,
          }),
        ),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.warn(JSON.stringify({ event: 'provider_error', status: res.status, org: orgId }));
      return json(502, { error: 'unavailable' });
    }
    providerPayload = await res.json();
  } catch {
    console.warn(JSON.stringify({ event: 'provider_timeout_or_network', org: orgId }));
    return json(502, { error: 'unavailable' });
  }

  // 4. Validate against the schema. Anything unexpected is discarded.
  const parsed = parseGeminiText(providerPayload);
  const result = parsed === null ? { ok: false as const, reason: 'no_output' } : validateSuggestion(parsed, choices);
  console.warn(JSON.stringify({ event: 'suggest', org: orgId, ok: result.ok }));
  if (!result.ok) return json(422, { error: 'no_suggestion' });
  return json(200, { suggestion: result.value });
});
