import { test, expect, type Page } from "@playwright/test";
import { loadEnv } from "vite";
import { readFile } from "node:fs/promises";
const env = loadEnv("test", "../..", "VITE_");
const authHost = new URL(env.VITE_SUPABASE_URL).hostname;
const key = `sb-${authHost.split(".")[0]}-auth-token`;
const uid = "00000000-0000-4000-a000-000000000001";
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "test@example.invalid",
  email_confirmed_at: "2026-10-26T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-10-26T00:00:00Z",
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: uid, role: "authenticated", exp: 4102444800 })).toString("base64url")}.test`;
const session = {
  access_token: token,
  refresh_token: "test-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user,
};
async function mock(
  page: Page,
  role = "operator",
  signedIn = true,
  googleNew = false,
) {
  let profile = {
    id: 1,
    email: user.email,
    role,
    display_name: "Test Grower",
    first_name: "Test",
    last_name: "Grower",
    organization: "",
    phone: "",
    avatar_url: null,
    profile_complete: signedIn && !googleNew,
    registration_provider: googleNew ? "google" : "email",
    onboarding_email_verified_at: googleNew ? null : "2026-10-26T00:00:00Z",
  };
  const batches: Record<string, unknown>[] = [
    {
      id: 1,
      owner_id: 1,
      code: "MB-001",
      seed_type: "Mung beans",
      stage: "growing",
      status: "active",
      started_at: "2026-10-26T00:00:00Z",
      target_harvest_at: null,
      notes: "Verified record",
    },
  ];
  if (signedIn)
    await page.addInitScript(
      ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
      { key, session },
    );
  await page.route(`https://${authHost}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname;
    let body: unknown = [];
    if (path.endsWith("/signup"))
      body = { user: { ...user, identities: [{ id: uid }] }, session: null };
    else if (path.endsWith("/verify") || path.endsWith("/token")) {
      if (googleNew && request.postDataJSON()?.type === "email")
        profile.onboarding_email_verified_at = "2026-10-26T00:00:00Z";
      body = session;
    } else if (path.endsWith("/user")) body = user;
    else if (path.endsWith("/ensure_profile")) body = profile;
    else if (path.endsWith("/save_profile")) {
      const v = request.postDataJSON();
      profile = {
        ...profile,
        first_name: v.given_name,
        last_name: v.family_name,
        display_name: `${v.given_name} ${v.family_name}`,
        profile_complete: true,
      };
      body = profile;
    } else if (path.endsWith("/notification_preferences")) body = null;
    else if (path.endsWith("/devices") && role === "operator") {
      // An operator needs a device grant before the operational workspace opens.
      body = [{ id: 1, owner_id: 1, name: "Test chamber", serial_number: "TEST-001", status: "offline", last_seen_at: null, created_at: "2026-10-26T00:00:00Z" }];
    } else if (path.endsWith("/batches")) {
      if (request.method() === "POST") {
        const next = {
          id: 2,
          ...request.postDataJSON(),
          stage: "soaking",
          status: "active",
        };
        batches.unshift(next);
        body = next;
      } else body = batches;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/v1/devices/discover", (route) => route.fulfill({ json: { devices: [] } }));
}

const nearbyIdentity = {
  protocol: "sproutsync-discovery-v1", model: "ESP32", serial_number: "ESP32-A1B2C3",
  name: "SproutSync bench ESP32", topic_prefix: "sproutsync/ESP32-A1B2C3",
};

async function mockFirstDevice(page: Page) {
  await mock(page);
  const devices: Record<string, unknown>[] = [];
  await page.route(`https://${authHost}/rest/v1/devices*`, (route) => route.fulfill({ json: devices }));
  await page.route("**/api/v1/devices/live*", (route) => route.fulfill({ json: {
    devices, readings: [], mqtt: { state: "connected", connected: true, broker_url: "wss://broker.hivemq.com:8884/mqtt", stale_seconds: 30 },
  } }));
  return devices;
}

