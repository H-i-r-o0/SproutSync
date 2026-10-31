import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch, supabase } from "../supabase";
import { apiUrl } from "../config";
import { errorMessage, type Alert, type Device, type Reading, type WorkspaceData } from "./workspace";

export type MQTTStatus = {
  state: string;
  connected: boolean;
  broker_url: string;
  stale_seconds: number;
};
type LiveSnapshot = { devices: Device[]; readings: Reading[]; mqtt: MQTTStatus };

async function checkedJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const body = await response.json().catch(() => null);
      throw new Error(typeof body?.detail === "string" ? body.detail : "Live device service is unavailable. Check that the API is running.");
    }
    throw new Error(
      response.status === 404
        ? "Live telemetry requires the SproutSync backend API."
        : `Live device service returned HTTP ${response.status}.`
    );
  }

  if (!isJson) {
    throw new Error("Live device service is unavailable. Check that the API server is running and configured.");
  }

  return response.json() as Promise<T>;
}

export async function connectDevice(values: { serial_number: string; name: string; topic_prefix: string }) {
  return checkedJson<Device>(await apiFetch("/api/v1/devices/connect", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values), signal: AbortSignal.timeout(10000),
  }));
}

export function mergeReadings(current: Reading[], incoming: Reading[]): Reading[] {
  const rows = new Map(current.map((r) => [r.id, r]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at) || b.id - a.id).slice(0, 2000);
}

export function useLiveTelemetry(profileId: number, setData: Dispatch<SetStateAction<WorkspaceData>>) {
  const [mqtt, setMqtt] = useState<MQTTStatus | null>(null);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const realtimeRef = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let cursor: number | undefined;
    let deviceIds: string | undefined;

    const isLocal = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const hasBackendApi = Boolean(apiUrl) || isLocal;

    const refresh = async () => {
      if (!active) return;
      if (document.visibilityState === "visible") {
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 8000);
        try {
          const next = await checkedJson<LiveSnapshot>(await apiFetch(`/api/v1/devices/live${cursor === undefined ? "" : `?after_id=${cursor}`}`, { signal: controller.signal }));
          if (!active) return;
          const nextIds = next.devices.map((d) => d.id).sort((a, b) => a - b).join(",");
          cursor = deviceIds !== undefined && deviceIds !== nextIds ? undefined : Math.max(cursor ?? 0, ...next.readings.map((r) => r.id));
          deviceIds = nextIds;
          setMqtt(next.mqtt);
          setError("");
          setData((current) => ({
            ...current, devices: next.devices,
            readings: mergeReadings(current.readings, next.readings).filter((r) => next.devices.some((d) => d.id === r.device_id)),
          }));
        } catch (err) {
          if (!active) return;
          // If Supabase Realtime is actively connected, don't scream with a breaking error banner
          if (realtimeRef.current) {
            console.warn("Backend live snapshot poll skipped, relying on Supabase Realtime:", err);
          } else {
            setError(errorMessage(err));
          }
        } finally {
          clearTimeout(timeout);
        }
      }
      if (active) timer = setTimeout(refresh, realtimeRef.current ? 10000 : 2000);
    };

    // Database push updates provide immediate readings; snapshots recover missed packets
    // and keep live monitoring usable when Realtime is unavailable.
    const channel = supabase.channel(`live-telemetry-${profileId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "telemetry_readings" }, ({ new: row }) => {
        if (!active) return;
        const reading = row as Reading;
        setData((current) => current.devices.some((d) => d.id === reading.device_id)
          ? { ...current, readings: mergeReadings(current.readings, [reading]) } : current);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (payload) => {
        if (!active) return;
        const nextAlert = payload.new as Partial<Alert>;
        const previousAlert = payload.old as Partial<Alert>;
        const id = Number(nextAlert.id ?? previousAlert.id);
        if (!Number.isFinite(id)) return;
        setData((current) => {
          const alerts = current.alerts.filter((alert) => alert.id !== id);
          if (payload.eventType !== "DELETE") {
            alerts.push(nextAlert as Alert);
          }
          alerts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
          return { ...current, alerts };
        });
      })
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          realtimeRef.current = true;
          setRealtime(true);
          setError("");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          realtimeRef.current = false;
          setRealtime(false);
        }
      });

    // Only start HTTP polling if an API URL is configured or running on localhost
    if (hasBackendApi) {
      void refresh();
    }

    return () => {
      active = false;
      realtimeRef.current = false;
      clearTimeout(timer);
      controller?.abort();
      void supabase.removeChannel(channel);
    };
  }, [profileId, retry, setData]);

  return { mqtt, realtime, error, liveError: error, retry: () => setRetry((value) => value + 1) };
}
