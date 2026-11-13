require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const HTTP_PORT = process.env.PORT || process.env.HTTP_PORT || 3000;
const ENABLE_MQTT = process.env.ENABLE_MQTT !== "false";
const mqtt = ENABLE_MQTT ? require("mqtt") : null;

const HOST = "eu1.cloud.thethings.network";
const MQTT_PORT = 8883;

const APP_ID = "application-ruche-enib";
const TENANT = "ttn";
const USERNAME = `${APP_ID}@${TENANT}`;
const API_KEY = process.env.TTN_API_KEY;
const TTN_WEBHOOK_SECRET = process.env.TTN_WEBHOOK_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function getSupabaseJwtRole(value) {
  if (!value?.startsWith("eyJ")) return null;

  try {
    const payload = value.split(".")[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(decoded).role || null;
  } catch {
    return null;
  }
}

function isPublicSupabaseKey(value) {
  return value?.startsWith("sb_publishable_") || getSupabaseJwtRole(value) === "anon";
}

function formatSupabaseError(error) {
  if (!error) return "Unknown Supabase error";

  return JSON.stringify({
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
    status: error.status,
    name: error.name,
  });
}

if (ENABLE_MQTT && !API_KEY) {
  console.error("[ENV] Missing TTN_API_KEY in .env");
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.error("[ENV] Missing SUPABASE_URL in .env");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[ENV] Missing SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

if (isPublicSupabaseKey(SUPABASE_SERVICE_ROLE_KEY)) {
  console.error(
    "[ENV] SUPABASE_SERVICE_ROLE_KEY must be a backend secret/service-role key, not an anon or publishable key."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log("[SUPABASE] config loaded:", SUPABASE_URL);

supabase
  .from("locations")
  .select("id", { head: true, count: "exact" })
  .then(({ data, error, status, statusText }) => {
    if (error) {
      console.error("[SUPABASE] connection check error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        status,
        statusText,
        name: error.name
      });
      return;
    }

    console.log("[SUPABASE] connected", { status, statusText });
  })
  .catch((err) => {
    console.error("[SUPABASE] connection check exception:", err);
  });


    console.log("[SUPABASE] connected");
  });

const MQTT_TOPIC = `v3/${APP_ID}@${TENANT}/devices/+/up`;

const app = express();
const clients = new Set();
const ADMIN_ROLES = new Set(["admin", "dev"]);
const PROFILE_ROLES = new Set(["admin", "dev", "user"]);

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.get("origin");
  const isAllowedOrigin =
    !origin || FRONTEND_ORIGINS.includes("*") || FRONTEND_ORIGINS.includes(origin);

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin || FRONTEND_ORIGINS[0] || "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-TTN-Secret");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }

  if (req.method === "OPTIONS") {
    res.sendStatus(isAllowedOrigin ? 204 : 403);
    return;
  }

  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function normalizeProfileRole(role) {
  const value = String(role || "user").trim().toLowerCase();
  if (value === "apiculteur") return "user";
  return PROFILE_ROLES.has(value) ? value : null;
}

function formatAdminUser(profile, authUser = null) {
  return {
    id: profile.id,
    email: authUser?.email || profile.email || null,
    display_name: profile.display_name || authUser?.email || "",
    role: normalizeProfileRole(profile.role) || "user",
    is_active: profile.is_active !== false,
    created_at: profile.created_at || authUser?.created_at || null,
    last_sign_in_at: authUser?.last_sign_in_at || null,
  };
}

async function requireAdmin(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      res.status(401).json({ error: "Invalid bearer token" });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const role = normalizeProfileRole(profile?.role);
    if (!profile || profile.is_active === false || !ADMIN_ROLES.has(role)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    req.admin = { user, profile: { ...profile, role } };
    next();
  } catch (err) {
    console.error("[API] requireAdmin error:", err.message);
    res.status(500).json({ error: "Unable to verify admin access" });
  }
}

