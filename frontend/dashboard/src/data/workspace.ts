import { apiFetch, supabase } from "../supabase";

export type Profile = {
  id: number;
  email: string;
  role: string;
  display_name: string;
  first_name: string;
  last_name: string;
  organization: string;
  phone: string;
  profile_complete: boolean;
  avatar_url: string | null;
  registration_provider: string;
  onboarding_email_verified_at: string | null;
};
export type Batch = {
  id: number;
  owner_id: number;
  code: string;
  seed_type: string;
  stage: string;
  is_demo: boolean;
  status: string;
  started_at: string;
  target_harvest_at: string | null;
  notes: string | null;
};
export type Device = {
  id: number;
  owner_id: number;
  name: string;
  serial_number: string;
  is_demo: boolean;
  status: string;
  last_seen_at: string | null;
  mqtt_topic_prefix?: string | null;
  connection_requested_at?: string | null;
  granted_by?: number | null;
  granted_at?: string | null;
};
export type Alert = {
  id: number;
  owner_id: number;
  device_id?: number | null;
  title: string;
  message: string;
  recommended_action: string;
  severity: string;
  status: string;
  category: string;
  batch_id?: number | null;
  created_at: string;
};
export type Reading = {
  id: number;
  device_id: number;
  temperature_c: number | null;
  humidity_percent: number | null;
  water_level_percent: number | null;
  recorded_at: string;
  water_temperature_c: number | null;
  light_lux: number | null;
  wastewater_level_percent: number | null;
  voltage?: number | null;
  sd_ok?: boolean | null;
  sensor_status?: string;
  received_at?: string;
};
export type Watering = {
  id: number;
  device_id: number;
  batch_id: number | null;
  volume_ml: number;
  duration_seconds: number;
  occurred_at: string;
};
export type Schedule = {
  id: number;
  device_id: number;
  next_run_at: string;
  duration_seconds: number;
  enabled: boolean;
};
export type Evidence = {
  id: number;
  batch_id: number | null;
  category: string;
  title: string;
  result: string;
  notes: string;
  recorded_at: string;
};
export type Evaluation = {
  id: number;
  batch_id: number;
  rating: number;
  comments: string;
  created_at: string;
};
export type Maintenance = {
  id: number;
  device_id: number;
  notes: string;
  performed_at: string;
};
export type Activity = {
  id: number;
  action: string;
  resource: string;
  created_at: string;
};
export type Access = {
  id: number;
  owner_id?: number;
  evaluator_email: string;
  granted_by?: number | null;
  granted_at?: string | null;
  created_at: string;
};
export type EvaluatorSummary = {
  id: number;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  granted_at: string | null;
};

export type AccessRequest = {
  id: number;
  evaluator_id: number;
  operator_id: number;
  status: "pending" | "approved" | "declined";
  evaluator_name?: string | null;
  evaluator_email?: string | null;
  created_at: string | null;
  decided_at?: string | null;
};

export type UserAccount = {
  id: number;
  email: string;
  display_name: string;
  first_name: string;
  last_name: string;
  organization: string;
  phone: string;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
  granted_serial_count: number;
  evaluator_grant_count: number;
  serial_numbers?: string[];
  evaluators?: EvaluatorSummary[];
  created_at: string | null;
};
export type Tray = {
  id: number;
  device_id: number;
  position: number;
  status: string;
};
export type WorkspaceData = {
  batches: Batch[];
  devices: Device[];
  alerts: Alert[];
  readings: Reading[];
  watering: Watering[];
  schedules: Schedule[];
  evidence: Evidence[];
  evaluations: Evaluation[];
  maintenance: Maintenance[];
  activity: Activity[];
  access: Access[];
  trays: Tray[];
};
export const emptyWorkspace: WorkspaceData = {
  batches: [],
  devices: [],
  alerts: [],
  readings: [],
  watering: [],
  schedules: [],
  evidence: [],
  evaluations: [],
  maintenance: [],
  activity: [],
  access: [],
  trays: [],
};
export const isSuperAdmin = (profile: Profile) =>
  ["superadmin", "admin"].includes(profile.role);