test("first device is discovered over Wi-Fi and registered without an administrator grant", async ({ page }) => {
  const devices = await mockFirstDevice(page);
  await page.route("**/api/v1/devices/discover", (route) => route.fulfill({ json: { devices: [{
    ...nearbyIdentity, transport: "wifi", discovery_id: "local-scan-token", addresses: ["192.168.1.42"], available: true,
  }] } }));
  await page.route("**/api/v1/devices/nearby", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ transport: "wifi", discovery_id: "local-scan-token", name: "My ESP32" });
    const device = { id: 3, owner_id: 1, serial_number: nearbyIdentity.serial_number, name: "My ESP32", is_demo: false,
      mqtt_topic_prefix: nearbyIdentity.topic_prefix, connection_requested_at: new Date().toISOString(), last_seen_at: null, status: "pending" };
    devices.push(device);
    await route.fulfill({ status: 202, json: device });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operator");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add device", exact: true });
  await expect(dialog.getByText("192.168.1.42", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Use device: SproutSync bench ESP32", exact: true }).click();
  await expect(dialog.getByLabel("Device serial number")).toHaveValue(nearbyIdentity.serial_number);
  await expect(dialog.getByLabel("MQTT topic prefix")).not.toBeEditable();
  await dialog.getByLabel("Device name").fill("My ESP32");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/discovery-mobile.png", fullPage: true });
  await dialog.getByRole("button", { name: "Connect device", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Waiting for a fresh sensor packet");
  await expect(dialog.getByRole("status")).not.toContainText("Device detected");
  await dialog.getByRole("button", { name: "Keep listening in background" }).click();
  await expect(page.getByLabel("Select device")).toContainText("My ESP32");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Explore SproutSync" }).getByRole("button", { name: "Chamber & Access", exact: true })).toBeVisible();
});

test("Bluetooth reads the SproutSync identity before allowing registration", async ({ page }) => {
  await mockFirstDevice(page);
  await page.addInitScript((identity) => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {
      requestDevice: async (options: { filters: { services: string[] }[] }) => {
        if (options.filters[0].services[0] !== "f7b20001-11f9-4c7c-9f23-74c367499f20") throw new Error("Wrong service filter");
        return { gatt: { disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => ({
          readValue: async () => new DataView(new TextEncoder().encode(JSON.stringify(identity)).buffer),
        }) }) }) } };
      },
    } });
  }, nearbyIdentity);
  await page.route("**/api/v1/devices/nearby", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ transport: "bluetooth", identity: nearbyIdentity });
    return route.fulfill({ status: 409, json: { detail: "This device is already registered to another workspace." } });
  });
  await page.goto("/operator");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add device", exact: true });
  await dialog.getByRole("button", { name: "Search Bluetooth", exact: true }).click();
  await expect(dialog.getByLabel("Device serial number")).toHaveValue(nearbyIdentity.serial_number);
  await dialog.getByRole("button", { name: "Connect device", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("another workspace");
  await expect(dialog.getByRole("status")).toHaveCount(0);
});

test("empty Wi-Fi results, Bluetooth cancellation, and invalid identities offer recovery", async ({ page }) => {
  await mockFirstDevice(page);
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {
      requestDevice: async () => {
        if (++calls === 1) throw new DOMException("Cancelled", "NotFoundError");
        return { gatt: { disconnect() {}, connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => ({
          readValue: async () => new DataView(new TextEncoder().encode('{"protocol":"unrelated"}').buffer),
        }) }) }) } };
      },
    } });
  });
  await page.goto("/operator");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add device", exact: true });
  await expect(dialog.getByText("No nearby ESP32 found yet.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Search Bluetooth", exact: true }).click();
  await expect(dialog.getByText("No Bluetooth device was selected.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Search Bluetooth", exact: true }).click();
  await expect(dialog.getByText("The selected device has an invalid SproutSync identity.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connect device", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/devices/discover", (route) => route.fulfill({ status: 503, json: { detail: "Allow local network/multicast access for the API, then search again." } }));
  await dialog.getByRole("button", { name: "Search Wi-Fi", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("multicast");
});

test("unsupported Bluetooth gives guidance while keeping Wi-Fi search available", async ({ page }) => {
  await mockFirstDevice(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined }));
  await page.goto("/operator");
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add device", exact: true });
  await expect(dialog.getByRole("button", { name: "Search Bluetooth", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Bluetooth search needs a supported Chrome/Edge browser", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Search Wi-Fi", exact: true })).toBeEnabled();
});
test("signup collects profile details and opens dashboard", async ({
  page,
}) => {
  await mock(page, "evaluator", false);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New accounts start")).toHaveCount(0);
  await dialog.getByLabel("Email address").fill(user.email);
  await dialog.getByLabel("Password", { exact: true }).fill("testing-password");
  await dialog.getByLabel("Confirm password").fill("testing-password");
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Let’s get to know you" }),
  ).toBeVisible();
  await page.getByLabel("First name").fill("Pat");
  await page.getByLabel("Last name").fill("Green");
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByText("Welcome back, Pat.")).toBeVisible();
  await expect(page).toHaveURL(/dashboard/);
  await page.reload();
  await expect(page.getByText("Welcome back, Pat.")).toHaveCount(0);
});