function getProfilePayload(body, { partial = false } = {}) {
  const payload = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, "display_name")) {
    const displayName =
      typeof body.display_name === "string" ? body.display_name.trim() : "";

    if (!displayName) {
      return { error: "display_name is required" };
    }

    payload.display_name = displayName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "role")) {
    const role = normalizeProfileRole(body.role);

    if (!role) {
      return { error: "role must be admin, dev, or user" };
    }

    payload.role = role;
  }

  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    if (typeof body.is_active !== "boolean") {
      return { error: "is_active must be a boolean" };
    }

    payload.is_active = body.is_active;
  } else if (!partial) {
    payload.is_active = true;
  }

  return { payload };
}

async function getActiveAdminCount() {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { head: true, count: "exact" })
    .eq("role", "admin")
    .eq("is_active", true);

  if (error) throw error;
  return count || 0;
}

async function ensureNotRemovingLastActiveAdmin(userId, nextProfile = {}) {
  const { data: currentProfile, error } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!currentProfile) {
    return { ok: true, profile: null };
  }

  const currentRole = normalizeProfileRole(currentProfile.role);
  const currentActive = currentProfile.is_active !== false;

  if (currentRole !== "admin" || !currentActive) {
    return { ok: true, profile: currentProfile };
  }

  const nextRole = Object.prototype.hasOwnProperty.call(nextProfile, "role")
    ? normalizeProfileRole(nextProfile.role)
    : currentRole;
  const nextActive = Object.prototype.hasOwnProperty.call(nextProfile, "is_active")
    ? nextProfile.is_active !== false
    : currentActive;

  if (nextRole === "admin" && nextActive) {
    return { ok: true, profile: currentProfile };
  }

  const activeAdminCount = await getActiveAdminCount();

  if (activeAdminCount <= 1) {
    return {
      ok: false,
      profile: currentProfile,
      error: "At least one active admin must remain",
    };
  }

  return { ok: true, profile: currentProfile };
}

app.get("/ttn-events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
  });
});