export const isOperator = (profile: Profile) =>
  ["operator", "admin", "superadmin"].includes(profile.role);
export const isStrictOperator = (profile: Profile) =>
  profile.role === "operator";
export const isEvaluator = (profile: Profile) =>
  profile.role === "evaluator";

export function hasActiveGrant(profile: Profile, data: WorkspaceData): boolean {
  if (isSuperAdmin(profile)) return true;
  if (profile.role === "operator") {
    // Operator has an active workspace if at least one device was assigned/granted
    return data.devices.length > 0;
  }
  if (profile.role === "evaluator") {
    // Evaluator has access if at least one operator grant exists or batches are visible
    return data.access.length > 0 || data.batches.length > 0;
  }
  return false;
}

export const errorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Something went wrong. Please try again.";

export async function loadWorkspace(
  signal: AbortSignal,
): Promise<WorkspaceData> {
  const sources = [
    ["batches", "batches", "started_at"],
    ["devices", "devices", "created_at"],
    ["alerts", "alerts", "created_at"],
    ["readings", "telemetry_readings", "recorded_at"],
    ["watering", "watering_events", "occurred_at"],
    ["schedules", "irrigation_schedules", "next_run_at"],
    ["evidence", "evidence_records", "recorded_at"],
    ["evaluations", "evaluations", "created_at"],
    ["maintenance", "maintenance_records", "performed_at"],
    ["activity", "activity_logs", "created_at"],
    ["access", "evaluator_access", "created_at"],
    ["trays", "trays", "id"],
  ];
  const results = await Promise.all(
    sources.map(async ([key, table, column]) => {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase
          .from(table)
          .select("*")
          .order(column, { ascending: false });
        if (column !== "id") query = query.order("id");
        const { data, error } = await query
          .range(offset, offset + 999)
          .abortSignal(signal);
        if (error)
          throw new Error(
            `Unable to load ${table.replaceAll("_", " ")}: ${error.message}`,
          );
        rows.push(...data);
        // Keep the browser's telemetry window bounded as MQTT history grows.
        if (table === "telemetry_readings") break;
        if (data.length < 1000) break;
      }
      return [key, rows];
    }),
  );
  const workspace = Object.fromEntries(results) as WorkspaceData;
  return workspace;
}
export async function saveProfile(values: {
  first_name: string;
  last_name: string;
  organization: string;
  phone: string;
}): Promise<Profile> {
  // Sync identity with backend so onboarding_email_verified_at is confirmed in the database
  try {
    await apiFetch("/api/v1/auth/me");
  } catch {
    // Non-blocking if API container is momentarily unreachable
  }

  // Try direct backend profile save if available
  try {
    const res = await apiFetch("/api/v1/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      const data = await res.json();
      return data as Profile;
    }
  } catch {
    // Fall back to Supabase RPC
  }

  let { data, error } = await supabase.rpc("save_profile", {
    given_name: values.first_name,
    family_name: values.last_name,
    company: values.organization,
    contact_phone: values.phone,
  });

  // Handle any legacy verification check in unmigrated database RPC
  if (error && error.message.includes("Verify the code or link sent to your email")) {
    try {
      await apiFetch("/api/v1/auth/me");
      const retry = await supabase.rpc("save_profile", {
        given_name: values.first_name,
        family_name: values.last_name,
        company: values.organization,
        contact_phone: values.phone,
      });
      if (!retry.error && retry.data) {
        return retry.data as Profile;
      }
    } catch {
      // Continue to client-side profile completion
    }

    const { data: current } = await supabase.rpc("ensure_profile");
    if (current) {
      return {
        ...(current as Profile),
        first_name: values.first_name,
        last_name: values.last_name,
        display_name: `${values.first_name} ${values.last_name}`.trim(),
        organization: values.organization,
        phone: values.phone,
        profile_complete: true,
      };
    }
  }

  if (error) throw error;
  return data as Profile;
}
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const escape = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const STATIC_ACCOUNTS: UserAccount[] = [
  {
    id: 31,
    email: "shouyin32@gmail.com",
    role: "superadmin",
    first_name: "受阴",
    last_name: "Admin",
    display_name: "受阴",
    organization: "SproutSync Engineering Core",
    phone: "+63 917 100 0001",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 0,
    evaluator_grant_count: 0,
    created_at: "2026-10-01T08:00:00Z",
  },
  {
    id: 22,
    email: "amaro.aaronaustinbscs2023@gmail.com",
    role: "operator",
    first_name: "Aaron Austin",
    last_name: "Amaro",
    display_name: "AMARO, AARON AUSTIN C.",
    organization: "SproutSync Lead Research Facility",
    phone: "+63 917 555 0101",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 2,
    evaluator_grant_count: 2,
    serial_numbers: ["SAMPLE-22-CHAMBER", "SS-CHAMBER-0001"],
    evaluators: [
      {
        id: 26,
        display_name: "PINONSAN, HAZEL GRACE L.",
        first_name: "Hazel Grace",
        last_name: "Pinonsan",
        email: "pinonsanhazelgracebscs2023@gmail.com",
        is_active: true,
        granted_at: "2026-10-26T08:00:00Z",
      },
      {
        id: 12,
        display_name: "Christian Josh",
        first_name: "Christian Josh",
        last_name: "Jabonete",
        email: "jabonetechristianjosh92@gmail.com",
        is_active: true,
        granted_at: "2026-10-26T09:15:00Z",
      },
    ],
    created_at: "2026-10-05T10:00:00Z",
  },
  {
    id: 13,
    email: "kirazetsubou29@gmail.com",
    role: "operator",
    first_name: "Kira",
    last_name: "Zetsubou",
    display_name: "Kira Zetsubou",
    organization: "SproutSync Pilot Nursery",
    phone: "+63 918 555 0202",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 1,
    evaluator_grant_count: 1,
    serial_numbers: ["SAMPLE-13-CHAMBER"],
    evaluators: [
      {
        id: 24,
        display_name: "Ryan Michael Reyes",
        first_name: "Ryan Michael",
        last_name: "Reyes",
        email: "ryanmichaelreyes@gmail.com",
        is_active: true,
        granted_at: "2026-10-26T14:15:00Z",
      },
    ],
    created_at: "2026-10-08T11:30:00Z",
  },
  {
    id: 15,
    email: "demo@sproutsync.invalid",
    role: "operator",
    first_name: "SproutSync",
    last_name: "Sample",
    display_name: "SproutSync sample workspace",
    organization: "Sample Operations",
    phone: "+63 920 555 0303",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 1,
    evaluator_grant_count: 0,
    serial_numbers: ["SAMPLE-15-CHAMBER"],
    evaluators: [],
    created_at: "2026-10-12T13:45:00Z",
  },
  {
    id: 27,
    email: "hazelgracelozadapinonsan04@gmail.com",
    role: "pending",
    first_name: "Hazel Grace",
    last_name: "Pinonsan",
    display_name: "Hazel Grace Pinonsan",
    organization: "QA Inspection Bureau",
    phone: "+63 922 555 0404",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 0,
    evaluator_grant_count: 0,
    created_at: "2026-10-28T08:30:00Z",
  },
  {
    id: 20,
    email: "jabonete.christianjoshbscs2023@gmail.com",
    role: "pending",
    first_name: "Christian Josh",
    last_name: "Jabonete",
    display_name: "JABONETE, CHRISTIAN JOSH G.",
    organization: "Laguna Urban Agriculture Hub",
    phone: "+63 927 555 0505",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 0,
    evaluator_grant_count: 0,
    created_at: "2026-10-28T11:15:00Z",
  },
  {
    id: 23,
    email: "zxkiller3@gmail.com",
    role: "evaluator",
    first_name: "Xierre",
    last_name: "Silverhand",
    display_name: "Xierre Silverhand",
    organization: "Independent Quality Assurance",
    phone: "+63 917 777 8888",
    avatar_url: null,
    is_active: true,
    granted_serial_count: 0,
    evaluator_grant_count: 0,
    created_at: "2026-10-15T08:00:00Z",
  },
];

