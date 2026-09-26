import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });

const cleanText = (value: unknown, max: number) =>
  String(value ?? "").trim().slice(0, max);

const safeRoute = (value: unknown) => {
  const route = cleanText(value, 220).replace(/^#/, "");
  if (!route) return "home";
  if (/^(home|movies|series|library|search)$/.test(route)) return route;
  if (/^details\/[a-z0-9-]{1,150}$/.test(route)) return route;
  if (/^watch\/movie\/[a-z0-9-]{1,150}$/.test(route)) return route;
  if (/^watch\/series\/[a-z0-9-]{1,150}\/\d{1,4}\/\d{1,5}$/.test(route)) return route;
  return "home";
};

const safeHttpsUrl = (value: unknown) => {
  const text = cleanText(value, 1200);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const oneSignalKey = Deno.env.get("ONESIGNAL_API_KEY") ?? "";
  const oneSignalAppId =
    Deno.env.get("ONESIGNAL_APP_ID") ?? "86e154b0-957b-41e9-a07b-9f5ed651cb01";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_configuration_error" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  const { data: membership, error: membershipError } = await admin
    .from("admin_memberships")
    .select("role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    membershipError ||
    !membership ||
    membership.active !== true ||
    !["owner", "admin"].includes(String(membership.role))
  ) {
    return json({ error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const title = cleanText(body.title, 120);
  const message = cleanText(body.message, 600);
  const audienceType = body.audienceType === "user" ? "user" : "all";
  const targetUserId = cleanText(body.targetUserId, 80);
  const imageUrl = safeHttpsUrl(body.imageUrl);
  const route = safeRoute(body.route);
  const contentId = cleanText(body.contentId, 150).toLowerCase();
  const contentKind = body.contentKind === "series"
    ? "series"
    : body.contentKind === "movie"
    ? "movie"
    : "";
  const season = Number.isInteger(Number(body.season)) && Number(body.season) >= 0
    ? Number(body.season)
    : null;
  const episode = Number.isInteger(Number(body.episode)) && Number(body.episode) >= 0
    ? Number(body.episode)
    : null;

  if (!title || !message) {
    return json({ error: "title_and_message_required" }, 400);
  }
  if (audienceType === "user" && !/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return json({ error: "valid_target_user_required" }, 400);
  }
  if (!oneSignalKey) {
    return json({
      error: "onesignal_not_configured",
      message: "ONESIGNAL_API_KEY is missing from Edge Function secrets.",
    }, 503);
  }

  const additionalData = {
    route,
    content_id: contentId,
    content_kind: contentKind,
    season,
    episode,
    source: "cinaro_admin",
  };

  const oneSignalPayload: Record<string, unknown> = {
    app_id: oneSignalAppId,
    target_channel: "push",
    name: `CINARO: ${title}`.slice(0, 128),
    headings: { ar: title, en: title },
    contents: { ar: message, en: message },
    data: additionalData,
    idempotency_key: crypto.randomUUID(),
    ttl: 259200,
    priority: 10,
  };

  if (imageUrl) {
    oneSignalPayload.big_picture = imageUrl;
  }

  if (audienceType === "user") {
    oneSignalPayload.include_aliases = { external_id: [targetUserId] };
  } else {
    // OneSignal's current default push segment is "Active Subscriptions".
    // "Subscribed Users" is not a valid segment in this app and caused
    // broadcast sends to be rejected while direct alias sends still worked.
    oneSignalPayload.included_segments = ["Active Subscriptions"];
  }

  let oneSignalResponse: Response;
  let oneSignalResult: Record<string, unknown> = {};
  try {
    oneSignalResponse = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: `Key ${oneSignalKey}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(oneSignalPayload),
    });
    const parsed = await oneSignalResponse.json().catch(() => ({}));
    oneSignalResult = parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    await admin.from("notification_logs").insert({
      title,
      message,
      image_url: imageUrl,
      audience_type: audienceType,
      target_user_id: audienceType === "user" ? targetUserId : null,
      route,
      content_id: contentId,
      content_kind: contentKind,
      season,
      episode,
      status: "failed",
      error_message: cleanText(error instanceof Error ? error.message : error, 500),
      actor_uid: user.id,
    });
    return json({ error: "onesignal_network_error" }, 502);
  }

  const notificationId = cleanText(oneSignalResult.id, 160);
  const recipients = Math.max(0, Number(oneSignalResult.recipients) || 0);
  const apiError = Array.isArray(oneSignalResult.errors)
    ? oneSignalResult.errors.map((entry) => String(entry)).join(" · ")
    : oneSignalResult.errors && typeof oneSignalResult.errors === "object"
    ? cleanText(JSON.stringify(oneSignalResult.errors), 500)
    : cleanText(oneSignalResult.errors, 500);

  await admin.from("notification_logs").insert({
    title,
    message,
    image_url: imageUrl,
    audience_type: audienceType,
    target_user_id: audienceType === "user" ? targetUserId : null,
    route,
    content_id: contentId,
    content_kind: contentKind,
    season,
    episode,
    status: oneSignalResponse.ok ? "sent" : "failed",
    onesignal_message_id: notificationId,
    recipients,
    error_message: oneSignalResponse.ok ? "" : apiError || `HTTP ${oneSignalResponse.status}`,
    actor_uid: user.id,
  });

  if (!oneSignalResponse.ok) {
    return json({
      error: "onesignal_rejected",
      status: oneSignalResponse.status,
      details: oneSignalResult,
    }, 502);
  }

  return json({
    ok: true,
    notificationId,
    recipients,
    audienceType,
    warning: recipients === 0 ? "no_active_subscriptions" : "",
  });
});