app.post("/api/ttn/uplink", async (req, res) => {
  const expectedSecret = TTN_WEBHOOK_SECRET && TTN_WEBHOOK_SECRET.trim();

  if (expectedSecret && req.get("x-ttn-secret") !== expectedSecret) {
    console.warn("[WEBHOOK] rejected");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.log("[WEBHOOK] received");

  try {
    const result = await processTtnUplink(req.body, "WEBHOOK");
    res.json({
      ok: true,
      saved: result.saved,
      duplicate: result.duplicate,
      device_id: result.device_id,
      received_at: result.received_at,
    });
  } catch (err) {
    console.error("[WEBHOOK] error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const [{ data: profiles, error: profilesError }, { data: authData, error: authError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, role, is_active")
          .order("display_name", { ascending: true }),
        supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);

    if (profilesError) throw profilesError;
    if (authError) throw authError;

    const authUsers = authData?.users || [];
    const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const authUsersById = new Map(authUsers.map((user) => [user.id, user]));
    const ids = new Set([...profilesById.keys(), ...authUsersById.keys()]);

    const users = [...ids]
      .map((id) => {
        const authUser = authUsersById.get(id) || null;
        const profile =
          profilesById.get(id) || {
            id,
            display_name: authUser?.email || "",
            role: "user",
            is_active: false,
          };

        return formatAdminUser(profile, authUser);
      })
      .sort((a, b) => {
        const nameCompare = a.display_name.localeCompare(b.display_name, "fr", {
          sensitivity: "base",
        });
        return nameCompare || (a.email || "").localeCompare(b.email || "");
      });

    res.json(users);
  } catch (err) {
    console.error("[API] GET /api/admin/users error:", err.message);
    res.status(500).json({ error: "Unable to load users" });
  }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    const password =
      typeof req.body.password === "string" ? req.body.password.trim() : "";

    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).json({ error: "password must be at least 6 characters" });
      return;
    }

    const { payload, error: payloadError } = getProfilePayload(req.body);
    if (payloadError) {
      res.status(400).json({ error: payloadError });
      return;
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) throw createError;

    const authUser = created?.user;
    if (!authUser?.id) {
      res.status(500).json({ error: "Unable to create auth user" });
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: authUser.id,
          display_name: payload.display_name,
          role: payload.role,
          is_active: true,
        },
        { onConflict: "id" }
      )
      .select("id, display_name, role, is_active")
      .single();

    if (profileError) throw profileError;

    res.status(201).json(formatAdminUser(profile, authUser));
  } catch (err) {
    console.error("[API] POST /api/admin/users error:", err.message);
    res.status(500).json({ error: "Unable to create user" });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { payload, error: payloadError } = getProfilePayload(req.body, {
      partial: true,
    });

    if (payloadError) {
      res.status(400).json({ error: payloadError });
      return;
    }

    if (!Object.keys(payload).length) {
      res.status(400).json({ error: "No profile fields to update" });
      return;
    }

    const adminSafety = await ensureNotRemovingLastActiveAdmin(req.params.id, payload);
    if (!adminSafety.ok) {
      res.status(409).json({ error: adminSafety.error });
      return;
    }

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", req.params.id)
      .select("id, display_name, role, is_active")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!profile) {
      res.status(404).json({ error: "User profile not found" });
      return;
    }

    const { data: authData } = await supabase.auth.admin.getUserById(req.params.id);

    res.json(formatAdminUser(profile, authData?.user || null));
  } catch (err) {
    console.error("[API] PATCH /api/admin/users/:id error:", err.message);
    res.status(500).json({ error: "Unable to update user" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const adminSafety = await ensureNotRemovingLastActiveAdmin(req.params.id, {
      is_active: false,
    });

    if (!adminSafety.ok) {
      res.status(409).json({ error: adminSafety.error });
      return;
    }

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ is_active: false })
      .eq("id", req.params.id)
      .select("id, display_name, role, is_active")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!profile) {
      res.status(404).json({ error: "User profile not found" });
      return;
    }

    const { data: authData } = await supabase.auth.admin.getUserById(req.params.id);

    res.json({ ok: true, user: formatAdminUser(profile, authData?.user || null) });
  } catch (err) {
    console.error("[API] DELETE /api/admin/users/:id error:", err.message);
    res.status(500).json({ error: "Unable to deactivate user" });
  }
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    client.write(msg);
  }
}

function formatParisTime(receivedAt) {
  const date = receivedAt ? new Date(receivedAt) : new Date();

  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Paris",
  });
}

function decodeLoRaFrame(buffer, receivedAt) {
  if (buffer.length < 12) {
    throw new Error(
      `Invalid payload length: expected at least 12 bytes, got ${buffer.length}`
    );
  }

  const date = receivedAt ? new Date(receivedAt) : new Date();

  return {
    lat: buffer.readFloatLE(0),
    lng: buffer.readFloatLE(4),
    poids: buffer.readFloatLE(8),
    time: formatParisTime(date),
    received_at: date.toISOString(),
  };
}

function isMissingRawPayloadColumn(error) {
  if (!error) return false;

  const text = `${error.code || ""} ${error.message || ""}`;
  return text.includes("raw_payload") && text.match(/column|schema|cache/i);
}

function isDuplicateMeasurementError(error) {
  if (!error) return false;

  const text = `${error.code || ""} ${error.message || ""} ${error.details || ""}`;
  return text.includes("23505") || /duplicate key|unique constraint/i.test(text);
}

async function getRucheByDeviceId(deviceId) {
  const { data, error } = await supabase
    .from("ruches")
    .select("id, location_id, name, device_id, created_at")
    .eq("device_id", deviceId)
    .maybeSingle();

  return { ruche: data, error };
}

async function getRucheWithLocationById(id) {
  const { data: ruche, error: rucheError } = await supabase
    .from("ruches")
    .select("id, location_id, name, device_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (rucheError || !ruche) {
    return { ruche, error: rucheError };
  }

  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("id, name, longitude, latitude, user_id, created_at")
    .eq("id", ruche.location_id)
    .maybeSingle();

  return {
    ruche: {
      ...ruche,
      location: location || null,
    },
    error: locationError,
  };
}