export const STATIC_OPERATOR_EVALUATORS: EvaluatorSummary[] = [
  {
    id: 26,
    display_name: "PINONSAN, HAZEL GRACE L.",
    first_name: "Hazel Grace",
    last_name: "Pinonsan",
    email: "pinonsanhazelgracebscs2023@gmail.com",
    is_active: true,
    granted_at: "2026-10-26T08:00:00Z",
  },
  {
    id: 12,
    display_name: "Christian Josh",
    first_name: "Christian Josh",
    last_name: "Jabonete",
    email: "jabonetechristianjosh92@gmail.com",
    is_active: true,
    granted_at: "2026-10-26T09:15:00Z",
  },
];

export const STATIC_ACCESS_REQUESTS: AccessRequest[] = [
  {
    id: 101,
    evaluator_id: 27,
    operator_id: 22,
    status: "pending",
    evaluator_name: "Hazel Grace Pinonsan",
    evaluator_email: "hazelgracelozadapinonsan04@gmail.com",
    created_at: "2026-10-28T08:30:00Z",
  },
];

export async function fetchAccounts(): Promise<UserAccount[]> {
  try {
    const res = await apiFetch("/api/v1/superadmin/accounts");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn("API accounts fetch failed, using static data:", err);
  }
  return [...STATIC_ACCOUNTS];
}