test("operator connects a granted device, waits for telemetry, and sees saved live readings", async ({ page }) => {
  await mock(page);
  let device = {
    id: 1, owner_id: 1, name: "Test chamber", serial_number: "TEST-001", is_demo: false,
    status: "pending", last_seen_at: null as string | null,
    mqtt_topic_prefix: null as string | null, connection_requested_at: null as string | null,
  };
  let readings: Record<string, unknown>[] = [];
  let mqttConnected = true;
  let rejected = true;
  const emptyChamber = { ...device, id: 2, serial_number: "TEST-002", name: "Waiting chamber" };
  await page.route("**/api/v1/devices/live*", (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("after_id") ?? 0);
    return route.fulfill({ json: { devices: [device, emptyChamber], readings: readings.filter((r) => Number(r.id) > after), mqtt: { state: mqttConnected ? "connected" : "reconnecting", connected: mqttConnected, broker_url: "wss://broker.hivemq.com:8884/mqtt", stale_seconds: 30 } } });
  });
  await page.route("**/api/v1/devices/connect", async (route) => {
    if (rejected) return route.fulfill({ status: 409, json: { detail: "This MQTT topic prefix is already connected to another device. Use a unique prefix." } });
    const body = route.request().postDataJSON();
    device = { ...device, name: body.name, mqtt_topic_prefix: body.topic_prefix, status: "pending", connection_requested_at: new Date().toISOString() };
    return route.fulfill({ status: 202, json: device });
  });
  await page.goto("/operator");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Chamber & Access", exact: true }).click();
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add device", exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(dialog.getByLabel("MQTT broker")).toHaveValue("wss://broker.hivemq.com:8884/mqtt");
  await dialog.getByRole("button", { name: "Connect device", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already connected to another device");
  rejected = false;
  await dialog.getByLabel("MQTT topic prefix").fill("sproutsync/test-001");
  await dialog.getByRole("button", { name: "Connect device", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Waiting for a fresh sensor packet");
  await expect(dialog.getByText("Device detected", { exact: false })).toHaveCount(0);
  const now = new Date().toISOString();
  device = { ...device, status: "online", last_seen_at: now };
  readings = [{ id: 100, device_id: 1, temperature_c: 26.2, humidity_percent: 87, water_temperature_c: 20.4, light_lux: 0, water_level_percent: null, wastewater_level_percent: null, sensor_status: "NONE", voltage: 5.02, sd_ok: true, recorded_at: now, received_at: now }];
  await expect(dialog.getByRole("status")).toContainText("Device detected", { timeout: 10000 });
  await dialog.getByRole("button", { name: "View live readings" }).click();
  await expect(page.getByText("26.2 °C", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("0 lux", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No reading", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: "test-results/live-readings-mobile.png", fullPage: true });
  await page.getByLabel("Filter readings by chamber").selectOption("2");
  await expect(page.getByText("No sensor readings available for this chamber selection.")).toBeVisible();
  await expect(page.getByText("26.2 °C", { exact: true })).toHaveCount(0);
  await page.getByLabel("Filter readings by chamber").selectOption("1");
  mqttConnected = false;
  device = { ...device, status: "offline" };
  await expect(page.getByText("Showing the last known reading. Waiting for fresh sensor data.")).toBeVisible({ timeout: 10000 });
  // Saved readings remain visible after the operator reloads.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Readings", exact: true }).click();
  await expect(page.getByText("26.2 °C", { exact: true }).first()).toBeVisible();
});
test("evaluator cannot enter operator route or see operational controls", async ({
  page,
}) => {
  await mock(page, "evaluator");
  await page.goto("/operator");
  await expect(
    page.getByRole("heading", { name: "Operator access required" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open my dashboard" }).click();
  await expect(
    page.getByText("Review evidence independently; never rewrite machine data"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button"),
  ).toHaveCount(5);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Batch Evaluations", exact: true })
    .click();
  await expect(page.getByText("MB-001", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New batch", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View MB-001 stage: growing" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Inspect Batch · MB-001", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Evidence & Checks", exact: true })
    .click();
  await expect(page.getByText("Use the standard five-point rubric for every batch"))
    .toBeVisible();
  await page.getByRole("button", { name: "Evaluate a batch" }).click();
  await expect(page.getByRole("radio")).toHaveCount(5);
  await page.getByRole("radio", { name: "4" }).check();
  await expect(page.getByRole("radio", { name: "4" })).toBeChecked();
});
test("operator real batch form and minimal signout", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/operator");
  await expect(page).toHaveURL(/operator/);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Batch Production", exact: true })
    .click();
  await page.getByRole("button", { name: "New batch", exact: true }).click();
  await page.getByLabel("Batch code").fill("MB-002");
  await page.getByRole("dialog").getByLabel("Start date", { exact: true }).fill("2026-10-26T10:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("MB-002", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New batch", exact: true }).click();
  await page.getByLabel("Batch code").fill("mb-002");
  await page.getByRole("dialog").getByLabel("Start date", { exact: true }).fill("2026-10-26T11:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText(
      "That batch code already exists. Use a unique code before saving.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Alerts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Report current situation" })
    .click();
  const incidentDialog = page.getByRole("dialog", {
    name: "Report current situation",
  });
  await expect(
    incidentDialog.getByRole("textbox", { name: "Current situation" }),
  ).toBeEditable();
  await expect(
    incidentDialog.getByRole("button", { name: "Submit incident report" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Sign out", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Are you sure you want to sign out?" }),
  ).toBeVisible();
  await expect(dialog.getByText("You will return")).toHaveCount(0);
  await dialog.getByRole("button", { name: "No", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Chamber & Access", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sensors & chamber equipment" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Register equipment" }))
    .toHaveCount(0);
  await page.screenshot({
    path: "test-results/operator-desktop.png",
    fullPage: true,
  });
});
test("mobile bottom navigation and records fit 390px without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, "evaluator");
  await page.goto("/mobile");
  const mobile = page.getByRole("navigation", { name: "Mobile navigation" });
  await mobile.getByRole("button", { name: "Batch Evaluations", exact: true }).click();
  await expect(page.getByText("MB-001", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await mobile.getByRole("button", { name: "More", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Profile & settings")).toHaveCount(0);
  await expect(dialog.getByText("Sign out", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.screenshot({
    path: "test-results/mobile-batches.png",
    fullPage: true,
  });
});

test("new Google account reviews prefilled details and can correct them", async ({
  page,
}) => {
  await mock(page, "evaluator", true, true);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Is this information correct?" }),
  ).toBeVisible();
  await expect(page.getByText("Grower", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit information" }).click();
  await page.getByLabel("First name").fill("Pat");
  await page.getByRole("button", { name: "Confirm & continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account is ready" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome back, Pat.")).toBeVisible();
});
test("avatar menu keeps one profile and settings destination", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/operator");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByText("Profile & settings"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await menu
    .getByRole("menuitem", { name: "Profile & settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Personal details", exact: true }),
  ).toBeVisible();
  const personalDetails = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Personal details",
      exact: true,
    }),
  });
  await expect(personalDetails.getByLabel("First name")).toHaveCount(0);
  await expect(personalDetails.getByLabel("Last name")).toHaveCount(0);
  await expect(
    personalDetails.getByText("Test Grower", { exact: true }),
  ).toBeVisible();
  await expect(
    personalDetails.getByText("test@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(
    personalDetails.getByRole("button", { name: "Change email" }),
  ).toBeDisabled();
  await expect(
    personalDetails.getByText(
      "Changing your email requires verification. This option is unavailable until email verification is added.",
    ),
  ).toBeVisible();
  await expect(
    personalDetails.getByLabel("Organization (optional)"),
  ).toBeEditable();
  await page.getByRole("button", { name: "Request support" }).click();
  const supportDialog = page.getByRole("dialog");
  await expect(
    supportDialog.getByRole("heading", { name: "Request support" }),
  ).toBeVisible();
  await expect(
    supportDialog.getByRole("button", { name: "Send support request" }),
  ).toBeDisabled();
});
test("landing download opens an APK download instead of the mobile simulator", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, "evaluator", false);
  await page.route("**/downloads/mobile-release.json", (r) =>
    r.fulfill({
      json: {
        available: true,
        version: "0.1.0",
        url: "/downloads/sproutsync-preview.apk",
        size_bytes: 1024,
        sha256: "abc",
        channel: "Development preview",
      },
    }),
  );
  await page.route("**/downloads/sproutsync-preview.apk", (route) =>
    route.fulfill({
      contentType: "application/vnd.android.package-archive",
      body: Buffer.from("APK test fixture"),
    }),
  );
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByText("System ready", { exact: true })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download mobile app", exact: true })
    .first()
    .click();
  expect((await download).suggestedFilename()).toBe("sproutsync-preview.apk");
  await expect(page).toHaveURL(/download/);
  await expect(
    page.getByRole("link", { name: "Download Android APK", exact: true }),
  ).toHaveAttribute("href", "/downloads/sproutsync-preview.apk");
});

test("Amaro telemetry exports respect Josh's chamber filter and preserve zero readings", async ({ page }) => {
  await mock(page);
  const now = new Date().toISOString();
  const name = '=1+2, 🌱 <script>window.reportInjected=true</script>';
  const devices = [
    { id: 1, owner_id: 1, name, serial_number: "TEST-001", status: "online", is_demo: false, last_seen_at: now },
    { id: 2, owner_id: 1, name: "Other chamber", serial_number: "TEST-002", status: "online", is_demo: false, last_seen_at: now },
    { id: 3, owner_id: 1, name: "Empty chamber", serial_number: "TEST-003", status: "pending", is_demo: false, last_seen_at: null },
  ];
  const readings = [1, 2].map((device_id) => ({
    id: device_id, device_id, temperature_c: device_id === 1 ? 26.2 : 29,
    humidity_percent: 87, water_temperature_c: null, light_lux: 0,
    water_level_percent: null, wastewater_level_percent: null,
    sensor_status: "NONE", recorded_at: now, received_at: now,
  }));
  await page.route(`https://${authHost}/rest/v1/devices*`, (route) => route.fulfill({ json: devices }));
  await page.route(`https://${authHost}/rest/v1/telemetry_readings*`, (route) => route.fulfill({ json: readings }));
  await page.route("**/api/v1/devices/live*", (route) => route.fulfill({ json: {
    devices, readings, mqtt: { state: "connected", connected: true, stale_seconds: 30 },
  } }));
  await page.context().addInitScript(() => { window.print = () => {}; });
  await page.goto("/operator");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Readings", exact: true }).click();
  await page.getByLabel("Filter readings by chamber").selectOption("1");
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe("sproutsync-sensor-readings.csv");
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
  const csv = bytes.toString("utf8");
  expect(csv).toContain("Air Temperature (°C)");
  expect(csv).toContain(`"'${name}"`);
  expect(csv).toContain('"26.2","87","","","0"');
  expect(csv).not.toContain("Other chamber");
  const reportReady = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Branded report", exact: true }).click();
  const report = await reportReady;
  await expect(report.getByRole("heading", { name: "Historical Sensor Telemetry", exact: true })).toBeVisible();
  await expect(report.getByRole("row")).toHaveCount(2);
  await expect(report.getByRole("cell", { name, exact: true })).toBeVisible();
  await expect(report.getByRole("cell", { name: "0", exact: true })).toBeVisible();
  await expect(report.locator("script")).toHaveCount(0);
  expect(await report.evaluate(() => "reportInjected" in window)).toBe(false);
  await report.close();
  await page.getByLabel("Filter readings by chamber").selectOption("3");
  await expect(page.getByRole("button", { name: "Download CSV", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Branded report", exact: true })).toBeDisabled();
  await expect(page.getByText("No sensor readings available for this chamber selection.")).toBeVisible();
});

test("Amaro notification details and Help FAQ work on a narrow screen", async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`https://${authHost}/rest/v1/alerts*`, (route) => route.fulfill({ json: [{
    id: 1, severity: "critical", title: "Check the water tank", message: "Operator noted a blocked outlet.",
    acknowledged_at: null, resolved_at: null, created_at: new Date().toISOString(),
  }] }));
  await page.goto("/operator");
  await page.getByRole("button", { name: "Notifications, 1 active alerts", exact: true }).click();
  const notifications = page.getByRole("dialog");
  await expect(notifications.getByText("Operator noted a blocked outlet.")).toBeVisible();
  await expect(notifications.getByText("Critical", { exact: true })).toBeVisible();
  await notifications.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Help & FAQ", exact: true }).click();
  const help = page.getByRole("dialog");
  await expect(help.getByRole("heading", { name: "Grow with confidence.", exact: true })).toBeVisible();
  await expect(help.locator(".help-area-card")).toHaveCount(5);
  await help.locator("summary").filter({ hasText: "Where do chamber readings come from?" }).click();
  await expect(help.getByText("Readings are shown when a connected chamber reports them.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/amaro-help-mobile.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});

test("device fault alerts appear in notifications and alert history", async ({ page }) => {
  await mock(page);
  const faultAlert = {
    id: 21,
    owner_id: 1,
    device_id: 1,
    title: "Device fault: Test chamber",
    message: "Test chamber (TEST-001) reported SD CARD ERR. Check the latest sensor readings before relying on them.",
    recommended_action: "Inspect the reported device fault and confirm fresh readings return.",
    severity: "warning",
    status: "open",
    category: "device",
    created_at: new Date().toISOString(),
  };
  await page.route(`https://${authHost}/rest/v1/alerts*`, (route) =>
    route.fulfill({ json: [faultAlert] }),
  );
  await page.goto("/operator");

  await page.getByRole("button", { name: "Notifications, 1 active alerts", exact: true }).click();
  const notifications = page.getByRole("dialog");
  await expect(notifications.getByText(faultAlert.title, { exact: true })).toBeVisible();
  await expect(notifications.getByText(faultAlert.message, { exact: true })).toBeVisible();
  await notifications.getByRole("button", { name: "Close dialog", exact: true }).click();

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: /^Alerts/ }).click();
  const alertRow = page.getByRole("button").filter({ hasText: faultAlert.title });
  await expect(alertRow).toBeVisible();
  await alertRow.click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("device", { exact: true })).toBeVisible();
  await expect(details.getByText(faultAlert.message, { exact: true })).toBeVisible();
  await expect(details.getByText(faultAlert.recommended_action, { exact: true })).toBeVisible();
});

test("Amaro account and audit layouts keep search, event order, and mobile reflow", async ({ page }) => {
  await mock(page, "superadmin");
  await page.route("**/api/v1/superadmin/accounts", (route) => route.fulfill({ json: [] }));
  await page.route(`https://${authHost}/rest/v1/activity_logs*`, (route) => route.fulfill({ json: [
    { id: 2, action: "register_nearby_device", resource: "devices:ESP32-1:wifi", created_at: "2026-10-29T02:00:00Z" },
    { id: 1, action: "update_account", resource: "users:5", created_at: "2026-10-28T02:00:00Z" },
  ] }));
  await page.goto("/superadmin");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Accounts Directory & Governance", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/amaro-accounts-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const accountRow = page.locator(".accounts-directory-table tbody tr").first();
  const accountCard = await accountRow.boundingBox();
  const accountCell = await accountRow.getByRole("cell").first().boundingBox();
  expect(accountCell!.width / accountCard!.width).toBeGreaterThan(0.8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/amaro-accounts-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await nav.getByRole("button", { name: "Audit Log", exact: true }).click();
  await expect(page.getByText("2 events recorded", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toContainText("devices:ESP32-1:wifi");
  const search = page.getByRole("searchbox", { name: "Search audit events", exact: true });
  await search.fill("esp32-1");
  await expect(page.getByRole("searchbox")).toHaveAccessibleName("Search audit events");
  await expect(page.getByText("1 event found", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "users:5", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear audit search", exact: true }).click();
  await expect(page.getByText("2 events recorded", { exact: true })).toBeVisible();
  await search.fill("unknown");
  await expect(page.getByText("No audit events match your search. Try another action, target, or date.")).toBeVisible();
  await search.fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  const auditRow = page.locator(".audit-log tbody tr").first();
  const auditCard = await auditRow.boundingBox();
  const auditCell = await auditRow.getByRole("cell").first().boundingBox();
  expect(auditCell!.width / auditCard!.width).toBeGreaterThan(0.8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/amaro-audit-mobile.png", fullPage: true });
});

test("history pagination stays within the grid when there are many pages", async ({ page }) => {
  await mock(page, "superadmin");
  await page.route("**/api/v1/superadmin/accounts", (route) => route.fulfill({ json: [] }));
  await page.route(`https://${authHost}/rest/v1/activity_logs*`, (route) =>
    route.fulfill({ json: Array.from({ length: 1224 }, (_, index) => ({
      id: 1224 - index,
      action: "update_account",
      resource: `users:${1224 - index}`,
      created_at: new Date(Date.now() - index * 1000).toISOString(),
    })) }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/superadmin");
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Audit Log", exact: true }).click();

  const pagination = page.getByRole("navigation", { name: "Table pages" });
  await expect(pagination.getByRole("button", { name: /^Page / })).toHaveCount(6);
  expect(await pagination.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await pagination.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(pagination.getByRole("button", { name: "Page 2", exact: true }))
    .toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