function parseCoordinate(value) {
  if (value === undefined || value === null || value === "") return null;

  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function isForeignKeyDeleteError(error) {
  if (!error) return false;

  const text = `${error.code || ""} ${error.message || ""} ${error.details || ""}`;
  return text.includes("23503") || /foreign key|violates.*constraint/i.test(text);
}

async function saveMeasurementToSupabase(deviceId, decoded, receivedAt, frmPayload) {
  if (!deviceId) {
    console.error("[SUPABASE] missing device_id");
    return { saved: false, duplicate: false, reason: "missing_device_id" };
  }

  const { ruche, error: rucheError } = await getRucheByDeviceId(deviceId);

  if (rucheError || !ruche) {
    if (rucheError) console.error("[SUPABASE] ruche error:", rucheError.message);
    console.error("[SUPABASE] ruche not found:", deviceId);
    return { saved: false, duplicate: false, reason: "ruche_not_found" };
  }

  const measurement = {
    ruche_id: ruche.id,
    poids: decoded.poids,
    longitude: decoded.lng,
    latitude: decoded.lat,
    received_at: decoded.received_at || receivedAt,
    raw_payload: frmPayload,
  };

  const { data: existingMeasurement, error: duplicateCheckError } = await supabase
    .from("measurements")
    .select("id")
    .eq("ruche_id", ruche.id)
    .eq("received_at", measurement.received_at)
    .limit(1)
    .maybeSingle();

  if (duplicateCheckError) {
    console.warn(
      "[SUPABASE] duplicate check error:",
      duplicateCheckError.message
    );
  }

  if (existingMeasurement) {
    console.log("[SUPABASE] duplicate measurement ignored:", deviceId, measurement.received_at);
    return { saved: false, duplicate: true, reason: "duplicate" };
  }

  let { error: insertError } = await supabase
    .from("measurements")
    .insert(measurement);

  if (isMissingRawPayloadColumn(insertError)) {
    const { raw_payload, ...measurementWithoutRawPayload } = measurement;
    const retry = await supabase
      .from("measurements")
      .insert(measurementWithoutRawPayload);

    insertError = retry.error;
  }

  if (isDuplicateMeasurementError(insertError)) {
    console.log("[SUPABASE] duplicate measurement ignored:", deviceId, measurement.received_at);
    return { saved: false, duplicate: true, reason: "duplicate" };
  }

  if (insertError) {
    console.error("[SUPABASE] insert error:", insertError.message);
    return { saved: false, duplicate: false, reason: "insert_error" };
  }

  console.log(
    `[SUPABASE] measurement saved for ${deviceId}: ${decoded.poids.toFixed(2)} kg`
  );
  return { saved: true, duplicate: false };
}

async function processTtnUplink(data, source) {
  const frmPayload = data?.uplink_message?.frm_payload;
  if (!frmPayload) {
    throw new Error("Missing uplink_message.frm_payload");
  }

  const deviceId = data?.end_device_ids?.device_id || null;
  if (!deviceId) {
    throw new Error("Missing end_device_ids.device_id");
  }

  const receivedAt =
    data?.received_at ||
    data?.uplink_message?.received_at ||
    new Date().toISOString();

  const buffer = Buffer.from(frmPayload, "base64");
  const decoded = decodeLoRaFrame(buffer, receivedAt);

  const saveResult = await saveMeasurementToSupabase(
    deviceId,
    decoded,
    receivedAt,
    frmPayload
  );

  const payloadForWeb = {
    device_id: deviceId,
    received_at: receivedAt,
    frm_payload: frmPayload,
    saved: saveResult.saved,
    duplicate: saveResult.duplicate,
    source,
    decoded,
  };

  console.log(`\n[TTN UPLINK:${source}]`, JSON.stringify(payloadForWeb, null, 2));

  if (saveResult.saved) {
    broadcast(payloadForWeb);
  }

  return payloadForWeb;
}

async function getRuchesWithLocations() {
  const { data: ruches, error: ruchesError } = await supabase
    .from("ruches")
    .select("id, location_id, name, device_id, created_at")
    .order("created_at", { ascending: true });

  if (ruchesError) throw ruchesError;

  const locationIds = [...new Set((ruches || []).map((r) => r.location_id).filter(Boolean))];
  if (!locationIds.length) return ruches || [];

  const { data: locations, error: locationsError } = await supabase
    .from("locations")
    .select("id, name, longitude, latitude, user_id, created_at")
    .in("id", locationIds);

  if (locationsError) throw locationsError;

  const locationsById = new Map((locations || []).map((location) => [location.id, location]));

  return (ruches || []).map((ruche) => ({
    ...ruche,
    location: locationsById.get(ruche.location_id) || null,
  }));
}

app.get("/api/locations", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("locations")
      .select("id, name, longitude, latitude, user_id, created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("[API] /api/locations error:", err.message);
    res.status(500).json({ error: "Unable to load locations" });
  }
});