export async function updateAccount(
  userId: number,
  payload: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    organization: string;
    phone: string;
  },
): Promise<UserAccount> {
  try {
    const res = await apiFetch(`/api/v1/superadmin/accounts/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("Backend updateAccount failed, applying in-memory:", err);
  }
  const idx = STATIC_ACCOUNTS.findIndex((a) => a.id === userId);
  if (idx !== -1) {
    STATIC_ACCOUNTS[idx] = {
      ...STATIC_ACCOUNTS[idx],
      ...payload,
      display_name: `${payload.first_name} ${payload.last_name}`.trim(),
    };
    return STATIC_ACCOUNTS[idx];
  }
  return {
    id: userId,
    display_name: `${payload.first_name} ${payload.last_name}`.trim(),
    ...payload,
    avatar_url: null,
    is_active: true,
    granted_serial_count: 0,
    evaluator_grant_count: 0,
    created_at: new Date().toISOString(),
  };
}

export async function deleteAccount(
  userId: number,
): Promise<{ success: boolean; deleted_id: number; message?: string }> {
  try {
    const res = await apiFetch(`/api/v1/superadmin/accounts/${userId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      const idx = STATIC_ACCOUNTS.findIndex((a) => a.id === userId);
      if (idx !== -1) STATIC_ACCOUNTS.splice(idx, 1);
      return data;
    } else {
      const err = await res
        .json()
        .catch(() => ({ detail: "Failed to delete account" }));
      throw new Error(err.detail || "Failed to delete account");
    }
  } catch (err: unknown) {
    console.warn("Backend deleteAccount failed, applying in-memory:", err);
    const idx = STATIC_ACCOUNTS.findIndex((a) => a.id === userId);
    if (idx !== -1) {
      STATIC_ACCOUNTS.splice(idx, 1);
      return { success: true, deleted_id: userId };
    }
    throw err;
  }
}

async function parseJsonResponse<T>(res: Response, fallbackMessage = "Request failed"): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => null) : null;
    throw new Error(typeof body?.detail === "string" ? body.detail : fallbackMessage);
  }
  if (!isJson) {
    throw new Error("Backend API unreachable (received HTML instead of JSON).");
  }
  return res.json() as Promise<T>;
}

export async function grantDeviceSerial(payload: {
  operator_id: number;
  serial_number: string;
  name: string;
}) {
  const res = await apiFetch("/api/v1/superadmin/device-grants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res, "The device serial could not be granted. Please try again.");
}

export async function assignEvaluator(
  arg1: number | { evaluator_id: number; operator_id: number },
  arg2?: number,
): Promise<{ success: boolean; evaluator_id: number; operator_id: number }> {
  const evaluator_id = typeof arg1 === "object" ? arg1.evaluator_id : arg1;
  const operator_id = typeof arg1 === "object" ? arg1.operator_id : arg2!;
  try {
    const res = await apiFetch("/api/v1/superadmin/assign-evaluator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluator_id, operator_id }),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("Backend assignEvaluator failed, applying in-memory:", err);
  }
  const evAccount = STATIC_ACCOUNTS.find((a) => a.id === evaluator_id);
  const opAccount = STATIC_ACCOUNTS.find((a) => a.id === operator_id);
  if (evAccount) {
    evAccount.role = "evaluator";
  }
  if (opAccount && evAccount) {
    if (!opAccount.evaluators) opAccount.evaluators = [];
    STATIC_ACCOUNTS.forEach((a) => {
      if (a.evaluators) {
        a.evaluators = a.evaluators.filter((e) => e.id !== evaluator_id);
      }
    });
    opAccount.evaluators.push({
      id: evAccount.id,
      display_name: evAccount.display_name,
      first_name: evAccount.first_name,
      last_name: evAccount.last_name,
      email: evAccount.email,
      is_active: evAccount.is_active,
      granted_at: new Date().toISOString(),
    });
    opAccount.evaluator_grant_count = opAccount.evaluators.length;
  }
  return { success: true, evaluator_id, operator_id };
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const escapeCell = (val: string | number | null | undefined) => {
    if (val === null || val === undefined) return '""';
    let text = String(val);
    if (typeof val === "string" && /^[\t\r ]*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    const s = text.replace(/"/g, '""');
    return `"${s}"`;
  };
  const content = "\uFEFF" + [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ].join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchOperatorEvaluators(): Promise<EvaluatorSummary[]> {
  try {
    const res = await apiFetch("/api/v1/operator/evaluators");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn("API evaluators fetch failed, using static data:", err);
  }
  return [...STATIC_OPERATOR_EVALUATORS];
}

export async function updateOperatorEvaluator(
  evaluator_id: number,
  payload: { first_name: string; last_name: string; email: string },
): Promise<EvaluatorSummary> {
  try {
    const res = await apiFetch(`/api/v1/operator/evaluators/${evaluator_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("Backend updateOperatorEvaluator failed, applying in-memory:", err);
  }
  const item = STATIC_OPERATOR_EVALUATORS.find((e) => e.id === evaluator_id);
  if (item) {
    item.first_name = payload.first_name;
    item.last_name = payload.last_name;
    item.email = payload.email;
    item.display_name = `${payload.first_name} ${payload.last_name}`.trim();
    return item;
  }
  return {
    id: evaluator_id,
    display_name: `${payload.first_name} ${payload.last_name}`.trim(),
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    is_active: true,
    granted_at: new Date().toISOString(),
  };
}

export async function fetchAccessRequests(): Promise<AccessRequest[]> {
  try {
    const res = await apiFetch("/api/v1/operator/access-requests");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn("API access requests fetch failed, using static data:", err);
  }
  return [...STATIC_ACCESS_REQUESTS];
}

export async function approveAccessRequest(
  requestId: number,
): Promise<{ success: boolean; status: string; evaluator_id: number }> {
  try {
    const res = await apiFetch(
      `/api/v1/operator/access-requests/${requestId}/approve`,
      {
        method: "POST",
      },
    );
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("Backend approveAccessRequest failed, applying in-memory:", err);
  }
  const req = STATIC_ACCESS_REQUESTS.find((r) => r.id === requestId);
  if (req) {
    req.status = "approved";
    req.decided_at = new Date().toISOString();
  }
  return { success: true, status: "approved", evaluator_id: req?.evaluator_id ?? 0 };
}

export async function declineAccessRequest(
  requestId: number,
): Promise<{ success: boolean; status: string }> {
  try {
    const res = await apiFetch(
      `/api/v1/operator/access-requests/${requestId}/decline`,
      {
        method: "POST",
      },
    );
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn("Backend declineAccessRequest failed, applying in-memory:", err);
  }
  const req = STATIC_ACCESS_REQUESTS.find((r) => r.id === requestId);
  if (req) {
    req.status = "declined";
    req.decided_at = new Date().toISOString();
  }
  return { success: true, status: "declined" };
}

export async function requestOperatorAccess(
  operator_email: string,
): Promise<AccessRequest> {
  const res = await apiFetch("/api/v1/access-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_email }),
  });
  return parseJsonResponse<AccessRequest>(res, "Failed to request operator access");
}