app.get("/api/ruches", async (req, res) => {
  try {
    const ruches = await getRuchesWithLocations();
    res.json(ruches);
  } catch (err) {
    console.error("[API] /api/ruches error:", err.message);
    res.status(500).json({ error: "Unable to load ruches" });
  }
});

app.post("/api/ruches", async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const deviceId =
      typeof req.body.device_id === "string" ? req.body.device_id.trim() : "";
    let locationId =
      typeof req.body.location_id === "string" ? req.body.location_id.trim() : "";

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    if (!deviceId) {
      res.status(400).json({ error: "device_id is required" });
      return;
    }

    const existing = await getRucheByDeviceId(deviceId);
    if (existing.error) throw existing.error;

    if (existing.ruche) {
      res.status(409).json({ error: "device_id already exists" });
      return;
    }

    if (!locationId) {
      const latitude = parseCoordinate(req.body.latitude);
      const longitude = parseCoordinate(req.body.longitude);

      if (latitude === null || latitude < -90 || latitude > 90) {
        res.status(400).json({ error: "valid latitude or location_id is required" });
        return;
      }

      if (longitude === null || longitude < -180 || longitude > 180) {
        res.status(400).json({ error: "valid longitude or location_id is required" });
        return;
      }

      const { data: location, error: locationError } = await supabase
  .from("locations")
  .insert({
    name: req.body.location_name || name,
    latitude,
    longitude,
    user_id: null,
  })
  .select("id, name, longitude, latitude, user_id, created_at")
  .single();

      if (locationError) throw locationError;
      locationId = location.id;

      console.log(`[API] location created for ${deviceId}: ${locationId}`);
    }

    const { data: ruche, error: rucheError } = await supabase
      .from("ruches")
      .insert({
        location_id: locationId,
        name,
        device_id: deviceId,
      })
      .select("id, location_id, name, device_id, created_at")
      .single();

    if (rucheError) throw rucheError;

    const created = await getRucheWithLocationById(ruche.id);
    if (created.error) throw created.error;

    console.log(`[API] ruche created: ${deviceId} (${ruche.id})`);
    res.status(201).json(created.ruche);
  } catch (err) {
    console.error("[API] POST /api/ruches error:", err.message);
    res.status(500).json({ error: "Unable to create ruche" });
  }
});

app.patch("/api/ruches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const { data: ruche, error: updateError } = await supabase
      .from("ruches")
      .update({ name })
      .eq("id", id)
      .select("id, location_id, name, device_id, created_at")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!ruche) {
      res.status(404).json({ error: "Ruche not found" });
      return;
    }

    const updated = await getRucheWithLocationById(ruche.id);
    if (updated.error) throw updated.error;

    console.log(`[API] ruche renamed: ${id} -> ${name}`);
    res.json(updated.ruche);
  } catch (err) {
    console.error("[API] PATCH /api/ruches/:id error:", err.message);
    res.status(500).json({ error: "Unable to update ruche" });
  }
});

app.delete("/api/ruches/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { ruche, error: findError } = await getRucheWithLocationById(id);
    if (findError) throw findError;

    if (!ruche) {
      res.status(404).json({ error: "Ruche not found" });
      return;
    }

    let { error: deleteError } = await supabase
      .from("ruches")
      .delete()
      .eq("id", id);

    if (isForeignKeyDeleteError(deleteError)) {
      console.warn(`[API] ruche ${id} has protected related data; delete rejected`);
      res.status(409).json({
        error: "Ruche has protected measurements and cannot be deleted",
      });
      return;
    }

    if (deleteError) throw deleteError;

    console.log(`[API] ruche deleted: ${ruche.device_id} (${id})`);
    res.json({ ok: true, ruche });
  } catch (err) {
    console.error("[API] DELETE /api/ruches/:id error:", err.message);
    res.status(500).json({ error: "Unable to delete ruche" });
  }
});

app.get("/api/ruches/:deviceId/latest", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { ruche, error: rucheError } = await getRucheByDeviceId(deviceId);

    if (rucheError) throw rucheError;
    if (!ruche) {
      console.error("[SUPABASE] ruche not found for device:", deviceId);
      res.status(404).json({ error: "Ruche not found" });
      return;
    }

    const { data: measurement, error: measurementError } = await supabase
      .from("measurements")
      .select("id, ruche_id, poids, longitude, latitude, received_at, created_at")
      .eq("ruche_id", ruche.id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (measurementError) throw measurementError;

    res.json({ ruche, measurement: measurement || null });
  } catch (err) {
    console.error("[API] /api/ruches/:deviceId/latest error:", err.message);
    res.status(500).json({ error: "Unable to load latest measurement" });
  }
});

app.get("/api/ruches/:deviceId/measurements", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { ruche, error: rucheError } = await getRucheByDeviceId(deviceId);

    if (rucheError) throw rucheError;
    if (!ruche) {
      console.error("[SUPABASE] ruche not found for device:", deviceId);
      res.status(404).json({ error: "Ruche not found" });
      return;
    }

    const { data, error } = await supabase
      .from("measurements")
      .select("id, ruche_id, poids, longitude, latitude, received_at, created_at")
      .eq("ruche_id", ruche.id)
      .order("received_at", { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error("[API] /api/ruches/:deviceId/measurements error:", err.message);
    res.status(500).json({ error: "Unable to load measurements" });
  }
});

if (ENABLE_MQTT) {
  const mqttClient = mqtt.connect(`mqtts://${HOST}:${MQTT_PORT}`, {
    username: USERNAME,
    password: API_KEY.trim(),
    protocolVersion: 4,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
    rejectUnauthorized: true,
  });

  mqttClient.on("connect", () => {
    console.log("[MQTT] connected");

    mqttClient.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
      if (err) {
        console.error("[MQTT] subscribe error:", err.message);
        return;
      }

      console.log("[MQTT] subscribed:", MQTT_TOPIC);
    });
  });

  mqttClient.on("message", async (topic, message) => {
    try {
      const data = JSON.parse(message.toString("utf8"));

      if (!data?.uplink_message?.frm_payload) return;

      await processTtnUplink(data, "MQTT");
    } catch (err) {
      console.error("[MQTT] message error:", err.message);
    }
  });

  mqttClient.on("error", (err) => {
    console.error("[MQTT] error:", err.message);
  });

  mqttClient.on("reconnect", () => {
    console.warn("[MQTT] reconnecting...");
  });

  mqttClient.on("close", () => {
    console.warn("[MQTT] connection closed");
  });
} else {
  console.log("[MQTT] disabled by ENABLE_MQTT=false");
}

app.listen(HTTP_PORT, () => {
  console.log(`[WEB] open http://localhost:${HTTP_PORT}`);
});

//payload : 43AD4142A857C2BF48E10142
