import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  Sprout,
  LayoutDashboard,
  MoreHorizontal,
  Droplets,
  Cpu,
  ClipboardCheck,
  Settings,
  LogOut,
  RefreshCw,
  Plus,
  Printer,
  Download,
  Search,
  ChevronRight,
  CheckCircle2,
  X,
  Activity,
  Menu,
  ShieldCheck,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Star,
  LifeBuoy,
  Users,
  UserPlus,
  UserCheck,
  Clock,
  FileText,
  Key,
  Thermometer,
  Sun,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "../supabase";
import {
  emptyWorkspace,
  loadWorkspace,
  isOperator,
  isSuperAdmin,
  isStrictOperator,
  isEvaluator,
  hasActiveGrant,
  errorMessage,
  fetchAccounts,
  updateAccount,
  deleteAccount,
  grantDeviceSerial,
  assignEvaluator,
  fetchOperatorEvaluators,
  updateOperatorEvaluator,
  fetchAccessRequests,
  approveAccessRequest,
  declineAccessRequest,
  requestOperatorAccess,
  exportCsv,
  STATIC_ACCOUNTS,
  STATIC_OPERATOR_EVALUATORS,
  STATIC_ACCESS_REQUESTS,
  type Profile,
  type WorkspaceData,
  type Batch,
  type Alert,
  type Evaluation,
  type UserAccount,
  type Reading,
  type EvaluatorSummary,
  type AccessRequest,
} from "../data/workspace";
import { Logo, Btn, Modal, NotebookInspectIcon } from "./ProtoPrimitives";
import { PersonalDetails } from "./PersonalDetails";
import { WaterUseChart, Spark, QualityGradeChart } from "./ProtoCharts";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { mergeReadings, useLiveTelemetry } from "../data/liveTelemetry";
import { DeviceConnectionForm, LiveConnectionStatus } from "./DeviceConnection";
import logoUrl from "../assets/logo.png";

export function getRolePages(profile: Profile, hasGrant: boolean) {
  if (profile.role === "pending" || (!hasGrant && !isSuperAdmin(profile))) {
    return [{ key: "home", title: profile.role === "operator" ? "Connect a device" : "Access Pending", icon: ShieldCheck }];
  }
  if (isSuperAdmin(profile)) {
    return [
      { key: "home", title: "Overview", icon: LayoutDashboard },
      { key: "accounts", title: "Accounts", icon: Users },
      { key: "readings", title: "Readings", icon: Activity },
      { key: "alerts", title: "Alerts", icon: Bell },
      { key: "audit", title: "Audit Log", icon: FileText },
    ];
  }
  if (isStrictOperator(profile) || profile.role === "operator") {
    return [
      { key: "home", title: "Overview", icon: LayoutDashboard },
      { key: "production", title: "Batch Production", icon: Sprout },
      { key: "readings", title: "Readings", icon: Activity },
      { key: "irrigation", title: "Irrigation & Water", icon: Droplets },
      { key: "alerts", title: "Alerts", icon: Bell },
      { key: "system", title: "Chamber & Access", icon: Settings },
    ];
  }
  // Evaluator
  return [
    { key: "home", title: "Overview", icon: LayoutDashboard },
    { key: "production", title: "Batch Evaluations", icon: ClipboardCheck },
    { key: "readings", title: "Readings", icon: Activity },
    { key: "evidence", title: "Evidence & Checks", icon: CheckCircle2 },
    { key: "alerts", title: "Alerts", icon: Bell },
  ];
}
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    })
    : "Not set";

function printBrandedReport(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  options: { largeWatermark?: boolean; footer?: string } = {},
): boolean {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;

  const escapeHtml = (value: string | number | null | undefined) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const generatedAt = new Date().toLocaleString();
  const watermarkSize = options.largeWatermark ? "560px" : "340px";
  const watermarkOpacity = options.largeWatermark ? ".1" : ".055";
  const footer =
    options.footer ??
    "Sensor values are reported by chamber equipment. This report is a read-only snapshot and does not modify recorded readings.";
  const tableRows = rows
    .map(
      (row) =>
        `<tr>${headers
          .map((_, index) => {
            const value = row[index];
            return `<td>${value === "" || value == null ? "Not recorded" : escapeHtml(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)} · SproutSync</title>
        <style>
          @page { size: A4 landscape; margin: 14mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #233b2e; font: 13px/1.5 Arial, sans-serif; }
          .report { position: relative; isolation: isolate; }
          .watermark { position: fixed; z-index: 0; top: 24%; left: 50%; width: ${watermarkSize}; height: ${watermarkSize}; max-width: 80vw; object-fit: contain; opacity: ${watermarkOpacity}; transform: translateX(-50%); pointer-events: none; }
          header, .summary, table, footer { position: relative; z-index: 1; }
          header { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; border-bottom: 2px solid #dce8df; }
          header img { width: 52px; height: 52px; object-fit: contain; }
          .brand { color: #287346; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
          h1 { margin: 3px 0 0; font-size: 23px; line-height: 1.2; }
          .subtitle { margin: 5px 0 0; color: #617468; }
          .summary { display: flex; justify-content: space-between; gap: 16px; margin: 18px 0 10px; color: #63766a; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 10px; }
          thead { display: table-header-group; }
          th { padding: 9px 8px; background: #edf5ef; color: #345b40; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
          td { padding: 8px; border-bottom: 1px solid #e5ece6; overflow-wrap: anywhere; }
          tr { break-inside: avoid; }
          tbody tr:nth-child(even) { background: #fafcfb; }
          footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e1e9e3; color: #728277; font-size: 10px; }
          @media screen { body { padding: 28px; background: #f5f8f5; } .report { max-width: 1200px; margin: auto; padding: 30px; background: white; border: 1px solid #dce8df; border-radius: 16px; box-shadow: 0 12px 40px #183d2812; } }
        </style>
      </head>
      <body>
        <main class="report">
          <img class="watermark" src="${escapeHtml(logoUrl)}" alt="">
          <header>
            <img src="${escapeHtml(logoUrl)}" alt="SproutSync logo">
            <div>
              <div class="brand">SproutSync · Workspace report</div>
              <h1>${escapeHtml(title)}</h1>
              <p class="subtitle">${escapeHtml(subtitle)}</p>
            </div>
          </header>
          <div class="summary"><span>${rows.length} ${rows.length === 1 ? "reading" : "readings"}</span><span>Generated ${escapeHtml(generatedAt)}</span></div>
          <table>
            <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
          <footer>${escapeHtml(footer)}</footer>
        </main>
      </body>
    </html>`);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.setTimeout(() => reportWindow.print(), 500);
  return true;
}
const stages = ["soaking", "rinsing", "growing", "ready", "harvested"];
type Dialog = {
  kind: string;
  batch?: Batch;
  alert?: Alert;
  evaluation?: Evaluation;
  account?: UserAccount;
  evaluator?: EvaluatorSummary;
  operator_id?: number;
  evaluator_id?: number;
  batch_id?: number;
} | null;

export default function Workspace({
  profile,
  onProfile,
  onSignOut,
}: {
  profile: Profile;
  onProfile: (value: Profile) => void;
  onSignOut: () => Promise<void>;
}) {
  const superadmin = isSuperAdmin(profile);
  const strictOperator = isStrictOperator(profile);
  const evaluator = isEvaluator(profile);
  const operator = isOperator(profile);
  const roleLabel = superadmin
    ? "Superadmin"
    : strictOperator
      ? "Operator"
      : "Evaluator";
  const [page, setPage] = useState("home");
  const [menu, setMenu] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [data, setData] = useState<WorkspaceData>(emptyWorkspace);
  const live = useLiveTelemetry(profile.id, setData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [toast, setToast] = useState("");
  const [showWelcome, setShowWelcome] = useState(
    () => sessionStorage.getItem(`sproutsync-welcome-${profile.id}`) !== "seen",
  );
  const [query, setQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [batchMonth, setBatchMonth] = useState("");
  const [batchDate, setBatchDate] = useState("");
  const initialAccounts = (() => {
    const list = [...STATIC_ACCOUNTS];
    if (
      superadmin &&
      !list.some(
        (a) =>
          a.id === profile.id ||
          (profile.email && a.email.toLowerCase() === profile.email.toLowerCase()),
      )
    ) {
      list.unshift({
        id: profile.id,
        email: profile.email,
        role: profile.role,
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        display_name: profile.display_name || profile.email,
        organization: profile.organization || "SproutSync Administration",
        phone: profile.phone || "",
        avatar_url: profile.avatar_url || null,
        is_active: true,
        granted_serial_count: 0,
        evaluator_grant_count: 0,
        created_at: new Date().toISOString(),
      });
    }
    return list;
  })();
  const [accounts, setAccounts] = useState<UserAccount[]>(initialAccounts);
  const [operatorEvaluators, setOperatorEvaluators] = useState<EvaluatorSummary[]>(
    STATIC_OPERATOR_EVALUATORS,
  );
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>(
    STATIC_ACCESS_REQUESTS,
  );
  const [expandedOperatorId, setExpandedOperatorId] = useState<number | null>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [accountRoleFilter, setAccountRoleFilter] = useState("all");
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [pendingOperatorEmail, setPendingOperatorEmail] = useState("");
  const [pendingSubmitted, setPendingSubmitted] = useState(false);
  const [evaluationQuery, setEvaluationQuery] = useState("");
  const [evaluationBatch, setEvaluationBatch] = useState("all");
  const [auditQuery, setAuditQuery] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("all");
  const [preferences, setPreferences] = useState({
    alerts_enabled: true,
    harvest_enabled: true,
  });
  useEffect(() => {
    if (showWelcome) {
      sessionStorage.setItem(`sproutsync-welcome-${profile.id}`, "seen");
    }
  }, [profile.id, showWelcome]);
  useEffect(() => {
    let active = true;
    supabase
      .from("notification_preferences")
      .select("alerts_enabled,harvest_enabled")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setToast("Notification preferences could not be loaded.");
        else if (data) setPreferences(data);
      });
    return () => {
      active = false;
    };
  }, [profile.id]);
  const pending = useRef<AbortController | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accountMenu) return;
    const outside = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node))
        setAccountMenu(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenu(false);
        accountRef.current
          ?.querySelector<HTMLButtonElement>(".account-trigger")
          ?.focus();
      }
      const items = Array.from(
        accountRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
      if (
        !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
        !items.length
      )
        return;
      event.preventDefault();
      const current = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
            items.length;
      items[index].focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [accountMenu]);
  const hasGrant = hasActiveGrant(profile, data);
  const nav = getRolePages(profile, hasGrant);

  useEffect(() => {
    if (!nav.some((item) => item.key === page) && page !== "settings") {
      setPage("home");
    }
  }, [nav, page]);
  const reload = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setRefreshing(true);
    try {
      const next = await loadWorkspace(controller.signal);
      if (!controller.signal.aborted) {
        // A slower workspace request can finish after a live packet arrives.
        // Keep those packets while respecting the newly authorized device list.
        setData((current) => ({
          ...next,
          readings: mergeReadings(next.readings, current.readings).filter((reading) =>
            next.devices.some((device) => device.id === reading.device_id),
          ),
        }));
        setError("");
        setUpdated(new Date());
        if (superadmin) {
          fetchAccounts()
            .then((res) => {
              if (Array.isArray(res) && res.length > 0) setAccounts(res);
            })
            .catch(console.error);
        }
        if (operator) {
          fetchOperatorEvaluators()
            .then((res) => {
              if (Array.isArray(res) && res.length > 0) setOperatorEvaluators(res);
            })
            .catch(console.error);
          fetchAccessRequests()
            .then((res) => {
              if (Array.isArray(res) && res.length > 0) setAccessRequests(res);
            })
            .catch(console.error);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [superadmin, operator]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 30000);
    const resume = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      pending.current?.abort();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function navigate(key: string) {
    setPage(key);
    setMenu(false);
    setQuery("");
  }
  function open(next: Dialog) {
    setDialogError("");
    setDialog(next);
  }
  function close() {
    if (!busy) {
      setDialog(null);
      setDialogError("");
    }
  }
  async function mutate(
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) {
    setBusy(true);
    setDialogError("");
    try {
      const { error } = await action();
      if (error) throw error;
      setDialog(null);
      setToast(success);
      await reload();
    } catch (error) {
      setDialogError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const activeAlerts = data.alerts.filter((a) => a.status !== "resolved");
  const notificationAlerts = activeAlerts.filter((a) =>
    a.category === "harvest"
      ? preferences.harvest_enabled
      : preferences.alerts_enabled,
  );
  const batches = data.batches.filter((b) => {
    const matchesFilter =
      batchFilter === "all"
        ? true
        : batchFilter === "active"
          ? b.status === "active"
          : batchFilter === "archived"
            ? b.status === "archived"
            : batchFilter === "unrated"
              ? data.evaluations.every((e) => e.batch_id !== b.id)
              : b.stage === batchFilter;

    const matchesDate =
      (!batchMonth || b.started_at.slice(0, 7) === batchMonth) &&
      (!batchDate || b.started_at.startsWith(batchDate));

    const matchesQuery = `${b.code} ${b.seed_type} ${b.stage}`
      .toLowerCase()
      .includes(query.toLowerCase());

    return matchesFilter && matchesDate && matchesQuery;
  });

  const sortedBatches = [...batches].sort(
    (a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime() ||
      b.id - a.id,
  );
  const deviceName = (id: number) =>
    data.devices.find((d) => d.id === id)?.name ?? `Device ${id}`;
  const batchName = (id: number | null) =>
    data.batches.find((b) => b.id === id)?.code ?? "All batches";
  const evaluationRows = data.evaluations.filter((evaluation) => {
    const code = batchName(evaluation.batch_id);
    return (
      (evaluationBatch === "all" ||
        evaluation.batch_id === Number(evaluationBatch)) &&
      `${code} ${evaluation.comments}`
        .toLowerCase()
        .includes(evaluationQuery.toLowerCase())
    );
  });
  const deviceReadings = data.readings.filter(
    (r) => selectedDevice === "all" || r.device_id === Number(selectedDevice),
  );
  const telemetryExportHeaders = [
    "Chamber",
    "Air Temperature (°C)",
    "Humidity (%)",
    "Fresh Water (%)",
    "Water Temperature (°C)",
    "Light (lux)",
    "Wastewater (%)",
    "Recorded At (ISO 8601)",
  ];
  const telemetryExportRows = deviceReadings.map((reading) => [
    deviceName(reading.device_id),
    reading.temperature_c ?? "",
    reading.humidity_percent ?? "",
    reading.water_level_percent ?? "",
    reading.water_temperature_c ?? "",
    reading.light_lux ?? "",
    reading.wastewater_level_percent ?? "",
    reading.recorded_at,
  ]);
  const currentReading = deviceReadings[0];
  const readingDevice = data.devices.find((d) => d.id === currentReading?.device_id);
  const readingStale = Boolean(currentReading && (
    live.error ||
    (readingDevice && !["online", "fault"].includes(readingDevice.status)) ||
    (live.mqtt && !live.mqtt.connected) ||
    Date.now() - Date.parse(currentReading.received_at ?? currentReading.recorded_at) > (live.mqtt?.stale_seconds ?? 120) * 1000
  ));
  const initials = (profile.first_name || profile.display_name || profile.email)
    .trim()
    .split(/\s+/)
    .map((value) => value[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const nextSchedule = data.schedules
    .filter((s) => s.enabled && new Date(s.next_run_at) > new Date())
    .sort((a, b) => a.next_run_at.localeCompare(b.next_run_at))[0];
  const totalLitres =
    data.watering.reduce((total, event) => total + event.volume_ml, 0) / 1000;
  const title =
    nav.find((item) => item.key === page)?.title ??
    (page === "settings" ? "Profile & settings" : "Overview");
  const table = (headings: string[], rows: ReactNode[][], empty: string) => (
    <DataTable headings={headings} rows={rows} empty={empty} />
  );
  const batchTable = (rows: Batch[]) =>
    table(
      [
        "Batch",
        "Owner",
        "Crop",
        "Stage",
        "Status",
        "Quality Rating",
        "Target harvest",
        "Actions",
      ],
      rows.map((b) => {
        const batchEvaluations = data.evaluations.filter(
          (e) => e.batch_id === b.id,
        );
        const avgRating = batchEvaluations.length
          ? Math.round(
            batchEvaluations.reduce((acc, cur) => acc + cur.rating, 0) /
            batchEvaluations.length,
          )
          : null;

        return [
          <strong key="code">{b.code}</strong>,
          `Operator #${b.owner_id}`,
          b.seed_type,
          <button
            key="stage"
            className="table-link"
            onClick={() => open({ kind: "batch-details", batch: b })}
            aria-label={`${operator ? "Update" : "View"} ${b.code} stage: ${b.stage}`}
          >
            <Status value={b.stage} />
          </button>,
          <Status key="status" value={b.status} />,
          <span
            key="rating"
            className="inline-flex items-center gap-1.5"
            title={
              avgRating !== null
                ? `Rated ${avgRating}/5 stars (${batchEvaluations.length} evaluation${batchEvaluations.length > 1 ? "s" : ""})`
                : "Not yet evaluated"
            }
          >
            {avgRating !== null ? (
              <>
                <Rating value={avgRating} />
                <span className="text-xs font-semibold text-muted-foreground">
                  ({avgRating}★)
                </span>
              </>
            ) : evaluator ? (
              <button
                type="button"
                className="text-xs text-primary font-semibold hover:underline"
                onClick={() => open({ kind: "evaluation", batch_id: b.id })}
              >
                + Rate batch
              </button>
            ) : (
              <span className="text-xs text-muted-foreground italic">Unrated</span>
            )}
          </span>,
          date(b.target_harvest_at),
          <button
            key="action"
            type="button"
            className="icon-action-btn"
            onClick={() => open({ kind: "batch-details", batch: b })}
            aria-label={`In-depth batch details for ${b.code}`}
            title={`Inspect ${b.code} in depth (readings, watering, evidence & evaluation)`}
          >
            <NotebookInspectIcon size={18} />
            <span className="sr-only">Inspect {b.code} in depth</span>
          </button>,
        ];
      }),
      operator
        ? "No batches yet. Create your first batch to start tracking."
        : "No batches have been shared with your account yet.",
    );

  return (
    <div className="app-workspace">
      <a href="#workspace-main" className="skip-link">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <a href={superadmin ? "/superadmin" : strictOperator ? "/operator" : "/dashboard"} className="app-brand">
          <Logo className="h-16 w-16" />
          <span>SproutSync</span>
        </a>
        <p className="sidebar-caption">
          {roleLabel} workspace
        </p>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              aria-current={page === item.key ? "page" : undefined}
              className={page === item.key ? "selected" : ""}
            >
              <item.icon size={18} />
              {item.title}
              {item.key === "alerts" && activeAlerts.length > 0 && (
                <span className="nav-count">{activeAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="avatar">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              initials
            )}
          </span>
          <div>
            <strong>{profile.display_name || profile.email}</strong>
            <small>{roleLabel}</small>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <button
            className="icon-button lg:hidden"
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <div>
            <p className="text-xs text-muted-foreground">Workspace / {title}</p>
            <h1 className="text-lg font-bold">{title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="icon-button relative"
              aria-label={`Notifications, ${notificationAlerts.length} active alerts`}
              onClick={() => open({ kind: "notifications" })}
            >
              <Bell size={20} />
              {notificationAlerts.length > 0 && (
                <span className="notification-dot" />
              )}
            </button>
            <div className="account-menu" ref={accountRef}>
              <button
                className="account-trigger"
                aria-label="Account menu"
                aria-expanded={accountMenu}
                aria-haspopup="menu"
                onClick={() => setAccountMenu((value) => !value)}
              >
                <span className="avatar">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </span>
                <span className="account-trigger-copy">
                  <strong>{profile.display_name || profile.email}</strong>
                  <small>{roleLabel}</small>
                </span>
                <ChevronDown size={16} />
              </button>
              {accountMenu && (
                <div className="account-dropdown" role="menu">
                  <div className="account-dropdown-heading">
                    <span className="avatar">
                      {profile.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        initials
                      )}
                    </span>
                    <div>
                      <strong>{profile.display_name || profile.email}</strong>
                      <small>
                        {roleLabel} account
                      </small>
                    </div>
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setAccountMenu(false);
                      navigate("settings");
                    }}
                  >
                    <Settings size={17} />
                    Profile & settings
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setAccountMenu(false);
                      open({ kind: "help" });
                    }}
                  >
                    <HelpCircle size={17} />
                    Help & FAQ
                  </button>
                  <div className="account-dropdown-divider" />
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setAccountMenu(false);
                      open({ kind: "signout" });
                    }}
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="workspace-main" className="app-content" tabIndex={-1}>
          <div className="sync-bar">
            <span>
              {refreshing
                ? "Refreshing records…"
                : updated
                  ? `Updated ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Connecting…"}
            </span>
            <button
              disabled={refreshing}
              onClick={() => void reload()}
              className="table-link"
            >
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
          {error && (
            <div role="alert" className="feedback-error mb-5">
              {error}
              {updated && " Previously loaded records are shown below."}
            </div>
          )}
          {loading ? (
            <div
              role="status"
              aria-label="Loading workspace"
              className="grid gap-4 sm:grid-cols-2"
            >
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-36 animate-pulse rounded-2xl bg-secondary"
                />
              ))}
            </div>
          ) : (
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              {page === "home" && (profile.role === "pending" || (!hasGrant && !superadmin)) ? (
                profile.role === "pending" ? (
                  <div className="surface text-center py-12 px-6 max-w-lg mx-auto space-y-5 my-8">
                    <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center bg-amber-500/10 text-amber-600">
                      <Clock size={36} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-foreground">Access Pending</h2>
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                        Welcome, <strong>{profile.display_name || profile.email}</strong>. Your account is awaiting an Operator assignment. Enter your designated Chamber Operator&apos;s email address below to request evaluator access.
                      </p>
                    </div>
                    {pendingSubmitted ? (
                      <div className="p-4 rounded-xl bg-emerald-500/10 text-emerald-700 text-sm font-medium">
                        Your access request has been submitted to your Operator. Please wait for their approval.
                      </div>
                    ) : (
                      <form
                        className="space-y-3 text-left"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!pendingOperatorEmail.trim()) return;
                          setBusy(true);
                          try {
                            await requestOperatorAccess(pendingOperatorEmail.trim());
                            setPendingSubmitted(true);
                            setToast("Access request submitted to Operator.");
                          } catch (err) {
                            setToast(errorMessage(err));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <label className="block text-xs font-semibold text-foreground">
                          Operator Email Address
                        </label>
                        <input
                          type="email"
                          required
                          placeholder="operator@farm.com"
                          value={pendingOperatorEmail}
                          onChange={(e) => setPendingOperatorEmail(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-background focus:ring-2 focus:ring-primary/40 focus:outline-none"
                        />
                        <Btn type="submit" disabled={busy} className="w-full justify-center">
                          {busy ? <RefreshCw className="animate-spin" size={16} /> : <UserCheck size={16} />}
                          Submit Access Request
                        </Btn>
                      </form>
                    )}
                    <div className="pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                      <span>Signed in as {profile.email}</span>
                      <Btn variant="outline" size="sm" onClick={() => open({ kind: "signout" })}>
                        <LogOut size={14} /> Sign out
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div className="surface text-center py-12 px-6 max-w-xl mx-auto space-y-4 my-6">
                    <div
                      className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${evaluator
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-emerald-500/10 text-emerald-600"
                        }`}
                    >
                      {evaluator ? <ShieldCheck size={32} /> : <Cpu size={32} />}
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                      {evaluator
                        ? "Waiting for Operator Access Grant"
                        : "Connect your ESP32"}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {evaluator ? (
                        <>
                          You are signed in as an <strong>Evaluator</strong> (
                          <span className="text-foreground">{profile.email}</span>
                          ). An authorized chamber operator must grant your
                          account email address before you can inspect production
                          batches, view chamber sensors, or submit quality
                          evaluations.
                        </>
                      ) : (
                        <>
                          You are registered as an <strong>Operator</strong> (
                          <span className="text-foreground">{profile.email}</span>
                          ). Add a nearby SproutSync ESP32 using Wi-Fi or Bluetooth
                          to connect your first chamber.
                        </>
                      )}
                    </p>
                    <div className="p-4 bg-secondary/50 rounded-xl text-xs text-muted-foreground text-left space-y-2">
                      <p className="font-semibold text-foreground">
                        Next steps for activation:
                      </p>
                      {evaluator ? (
                        <>
                          <p>
                            1. Contact your SproutSync Chamber Operator or
                            Facility Manager.
                          </p>
                          <p>
                            2. Ask them to approve your request under <em>Chamber & Access → Pending requests</em>.
                          </p>
                          <p>
                            3. Click <strong>Check Grant Status</strong> once
                            granted.
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            1. Power on the ESP32 with SproutSync discovery firmware.
                          </p>
                          <p>
                            2. Connect it to the same Wi-Fi network as this local server,
                            or enable Bluetooth on this computer.
                          </p>
                          <p>
                            3. Select <strong>Add device</strong>, choose the detected board,
                            and wait for live sensor data.
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      {!evaluator && <Btn onClick={() => open({ kind: "device" })}><Plus size={16} /> Add device</Btn>}
                      <Btn
                        variant="outline"
                        disabled={refreshing}
                        onClick={() => void reload()}
                      >
                        <RefreshCw
                          size={14}
                          className={refreshing ? "animate-spin" : ""}
                        />
                        {evaluator
                          ? "Check Grant Status"
                          : "Check Equipment Status"}
                      </Btn>
                      <Btn variant="outline" onClick={() => open({ kind: "signout" })}>
                        <LogOut size={14} /> Sign out
                      </Btn>
                    </div>
                  </div>
                )
              ) : page === "home" && (
                <>
                  {showWelcome && (
                    <section className="welcome-panel">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">
                          {operator
                            ? "Your growing space"
                            : "Your evaluation space"}
                        </p>
                        <h2>Welcome back, {profile.first_name}.</h2>
                        <p>
                          {operator
                            ? "A clear view of your batches, chamber, and daily operations."
                            : "Review shared batches, inspect evidence, and submit your assessment."}
                        </p>
                        {data.batches.some((b) => b.is_demo) && (
                          <span className="preview-label">
                            Sample records · Saved in your workspace
                          </span>
                        )}
                      </div>
                      <Sprout className="welcome-leaf" size={88} />
                      <button
                        className="welcome-dismiss"
                        aria-label="Dismiss welcome"
                        onClick={() => setShowWelcome(false)}
                      >
                        <X size={17} />
                      </button>
                    </section>
                  )}
                  <section className="role-brief" aria-labelledby="role-scope-title">
                    <span className="role-brief-icon" aria-hidden="true">
                      <ShieldCheck size={22} />
                    </span>
                    <div>
                      <p className="role-kicker">
                        {superadmin
                          ? "Superadmin scope"
                          : strictOperator
                            ? "Operator scope"
                            : "Evaluator scope"}
                      </p>
                      <h2 id="role-scope-title">
                        {superadmin
                          ? "Provision accounts, roles and hardware serial ID grants"
                          : strictOperator
                            ? "Run production; keep machine evidence intact"
                            : "Review evidence independently; never rewrite machine data"}
                      </h2>
                      <p>
                        {superadmin
                          ? "Manage all user accounts (names, emails, roles) and grant hardware serial IDs to operators. Oversee full fleet telemetry, alerts, and immutable audit logs."
                          : strictOperator
                            ? "Create and update batches, schedules, alerts, maintenance, and evaluator access. The chamber controller remains responsible for live sensing and safety interlocks."
                            : "Inspect only the batches shared with you by authorized operators and submit your independent evaluation. If your observation conflicts with a sensor reading, document the discrepancy—all records remain traceable."}
                      </p>
                    </div>
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="How a record is tracked"
                      subtitle="One traceable path from production through review—click any step to jump to its records."
                    />
                    <ol className="tracking-map">
                      {[
                        [
                          "1",
                          "Batch",
                          "Owner, crop, dates and stage",
                          () => navigate("production"),
                          "Batch records",
                        ],
                        [
                          "2",
                          "Sensors & alerts",
                          "Machine readings and current problems",
                          () => navigate("readings"),
                          "Sensor readings",
                        ],
                        [
                          "3",
                          "Evidence",
                          "Checks, notes and maintenance",
                          () => navigate(evaluator ? "evidence" : "irrigation"),
                          evaluator ? "Evidence checks" : "Irrigation & Water",
                        ],
                        [
                          "4",
                          "Evaluation",
                          "Independent human rating",
                          () => navigate("production"),
                          "Batch evaluations",
                        ],
                        [
                          "5",
                          "Activity log",
                          "Who changed what and when",
                          () => navigate(superadmin ? "audit" : "system"),
                          superadmin ? "Audit Log" : "Chamber & Access",
                        ],
                      ].map(
                        (
                          [step, name, detail, onStepClick, targetLabel],
                          index,
                          items,
                        ) => (
                          <li key={step as string}>
                            <button
                              type="button"
                              onClick={onStepClick as () => void}
                              className="tracking-step-btn"
                              aria-label={`Step ${step}: ${name} (${detail}). Click to jump to ${targetLabel}.`}
                            >
                              <span className="step-num">{step as string}</span>
                              <div>
                                <strong>{name as string}</strong>
                                <small>{detail as string}</small>
                              </div>
                            </button>
                            {index < items.length - 1 && (
                              <ChevronRight size={18} aria-hidden="true" />
                            )}
                          </li>
                        ),
                      )}
                    </ol>
                  </section>
                  {evaluator && (
                    <>
                      <div className="summary-grid">
                        <Metric
                          icon={<ClipboardCheck />}
                          label="Batches needing review"
                          value={String(
                            data.batches.filter((b) =>
                              data.evaluations.every(
                                (e) => e.batch_id !== b.id,
                              ),
                            ).length,
                          )}
                          detail="Pending evaluator rating"
                          onClick={() => {
                            setBatchFilter("unrated");
                            navigate("production");
                          }}
                          targetLabel="Batch Evaluations"
                        />
                        <Metric
                          icon={<Sprout />}
                          label="Batches ready for harvest"
                          value={String(
                            data.batches.filter((b) => b.stage === "ready")
                              .length,
                          )}
                          detail="Ready for harvest review"
                          onClick={() => {
                            setBatchFilter("ready");
                            navigate("production");
                          }}
                          targetLabel="Batch Evaluations"
                        />
                        <Metric
                          icon={<Cpu />}
                          label="Granted chambers online"
                          value={
                            data.devices.length
                              ? `${data.devices.filter((d) => d.status === "online").length} / ${data.devices.length} online`
                              : "No chambers"
                          }
                          detail="Monitored growth chambers"
                          onClick={() => navigate("readings")}
                          targetLabel="Readings"
                        />
                        <Metric
                          icon={<Bell />}
                          label="Open alerts"
                          value={String(activeAlerts.length)}
                          detail="Awaiting review"
                          onClick={() => navigate("alerts")}
                          targetLabel="Alerts"
                        />
                      </div>
                      <section className="surface mt-5">
                        <SectionTitle
                          title="Quality Grade Distribution & Visual Rubric"
                          subtitle="Standardized 5-tier evaluation breakdown and sprout inspection criteria."
                        />
                        <QualityGradeChart evaluations={data.evaluations} />
                      </section>
                    </>
                  )}

                  {superadmin && (
                    <div className="summary-grid">
                      <Metric
                        icon={<Users />}
                        label="Managed accounts"
                        value={`${data.activity.filter((a) => a.resource.startsWith("users:")).length || "Fleet"} accounts`}
                        detail="Operators, evaluators & admins"
                        onClick={() => navigate("accounts")}
                        targetLabel="Accounts & Roles"
                      />
                      <Metric
                        icon={<Key />}
                        label="Granted serial IDs"
                        value={`${data.devices.length} chambers`}
                        detail="Hardware serial provisioning"
                        onClick={() => navigate("serials")}
                        targetLabel="Serial ID Grants"
                      />
                      <Metric
                        icon={<Cpu />}
                        label="Fleet machine status"
                        value={
                          data.devices.length
                            ? `${data.devices.filter((d) => d.status === "online").length} / ${data.devices.length} online`
                            : "No devices"
                        }
                        detail="Telemetry connection status"
                        onClick={() => navigate("readings")}
                        targetLabel="Readings"
                      />
                      <Metric
                        icon={<FileText />}
                        label="Audit events recorded"
                        value={String(data.activity.length)}
                        detail="Immutable access & grant logs"
                        onClick={() => navigate("audit")}
                        targetLabel="Audit Log"
                      />
                    </div>
                  )}

                  {!evaluator && !superadmin && (
                    <div className="summary-grid">
                      <Metric
                        icon={<Cpu />}
                        label="Machine status"
                        value={
                          data.devices.length
                            ? `${data.devices.filter((d) => d.status === "online" && (d.is_demo || (d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 300000))).length} online`
                            : "No devices"
                        }
                        detail={`${data.devices.length} linked devices`}
                        onClick={() => navigate("readings")}
                        targetLabel="Readings"
                      />
                      <Metric
                        icon={<ClipboardCheck />}
                        label="Batches ready / review"
                        value={String(
                          data.batches.filter((b) => b.stage === "ready")
                            .length,
                        )}
                        detail="Ready for harvest & check"
                        onClick={() => {
                          setBatchFilter("ready");
                          navigate("production");
                        }}
                        targetLabel="Batch Production"
                      />
                      <Metric
                        icon={<Sprout />}
                        label="Active batches"
                        value={String(
                          data.batches.filter((b) => b.status === "active")
                            .length,
                        )}
                        detail="Current production"
                        onClick={() => {
                          setBatchFilter("active");
                          navigate("production");
                        }}
                        targetLabel="Batch Production"
                      />
                      <Metric
                        icon={<Droplets />}
                        label="Fresh-water & tank status"
                        value={
                          currentReading
                            ? `${currentReading.water_level_percent ?? "—"}%`
                            : "Normal"
                        }
                        detail="Fresh-water level"
                        onClick={() => navigate("readings")}
                        targetLabel="Readings"
                      />
                      <Metric
                        icon={<Droplets />}
                        label="Next irrigation run"
                        value={
                          nextSchedule
                            ? date(nextSchedule.next_run_at)
                            : "Scheduled"
                        }
                        detail={`${data.watering.length} watering events`}
                        onClick={() => navigate("irrigation")}
                        targetLabel="Irrigation & Water"
                      />
                      <Metric
                        icon={<Bell />}
                        label="Open alerts"
                        value={String(activeAlerts.length)}
                        detail="Awaiting resolution"
                        onClick={() => navigate("alerts")}
                        targetLabel="Alerts"
                      />
                    </div>
                  )}
                  <div className="grid gap-5 xl:grid-cols-2">
                    <section className="surface">
                      <SectionTitle
                        title="Current conditions"
                        action={
                          <Btn
                            variant="ghost"
                            onClick={() => open({ kind: "readings" })}
                          >
                            View readings
                          </Btn>
                        }
                      />
                      <LiveConnectionStatus {...live} />
                      <label className="field mb-4">
                        <span className="sr-only">Select device</span>
                        <select
                          value={selectedDevice}
                          onChange={(e) => setSelectedDevice(e.target.value)}
                        >
                          <option value="all">Latest available reading</option>
                          {data.devices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {currentReading ? (
                        <>
                          <div className="condition-grid">
                            <div>
                              <strong>
                                {currentReading.temperature_c ?? "—"}°C
                              </strong>
                              <span>Temperature</span>
                            </div>
                            <div>
                              <strong>
                                {currentReading.humidity_percent ?? "—"}%
                              </strong>
                              <span>Humidity</span>
                            </div>
                            <div>
                              <strong>
                                {currentReading.water_level_percent ?? "—"}%
                              </strong>
                              <span>Water level</span>
                            </div>
                            <div>
                              <strong>
                                {currentReading.water_temperature_c ?? "—"}°C
                              </strong>
                              <span>Water temperature</span>
                            </div>
                            <div>
                              <strong>
                                {currentReading.light_lux ?? "—"} lux
                              </strong>
                              <span>Light level</span>
                            </div>
                            <div>
                              <strong>
                                {currentReading.wastewater_level_percent ?? "—"}
                                %
                              </strong>
                              <span>Wastewater</span>
                            </div>
                          </div>
                          <p className="mt-4 text-xs text-muted-foreground">
                            {deviceName(currentReading.device_id)} ·{" "}
                            {date(currentReading.recorded_at)}
                            {readingStale
                              ? " · Last known reading — live data unavailable"
                              : ""}
                          </p>
                        </>
                      ) : (
                        <Empty text="Waiting for your first device reading." />
                      )}
                    </section>
                    <section className="surface">
                      <SectionTitle title="Next irrigation" />
                      <p className="text-2xl font-bold">
                        {nextSchedule
                          ? date(nextSchedule.next_run_at)
                          : "No upcoming run"}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {nextSchedule
                          ? `${deviceName(nextSchedule.device_id)} · ${nextSchedule.duration_seconds} seconds`
                          : "Your configured irrigation schedule will appear here."}
                      </p>
                      <button
                        className="table-link mt-5"
                        onClick={() => navigate("production")}
                      >
                        View irrigation <ChevronRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="surface">
                    <SectionTitle
                      title="Recent batches"
                      action={
                        <Btn
                          variant="ghost"
                          onClick={() => navigate("production")}
                        >
                          View all
                        </Btn>
                      }
                    />
                    {batchTable(data.batches.slice(0, 5))}
                  </section>
                </>
              )}
              {page === "production" && (
                <section className="surface">
                  <SectionTitle
                    title={
                      evaluator ? "Batch evaluations" : "Production batches"
                    }
                    subtitle={
                      evaluator
                        ? "Inspect production batches, view machine conditions, and record human quality ratings."
                        : "Track every batch from soaking to harvest."
                    }
                    action={
                      operator && (
                        <Btn onClick={() => open({ kind: "batch-create" })}>
                          <Plus size={16} />
                          New batch
                        </Btn>
                      )
                    }
                  />
                  <div className="table-toolbar">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search batches"
                        placeholder="Search code, crop, stage…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      className="filter-select"
                      aria-label="Batch status and stage filter"
                      value={batchFilter}
                      onChange={(e) => setBatchFilter(e.target.value)}
                    >
                      <option value="all">All stages & statuses</option>
                      <option value="active">Active batches</option>
                      <option value="ready">Ready for review / harvest</option>
                      <option value="soaking">Soaking</option>
                      <option value="growing">Growing</option>
                      <option value="harvested">Harvested</option>
                      {evaluator && <option value="unrated">Unrated by me</option>}
                      <option value="archived">Archived</option>
                    </select>
                    <CalendarDatePicker
                      value={batchDate}
                      onChange={setBatchDate}
                      placeholder="Filter start date"
                    />
                  </div>
                  {(query || batchFilter !== "all" || batchDate || batchMonth) && (
                    <div className="filter-summary" role="status">
                      <span>
                        {sortedBatches.length} matching batch
                        {sortedBatches.length === 1 ? "" : "es"} (Newest first)
                      </span>
                      <button
                        className="table-link"
                        onClick={() => {
                          setQuery("");
                          setBatchFilter("all");
                          setBatchDate("");
                          setBatchMonth("");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                  {batchTable(sortedBatches)}
                </section>
              )}
              {page === "readings" && (
                <div className="space-y-6">
                  <section className="surface">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div>
                        <h2 className="text-xl font-bold text-foreground">
                          Readings & Chamber Telemetry
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Live telemetry and historical conditions across granted chambers.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {operator && <Btn onClick={() => open({ kind: "device" })}><Plus size={16} /> Add device</Btn>}
                        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                          <span>Chamber:</span>
                          <select
                            className="filter-select"
                            value={selectedDevice}
                            onChange={(e) => setSelectedDevice(e.target.value)}
                            aria-label="Filter readings by chamber"
                          >
                            <option value="all">
                              All chambers ({data.devices.length})
                            </option>
                            {data.devices.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.serial_number})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    <LiveConnectionStatus {...live} />
                    {currentReading && <p className="mb-4 text-sm text-muted-foreground">
                      Supply voltage: {currentReading.voltage == null ? "Not reported" : `${currentReading.voltage} V`} · SD card: {currentReading.sd_ok == null ? "Not reported" : currentReading.sd_ok ? "OK" : "Error"}
                    </p>}
                    {readingStale && <p role="status" className="feedback-error mb-4">Showing the last known reading. Waiting for fresh sensor data.</p>}
                    {/* 6 Detailed Sensor Telemetry Cards matching image_e0a5e9.png */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                      {/* 1. Air Temperature */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Thermometer size={16} className="text-emerald-500" />
                            Air Temperature
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.temperature_c &&
                                currentReading.temperature_c >= 21 &&
                                currentReading.temperature_c <= 27
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                              }`}
                          >
                            {currentReading?.temperature_c == null ? "No reading" :
                              currentReading.temperature_c >= 21 &&
                              currentReading.temperature_c <= 27
                              ? "Within range"
                              : "Check range"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.temperature_c !== null &&
                              currentReading?.temperature_c !== undefined
                              ? `${currentReading.temperature_c} °C`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref 21–27 °C
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.temperature_c == null ? [] : [r.temperature_c])}
                            color="#10b981"
                          />
                        </div>
                      </div>

                      {/* 2. Humidity */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Droplets size={16} className="text-blue-500" />
                            Humidity
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.humidity_percent &&
                                currentReading.humidity_percent >= 80 &&
                                currentReading.humidity_percent <= 90
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                              }`}
                          >
                            {currentReading?.humidity_percent == null ? "No reading" :
                              currentReading.humidity_percent >= 80 &&
                              currentReading.humidity_percent <= 90
                              ? "Within range"
                              : "Check range"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.humidity_percent !== null &&
                              currentReading?.humidity_percent !== undefined
                              ? `${currentReading.humidity_percent} %`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref 80–90 %
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.humidity_percent == null ? [] : [r.humidity_percent])}
                            color="#3b82f6"
                          />
                        </div>
                      </div>

                      {/* 3. Fresh-Water Tank */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Droplets size={16} className="text-amber-500" />
                            Fresh-Water Tank
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.water_level_percent &&
                                currentReading.water_level_percent > 40
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                              }`}
                          >
                            {currentReading?.water_level_percent == null ? "No reading" :
                              currentReading.water_level_percent > 40
                              ? "Within range"
                              : "Getting low"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.water_level_percent !== null &&
                              currentReading?.water_level_percent !== undefined
                              ? `${currentReading.water_level_percent} %`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref &gt; 40 %
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.water_level_percent == null ? [] : [r.water_level_percent])}
                            color="#f59e0b"
                          />
                        </div>
                      </div>

                      {/* 4. Water Temperature */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Thermometer size={16} className="text-purple-500" />
                            Water Temperature
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.water_temperature_c &&
                                currentReading.water_temperature_c >= 18 &&
                                currentReading.water_temperature_c <= 22
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                              }`}
                          >
                            {currentReading?.water_temperature_c == null ? "No reading" :
                              currentReading.water_temperature_c >= 18 &&
                              currentReading.water_temperature_c <= 22
                              ? "Within range"
                              : "Check range"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.water_temperature_c !== null &&
                              currentReading?.water_temperature_c !== undefined
                              ? `${currentReading.water_temperature_c} °C`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref 18–22 °C
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.water_temperature_c == null ? [] : [r.water_temperature_c])}
                            color="#8b5cf6"
                          />
                        </div>
                      </div>

                      {/* 5. Light Level */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Sun size={16} className="text-indigo-500" />
                            Light Level
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.light_lux !== null &&
                                currentReading?.light_lux !== undefined &&
                                currentReading.light_lux < 5
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-rose-500/10 text-rose-600"
                              }`}
                          >
                            {currentReading?.light_lux == null ? "No reading" :
                              currentReading.light_lux < 5
                              ? "Nice & dark"
                              : "Light detected"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.light_lux !== null &&
                              currentReading?.light_lux !== undefined
                              ? `${currentReading.light_lux} lux`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref ~0 lux
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.light_lux == null ? [] : [r.light_lux])}
                            color="#6366f1"
                          />
                        </div>
                      </div>

                      {/* 6. Wastewater Tank */}
                      <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:border-border transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Droplets size={16} className="text-cyan-500" />
                            Wastewater Tank
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentReading?.wastewater_level_percent !== null &&
                                currentReading?.wastewater_level_percent !== undefined &&
                                currentReading.wastewater_level_percent < 85
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-rose-500/10 text-rose-600"
                              }`}
                          >
                            {currentReading?.wastewater_level_percent == null ? "No reading" :
                              currentReading.wastewater_level_percent < 85
                              ? "Room available"
                              : "Near full"}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-2xl font-bold tracking-tight text-foreground">
                            {currentReading?.wastewater_level_percent !== null &&
                              currentReading?.wastewater_level_percent !== undefined
                              ? `${currentReading.wastewater_level_percent} %`
                              : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ref &lt; 85 %
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/40">
                          <Spark
                            data={deviceReadings
                              .slice(0, 10).reverse()
                              .flatMap((r) => r.wastewater_level_percent == null ? [] : [r.wastewater_level_percent])}
                            color="#06b6d4"
                          />
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground mb-6">
                      {currentReading
                        ? `Latest reading from ${deviceName(currentReading.device_id)} recorded at ${date(currentReading.recorded_at)}${readingStale
                          ? " · Last known reading — live data unavailable"
                          : ""
                        }`
                        : "No sensor readings available for this chamber selection."}
                    </p>

                    {/* Historical Telemetry Log */}
                    <SectionTitle
                      title="Historical Sensor Telemetry"
                      subtitle="Chronological log of machine-reported chamber sensor packets."
                      action={
                        <div className="telemetry-export-actions">
                        <Btn
                          variant="outline"
                          size="sm"
                          disabled={!deviceReadings.length}
                          onClick={() => {
                            exportCsv(
                              "sproutsync-sensor-readings.csv",
                              telemetryExportHeaders,
                              telemetryExportRows,
                            );
                            setToast(
                              `Downloaded ${deviceReadings.length} sensor ${deviceReadings.length === 1 ? "reading" : "readings"} as CSV.`,
                            );
                          }}
                        >
                          <Download size={15} />
                          Download CSV
                        </Btn>
                        <Btn
                          variant="outline"
                          size="sm"
                          disabled={!deviceReadings.length}
                          onClick={() => {
                            const opened = printBrandedReport(
                              "Historical Sensor Telemetry",
                              selectedDevice === "all"
                                ? "Readings from all chambers"
                                : `Chamber: ${deviceName(Number(selectedDevice))}`,
                              telemetryExportHeaders,
                              telemetryExportRows,
                            );
                            setToast(
                              opened
                                ? "Branded report opened. Choose Save as PDF in the print dialog to download it."
                                : "The report could not open. Allow pop-ups for SproutSync and try again.",
                            );
                          }}
                        >
                          <Printer size={15} />
                          Branded report
                        </Btn>
                        </div>
                      }
                    />
                    {table(
                      [
                        "Chamber",
                        "Air °C",
                        "Humidity %",
                        "Fresh water %",
                        "Water °C",
                        "Light lux",
                        "Wastewater %",
                        "Recorded",
                      ],
                      deviceReadings.map((r) => [
                        deviceName(r.device_id),
                        r.temperature_c !== null ? `${r.temperature_c} °C` : "—",
                        r.humidity_percent !== null ? `${r.humidity_percent} %` : "—",
                        r.water_level_percent !== null ? `${r.water_level_percent} %` : "—",
                        r.water_temperature_c !== null ? `${r.water_temperature_c} °C` : "—",
                        r.light_lux !== null ? `${r.light_lux} lux` : "—",
                        r.wastewater_level_percent !== null ? `${r.wastewater_level_percent} %` : "—",
                        date(r.recorded_at),
                      ]),
                      "No sensor readings recorded for this chamber.",
                    )}
                  </section>

                  {/* 7-Day Water Consumption Chart */}
                  <section className="surface">
                    <SectionTitle
                      title="Water use this week"
                      subtitle="Recorded water consumption over the last seven days."
                    />
                    <WaterUseChart
                      data={Array.from({ length: 7 }, (_, index) => {
                        const day = new Date();
                        day.setHours(0, 0, 0, 0);
                        day.setDate(day.getDate() - 6 + index);
                        const end = new Date(day);
                        end.setDate(end.getDate() + 1);
                        const litres =
                          data.watering
                            .filter(
                              (record) =>
                                new Date(record.occurred_at) >= day &&
                                new Date(record.occurred_at) < end,
                            )
                            .reduce(
                              (sum, record) => sum + record.volume_ml,
                              0,
                            ) / 1000;
                        return {
                          day: day.toLocaleDateString([], {
                            weekday: "short",
                          }),
                          L: Number(litres.toFixed(2)),
                        };
                      })}
                    />
                  </section>
                </div>
              )}
              {page === "irrigation" && (
                <div className="space-y-6">
                  <section className="surface">
                    <SectionTitle
                      title="Irrigation schedule"
                      subtitle="Configured watering intervals and automated triggers."
                      action={
                        operator && (
                          <Btn
                            disabled={!data.devices.length}
                            onClick={() => open({ kind: "schedule" })}
                          >
                            <Plus size={16} />
                            Add schedule
                          </Btn>
                        )
                      }
                    />
                    {table(
                      ["Device", "Next run", "Duration", "Status"],
                      data.schedules.map((s) => [
                        deviceName(s.device_id),
                        date(s.next_run_at),
                        `${s.duration_seconds}s`,
                        s.enabled ? "Enabled" : "Paused",
                      ]),
                      "No irrigation schedules yet.",
                    )}
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="Watering history"
                      subtitle="Logged irrigation events and delivered volume."
                    />
                    {table(
                      ["Device", "Batch", "Water", "Duration", "Time"],
                      data.watering.map((w) => [
                        deviceName(w.device_id),
                        batchName(w.batch_id),
                        `${(w.volume_ml / 1000).toFixed(2)} L`,
                        `${w.duration_seconds}s`,
                        date(w.occurred_at),
                      ]),
                      "No watering events have been received.",
                    )}
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="Water use by batch"
                      action={
                        <Btn
                          variant="outline"
                          disabled={!data.batches.length}
                          onClick={() => {
                            const waterUseRows = data.batches.map((batch) => {
                              const events = data.watering.filter(
                                (watering) => watering.batch_id === batch.id,
                              );
                              return [
                                batch.code,
                                `${(events.reduce((sum, watering) => sum + watering.volume_ml, 0) / 1000).toFixed(2)} L`,
                                events.length,
                              ];
                            });
                            const opened = printBrandedReport(
                              "Water use by batch",
                              "Recorded irrigation totals for each production batch.",
                              ["Batch", "Water used", "Irrigation events"],
                              waterUseRows,
                              {
                                largeWatermark: true,
                                footer:
                                  "Water totals are calculated from recorded irrigation events. Batches with no recorded events show 0.00 L.",
                              },
                            );
                            setToast(
                              opened
                                ? "Water-use report opened. Choose Save as PDF in the print dialog to download it."
                                : "The report could not open. Allow pop-ups for SproutSync and try again.",
                            );
                          }}
                        >
                          <Printer size={16} />
                          Print report
                        </Btn>
                      }
                    />
                    <div className="report-goal">
                      <strong>Report goal</strong>
                      <p>
                        Trace water use back to each production batch so an
                        operator or evaluator can review exceptions with source
                        records intact.
                      </p>
                    </div>
                    {table(
                      ["Batch", "Water used", "Events"],
                      data.batches.map((b) => {
                        const events = data.watering.filter(
                          (w) => w.batch_id === b.id,
                        );
                        return [
                          b.code,
                          `${(events.reduce((sum, w) => sum + w.volume_ml, 0) / 1000).toFixed(2)} L`,
                          events.length,
                        ];
                      }),
                      "No batch data to report.",
                    )}
                  </section>
                </div>
              )}
              {page === "evidence" && (
                <div className="space-y-6">
                  <section className="surface">
                    <SectionTitle
                      title="Evaluation evidence & machine checks"
                      subtitle="Independent sensor proofs and acceptance testing records."
                      action={
                        operator && (
                          <Btn onClick={() => open({ kind: "evidence" })}>
                            <Plus size={16} />
                            Record evidence
                          </Btn>
                        )
                      }
                    />
                    {table(
                      [
                        "Test",
                        "Category",
                        "Batch",
                        "Result",
                        "Notes",
                        "Recorded",
                      ],
                      data.evidence.map((e) => [
                        e.title,
                        e.category.replaceAll("_", " "),
                        batchName(e.batch_id),
                        <Status key="res" value={e.result} />,
                        e.notes,
                        date(e.recorded_at),
                      ]),
                      "No evidence has been recorded yet.",
                    )}
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title={
                        operator ? "Submitted evaluations" : "Your evaluations"
                      }
                      subtitle="Human quality ratings, tasting notes, and visual sprout inspection."
                      action={
                        evaluator && (
                          <Btn
                            disabled={!data.batches.length}
                            onClick={() => open({ kind: "evaluation" })}
                          >
                            <Plus size={16} />
                            Evaluate a batch
                          </Btn>
                        )
                      }
                    />
                    <div className="evaluation-guide mb-5">
                      <div>
                        <p className="role-kicker">Rating basis</p>
                        <h3 className="text-base font-bold text-foreground">
                          Use the standard five-point rubric for every batch
                        </h3>
                        <div
                          className="rating-rubric"
                          aria-label="Evaluation rating guide"
                        >
                          {[
                            [1, "Poor"],
                            [2, "Fair"],
                            [3, "Good"],
                            [4, "Very good"],
                            [5, "Excellent"],
                          ].map(([value, label]) => (
                            <span key={value}>
                              <strong>{value}★</strong>
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="table-toolbar">
                      <label className="search-field">
                        <Search size={17} />
                        <input
                          aria-label="Search evaluations"
                          placeholder="Search batch or observation…"
                          value={evaluationQuery}
                          onChange={(event) =>
                            setEvaluationQuery(event.target.value)
                          }
                        />
                      </label>
                      <select
                        className="filter-select"
                        aria-label="Evaluation batch filter"
                        value={evaluationBatch}
                        onChange={(event) =>
                          setEvaluationBatch(event.target.value)
                        }
                      >
                        <option value="all">All operators & batches</option>
                        {data.batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            Operator #{batch.owner_id} · {batch.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    {table(
                      [
                        "Owner",
                        "Batch",
                        "Rating",
                        "Comments",
                        "Submitted",
                        "Details",
                      ],
                      evaluationRows.map((evaluation) => {
                        const batch = data.batches.find(
                          (item) => item.id === evaluation.batch_id,
                        );
                        return [
                          batch
                            ? `Operator #${batch.owner_id}`
                            : "Unknown operator",
                          <button
                            key="batch"
                            className="table-link"
                            onClick={() =>
                              batch && open({ kind: "batch-details", batch })
                            }
                          >
                            {batchName(evaluation.batch_id)}
                          </button>,
                          <Rating key="rating" value={evaluation.rating} />,
                          evaluation.comments,
                          date(evaluation.created_at),
                          <button
                            key="view"
                            className="table-link"
                            onClick={() =>
                              open({
                                kind: "evaluation-details",
                                evaluation,
                              })
                            }
                          >
                            View <ChevronRight size={14} />
                          </button>,
                        ];
                      }),
                      "No evaluations submitted yet.",
                    )}
                  </section>
                </div>
              )}
              {page === "accounts" && superadmin && (() => {
                const query = accountSearchQuery.toLowerCase().trim();
                const filteredAccounts = accounts.filter((acc) => {
                  if (accountRoleFilter !== "all") {
                    if (accountRoleFilter === "superadmin") {
                      if (acc.role !== "superadmin" && acc.role !== "admin") return false;
                    } else if (acc.role !== accountRoleFilter) {
                      return false;
                    }
                  }
                  if (query) {
                    const name = (acc.display_name || `${acc.first_name} ${acc.last_name}`).toLowerCase();
                    const email = (acc.email || "").toLowerCase();
                    const org = (acc.organization || "").toLowerCase();
                    const role = (acc.role || "").toLowerCase();
                    const idStr = String(acc.id);

                    const serials = Array.from(
                      new Set([
                        ...(acc.serial_numbers || []),
                        ...data.devices
                          .filter((d) => d.owner_id === acc.id && d.serial_number)
                          .map((d) => d.serial_number!),
                      ]),
                    ).map((s) => s.toLowerCase());

                    const matchesText =
                      name.includes(query) ||
                      email.includes(query) ||
                      org.includes(query) ||
                      role.includes(query) ||
                      idStr.includes(query) ||
                      serials.some((s) => s.includes(query));

                    if (!matchesText) return false;
                  }
                  return true;
                });

                return (
                  <div className="space-y-6">
                    <section className="surface accounts-directory-table">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
                        <div>
                          <h3 className="text-base font-bold tracking-tight">Accounts Directory & Governance</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Manage fleet credentials, chamber assignments, and user roles across all tiers.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Btn
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const res = await fetchAccounts();
                                setAccounts(Array.isArray(res) && res.length > 0 ? res : initialAccounts);
                                setToast("Accounts refreshed.");
                              } catch {
                                setAccounts(initialAccounts);
                                setToast("Accounts refreshed with fallback data.");
                              }
                            }}
                          >
                            <RefreshCw size={14} /> Refresh
                          </Btn>
                        </div>
                      </div>

                      {/* TOOLBAR: Search with Intellisense & Role Filter */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 pb-2">
                        {/* Search bar with intellisense popup */}
                        <div className="relative flex-1 max-w-md">
                          <div className="relative flex items-center">
                            <Search size={15} className="absolute left-3 text-muted-foreground pointer-events-none" />
                            <input
                              type="text"
                              placeholder="Search accounts by name, email, serial..."
                              value={accountSearchQuery}
                              onChange={(e) => {
                                setAccountSearchQuery(e.target.value);
                                setShowSearchSuggestions(true);
                              }}
                              onFocus={() => setShowSearchSuggestions(true)}
                              className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            {accountSearchQuery && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAccountSearchQuery("");
                                  setShowSearchSuggestions(false);
                                }}
                                className="absolute right-2.5 text-muted-foreground hover:text-foreground"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>

                          {/* Intellisense Overlay & Dropdown Popup */}
                          {showSearchSuggestions && query.length > 0 && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowSearchSuggestions(false)}
                              />
                              <div className="absolute z-20 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                                {(() => {
                                  const suggestions: {
                                    key: string;
                                    label: string;
                                    subtext: string;
                                    value: string;
                                    badge: string;
                                  }[] = [];

                                  accounts.forEach((acc) => {
                                    const name = acc.display_name || `${acc.first_name} ${acc.last_name}`.trim();
                                    if (name.toLowerCase().includes(query) || acc.email.toLowerCase().includes(query)) {
                                      suggestions.push({
                                        key: `user-${acc.id}`,
                                        label: name,
                                        subtext: `${acc.email} · ID #${acc.id}`,
                                        value: name,
                                        badge: acc.role,
                                      });
                                    }
                                    const serials = Array.from(
                                      new Set([
                                        ...(acc.serial_numbers || []),
                                        ...data.devices
                                          .filter((d) => d.owner_id === acc.id && d.serial_number)
                                          .map((d) => d.serial_number!),
                                      ]),
                                    );
                                    serials.forEach((s) => {
                                      if (s.toLowerCase().includes(query)) {
                                        suggestions.push({
                                          key: `serial-${acc.id}-${s}`,
                                          label: s,
                                          subtext: `Assigned to ${name}`,
                                          value: s,
                                          badge: "serial",
                                        });
                                      }
                                    });
                                  });

                                  if (suggestions.length === 0) {
                                    return (
                                      <div className="p-3 text-xs text-muted-foreground italic text-center">
                                        No matching accounts or serial numbers
                                      </div>
                                    );
                                  }

                                  return suggestions.slice(0, 6).map((item) => (
                                    <button
                                      key={item.key}
                                      type="button"
                                      className="w-full px-3 py-2 text-left hover:bg-secondary flex items-center justify-between text-xs transition-colors border-b last:border-b-0 border-border/50"
                                      onClick={() => {
                                        setAccountSearchQuery(item.value);
                                        setShowSearchSuggestions(false);
                                      }}
                                    >
                                      <div>
                                        <span className="font-semibold text-foreground">{item.label}</span>
                                        <span className="block text-[11px] text-muted-foreground">{item.subtext}</span>
                                      </div>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-medium bg-secondary text-muted-foreground">
                                        {item.badge}
                                      </span>
                                    </button>
                                  ));
                                })()}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Role Filter */}
                        <div className="flex items-center gap-2">
                          <label htmlFor="account-role-filter" className="text-xs text-muted-foreground whitespace-nowrap">
                            Filter Role:
                          </label>
                          <select
                            id="account-role-filter"
                            value={accountRoleFilter}
                            onChange={(e) => setAccountRoleFilter(e.target.value)}
                            className="text-xs rounded-lg border border-border bg-background px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="all">All Roles ({accounts.length})</option>
                            <option value="operator">Operators ({accounts.filter((a) => a.role === "operator").length})</option>
                            <option value="evaluator">Evaluators ({accounts.filter((a) => a.role === "evaluator").length})</option>
                            <option value="superadmin">
                              Superadmins ({accounts.filter((a) => a.role === "superadmin" || a.role === "admin").length})
                            </option>
                            <option value="pending">Pending ({accounts.filter((a) => a.role === "pending").length})</option>
                          </select>
                        </div>
                      </div>

                      {/* UNIFIED TABLE */}
                      {table(
                        ["User", "Email", "Role", "Assigned Serials / Scope", "Status", "Actions"],
                        filteredAccounts.map((acc) => {
                          const isOp = acc.role === "operator";
                          const liveSerials = Array.from(
                            new Set([
                              ...(acc.serial_numbers || []),
                              ...data.devices
                                .filter((d) => d.owner_id === acc.id && d.serial_number)
                                .map((d) => d.serial_number!),
                            ]),
                          );
                          const evalCount =
                            (acc.evaluators && acc.evaluators.length) ||
                            data.access.filter((a) => a.owner_id === acc.id).length ||
                            acc.evaluator_grant_count ||
                            0;

                          const roleBadge = (() => {
                            if (acc.role === "superadmin" || acc.role === "admin") {
                              return (
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                                  Superadmin
                                </span>
                              );
                            }
                            if (acc.role === "operator") {
                              return (
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  Operator
                                </span>
                              );
                            }
                            if (acc.role === "evaluator") {
                              return (
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                  Evaluator
                                </span>
                              );
                            }
                            return (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                Pending
                              </span>
                            );
                          })();

                          const scopeCell = (() => {
                            if (isOp) {
                              return liveSerials.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {liveSerials.map((s) => (
                                    <span
                                      key={s}
                                      className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-mono text-xs font-semibold"
                                    >
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs italic">No serials assigned</span>
                              );
                            }
                            if (acc.role === "evaluator") {
                              return (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <ClipboardCheck size={13} className="text-blue-500" /> Linked Evaluator
                                </span>
                              );
                            }
                            if (acc.role === "superadmin" || acc.role === "admin") {
                              return (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <ShieldCheck size={13} className="text-purple-500" /> Fleet Governance
                                </span>
                              );
                            }
                            return (
                              <span className="text-xs text-amber-600 dark:text-amber-400 italic flex items-center gap-1">
                                <Clock size={13} /> Awaiting Verification
                              </span>
                            );
                          })();

                          return [
                            <div key="name">
                              <strong>
                                {acc.display_name || `${acc.first_name} ${acc.last_name}`.trim() || "Unnamed"}
                              </strong>
                              <small className="block text-muted-foreground text-xs">
                                ID #{acc.id} {acc.organization ? `· ${acc.organization}` : ""}
                              </small>
                            </div>,
                            acc.email,
                            roleBadge,
                            scopeCell,
                            <Status key="status" value={acc.is_active ? "active" : "offline"} />,
                            <div key="actions" className="flex items-center gap-1.5">
                              {isOp && (
                                <>
                                  <Btn
                                    variant="outline"
                                    size="sm"
                                    className="text-xs px-2 py-1 h-7 text-primary border-primary/30 hover:bg-primary/10"
                                    onClick={() => open({ kind: "superadmin-grant-serial", operator_id: acc.id })}
                                    title="Grant Serial Number"
                                  >
                                    <Plus size={12} className="mr-0.5" /> Serial
                                  </Btn>
                                  <button
                                    type="button"
                                    title={`Linked Evaluators (${evalCount})`}
                                    className={`p-1.5 rounded-md border text-xs flex items-center gap-1 transition-colors ${expandedOperatorId === acc.id
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "border-border hover:bg-secondary text-muted-foreground hover:text-foreground"
                                      }`}
                                    onClick={() =>
                                      setExpandedOperatorId(expandedOperatorId === acc.id ? null : acc.id)
                                    }
                                  >
                                    <Users size={14} />
                                    <span className="font-semibold text-xs">{evalCount}</span>
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                title="Edit Account"
                                className="p-1.5 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => open({ kind: "superadmin-account-edit", account: acc })}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                title={acc.id === profile.id ? "Cannot delete own account" : "Delete Account"}
                                disabled={acc.id === profile.id}
                                className="p-1.5 rounded-md border border-destructive/20 hover:bg-destructive/10 text-destructive disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                onClick={() => open({ kind: "superadmin-account-delete", account: acc })}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>,
                          ];
                        }),
                        "No accounts match the current search query or filter.",
                      )}

                      {/* EXPANDABLE EVALUATORS DRAWER */}
                      {expandedOperatorId !== null && (() => {
                        const op = accounts.find((a) => a.id === expandedOperatorId);
                        if (!op) return null;
                        return (
                          <div className="mt-4 p-4 rounded-xl bg-secondary/40 border border-border">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Users size={16} className="text-primary" />
                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                  Evaluators Linked to {op.display_name || op.email} (ID #{op.id})
                                </h4>
                              </div>
                              <Btn
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  open({
                                    kind: "superadmin-assign-evaluator",
                                    operator_id: op.id,
                                  })
                                }
                              >
                                <UserPlus size={14} /> Assign Evaluator
                              </Btn>
                            </div>
                            {table(
                              ["Evaluator Name", "Email", "Granted At", "Actions"],
                              (op.evaluators || []).map((ev) => [
                                ev.display_name || ev.email,
                                ev.email,
                                date(ev.granted_at),
                                <div key="actions" className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    title="Edit Evaluator"
                                    className="p-1.5 rounded-md border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"
                                    onClick={() => open({ kind: "operator-evaluator-edit", evaluator: ev })}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <Btn
                                    key="reassign"
                                    size="sm"
                                    variant="outline"
                                    className="text-xs px-2 py-1 h-7"
                                    onClick={() =>
                                      open({
                                        kind: "superadmin-assign-evaluator",
                                        evaluator_id: ev.id,
                                        operator_id: op.id,
                                      })
                                    }
                                  >
                                    Reassign
                                  </Btn>
                                </div>,
                              ]),
                              "No evaluators linked to this operator yet.",
                            )}
                          </div>
                        );
                      })()}
                    </section>
                  </div>
                );
              })()}
              {page === "audit" && superadmin && (
                (() => {
                  const search = auditQuery.trim().toLowerCase();
                  const events = data.activity.filter((event) =>
                    `${event.action} ${event.resource} ${event.created_at}`
                      .toLowerCase()
                      .includes(search),
                  );
                  return (
                    <section className="surface audit-log">
                      <SectionTitle
                        title="System Audit Log"
                        subtitle="Review administrative changes and access activity. Newest events appear first."
                      />
                      <div className="audit-toolbar">
                        <label className="audit-search">
                          <Search size={16} aria-hidden="true" />
                          <span className="sr-only">Search audit events</span>
                          <input
                            type="search"
                            aria-label="Search audit events"
                            value={auditQuery}
                            onChange={(event) => setAuditQuery(event.target.value)}
                            placeholder="Search by action, target, or date"
                          />
                          {auditQuery && (
                            <button
                              type="button"
                              aria-label="Clear audit search"
                              onClick={() => setAuditQuery("")}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </label>
                        <span className="audit-result-count" aria-live="polite">
                          {events.length} {events.length === 1 ? "event" : "events"}
                          {search ? " found" : " recorded"}
                        </span>
                      </div>
                      {table(
                        ["Action", "Resource / Target", "Time"],
                        events.map((event) => [
                          <span key="action" className="audit-action">
                            {event.action.replace(/[_-]+/g, " ")}
                          </span>,
                          <span key="resource" className="audit-resource">
                            {event.resource}
                          </span>,
                          <time
                            key="time"
                            className="audit-time"
                            dateTime={event.created_at}
                          >
                            {date(event.created_at)}
                          </time>,
                        ]),
                        search
                          ? "No audit events match your search. Try another action, target, or date."
                          : "No administrative activity recorded yet.",
                      )}
                    </section>
                  );
                })()
              )}
              {page === "alerts" && (
                <section className="surface">
                  <SectionTitle
                    title="Alerts & history"
                    subtitle={`${activeAlerts.length} active alerts`}
                    action={
                      operator && (
                        <Btn onClick={() => open({ kind: "incident-report" })}>
                          <Plus size={16} />
                          Report current situation
                        </Btn>
                      )
                    }
                  />
                  {data.alerts.length ? (
                    <div className="space-y-3">
                      {data.alerts.map((alert) => (
                        <button
                          key={alert.id}
                          className="alert-row"
                          onClick={() => open({ kind: "alert", alert })}
                        >
                          <span className={`alert-symbol ${alert.severity}`}>
                            <Bell size={20} />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <strong>{alert.title}</strong>
                            <small>
                              {alert.batch_id
                                ? `Batch ${batchName(alert.batch_id)} · `
                                : "No batch linked · "}
                              {date(alert.created_at)}
                            </small>
                          </span>
                          <Status value={alert.status} />
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty text="No alerts have been recorded." />
                  )}
                  <div className="mt-6 border-t border-border pt-5">
                    <SectionTitle
                      title="Risk & incident categories"
                      subtitle="Use the alert message to state the current problem, location, and recommended response."
                    />
                    <div className="sensor-scope-grid">
                      {[
                        [
                          "Pests or external contamination",
                          "Record the affected room or tray",
                        ],
                        [
                          "Water contamination",
                          "Identify the batch and water source",
                        ],
                        [
                          "Compliance risk",
                          "State the failed check or missing evidence",
                        ],
                        [
                          "Light leak",
                          "Specify the chamber, door, or seal location",
                        ],
                      ].map(([name, purpose]) => (
                        <div key={name}>
                          <span className="summary-icon">
                            <Bell size={18} />
                          </span>
                          <strong>{name}</strong>
                          <small>{purpose}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
              {page === "system" && operator && (
                <div className="space-y-6">
                  <section className="surface">
                    <SectionTitle
                      title="Sensors & chamber equipment"
                      subtitle="Identify every chamber by its printed serial number and latest heartbeat."
                      action={<Btn onClick={() => open({ kind: "device" })}><Plus size={16} /> Add device</Btn>}
                    />
                    <LiveConnectionStatus {...live} />
                    {table(
                      ["Equipment", "Serial number", "Connection", "Last seen", "MQTT topic"],
                      data.devices.map((d) => [
                        d.name,
                        d.serial_number,
                        <Status
                          key="conn"
                          value={
                            d.status === "online" &&
                              !d.is_demo &&
                              (!d.last_seen_at ||
                                Date.now() -
                                new Date(d.last_seen_at).getTime() >
                                300000)
                              ? "offline"
                              : d.status
                          }
                        />,
                        date(d.last_seen_at),
                        d.mqtt_topic_prefix ? `${d.mqtt_topic_prefix}/telemetry` : "Not connected",
                      ]),
                      "No equipment linked yet.",
                    )}
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="Monitoring coverage"
                      subtitle="A value appears only after the matching sensor reports it."
                    />
                    <div className="sensor-scope-grid">
                      {[
                        ["Water level", "Reservoir availability"],
                        ["Light", "Unexpected chamber light"],
                        ["Temperature & humidity", "Growing conditions"],
                        ["Water flow", "Irrigation delivery"],
                        ["Pump", "Pump operating state"],
                        ["Room", "Ambient environment"],
                        ["Trays", "Tray position and condition"],
                        ["Local display", "On-device status and warning message"],
                      ].map(([name, purpose]) => (
                        <div key={name}>
                          <span className="summary-icon">
                            <Cpu size={18} />
                          </span>
                          <strong>{name}</strong>
                          <small>{purpose}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="Maintenance records"
                      action={
                        <Btn
                          disabled={!data.devices.length}
                          onClick={() => open({ kind: "maintenance" })}
                        >
                          <Plus size={16} />
                          Record maintenance
                        </Btn>
                      }
                    />
                    {table(
                      ["Device", "Notes", "Performed"],
                      data.maintenance.map((m) => [
                        deviceName(m.device_id),
                        m.notes,
                        date(m.performed_at),
                      ]),
                      "No maintenance records yet.",
                    )}
                  </section>
                  {/* PENDING REQUESTS SECTION FOR OPERATOR */}
                  <section className="surface">
                    <SectionTitle
                      title="Pending Evaluator Requests"
                      subtitle="Users who requested evaluator access to inspect your chamber batches."
                      action={
                        <Btn
                          variant="outline"
                          onClick={() => {
                            fetchAccessRequests()
                              .then(setAccessRequests)
                              .catch(console.error);
                          }}
                        >
                          <RefreshCw size={14} /> Refresh
                        </Btn>
                      }
                    />
                    {table(
                      ["Requester", "Email", "Requested At", "Actions"],
                      accessRequests.map((req) => [
                        req.evaluator_name || "New Evaluator",
                        req.evaluator_email || "—",
                        date(req.created_at),
                        <div key="actions" className="flex items-center gap-2">
                          <Btn
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await approveAccessRequest(req.id);
                                setToast(
                                  "Access request approved. Evaluator can now inspect your batches.",
                                );
                                const updatedReqs = await fetchAccessRequests();
                                setAccessRequests(updatedReqs);
                                const updatedEvals =
                                  await fetchOperatorEvaluators();
                                setOperatorEvaluators(updatedEvals);
                              } catch (e) {
                                setToast(errorMessage(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <CheckCircle2 size={14} /> Approve
                          </Btn>
                          <Btn
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await declineAccessRequest(req.id);
                                setToast("Access request declined.");
                                const updatedReqs = await fetchAccessRequests();
                                setAccessRequests(updatedReqs);
                              } catch (e) {
                                setToast(errorMessage(e));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <X size={14} /> Decline
                          </Btn>
                        </div>,
                      ]),
                      "No pending evaluator access requests.",
                    )}
                  </section>

                  {/* MY EVALUATORS SECTION */}
                  <section className="surface">
                    <SectionTitle
                      title="My Evaluators"
                      subtitle="Independent evaluators authorized to inspect your chamber batches."
                      action={
                        <Btn onClick={() => open({ kind: "access" })}>
                          <Plus size={16} />
                          Grant by Email
                        </Btn>
                      }
                    />
                    {table(
                      [
                        "Evaluator Name",
                        "Email",
                        "Status",
                        "Granted At",
                        "Actions",
                      ],
                      operatorEvaluators.map((ev) => [
                        ev.display_name || "Unnamed",
                        ev.email,
                        <Status
                          key="status"
                          value={ev.is_active ? "active" : "offline"}
                        />,
                        date(ev.granted_at),
                        <Btn
                          key="edit"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            open({
                              kind: "operator-evaluator-edit",
                              evaluator: ev,
                            })
                          }
                        >
                          Edit Name/Email
                        </Btn>,
                      ]),
                      "No evaluators linked to your chambers yet.",
                    )}
                  </section>
                </div>
              )}
              {page === "settings" && (
                <div className="grid gap-5 xl:grid-cols-2">
                  <section className="surface">
                    <PersonalDetails
                      editing
                      identityLocked
                      profile={profile}
                      onRequestSupport={() => open({ kind: "support" })}
                      onSaved={(next) => {
                        onProfile(next);
                        setToast("Contact details saved.");
                      }}
                    />
                  </section>
                  <section className="surface">
                    <SectionTitle title="Notifications & account" />
                    <Preferences
                      userId={profile.id}
                      onChange={setPreferences}
                    />
                    <div className="my-6 border-t border-border" />
                    <p className="mb-4 text-sm text-muted-foreground">
                      Signed in as {profile.email}
                    </p>
                    <Btn
                      variant="outline"
                      onClick={() => open({ kind: "signout" })}
                    >
                      <LogOut size={16} />
                      Sign out
                    </Btn>
                  </section>
                  <section className="surface">
                    <SectionTitle
                      title="Help & support"
                      subtitle="Share the affected screen and what you were trying to do."
                    />
                    <Btn variant="outline" onClick={() => open({ kind: "support" })}>
                      <LifeBuoy size={16} />
                      Request support
                    </Btn>
                  </section>
                </div>
              )}
            </motion.div>
          )}
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map((item) => (
          <button
            key={item.key}
            aria-current={page === item.key ? "page" : undefined}
            onClick={() => navigate(item.key)}
          >
            <item.icon size={20} />
            <span>{item.title === "Overview" ? "Home" : item.title}</span>
          </button>
        ))}
        {nav.length > 4 && (
          <button aria-expanded={menu} onClick={() => setMenu(true)}>
            <MoreHorizontal size={21} />
            <span>More</span>
          </button>
        )}
      </nav>
      <Modal
        open={menu}
        onClose={() => setMenu(false)}
        title="Explore SproutSync"
      >
        <div className="grid grid-cols-2 gap-2">
          {nav.slice(4).map((item) => (
            <button
              key={item.key}
              className="more-nav-item"
              onClick={() => navigate(item.key)}
            >
              <item.icon size={19} />
              {item.title}
            </button>
          ))}
          <button
            className="more-nav-item"
            onClick={() => {
              setMenu(false);
              open({ kind: "help" });
            }}
          >
            <HelpCircle size={19} />
            Help & role guide
          </button>
        </div>
      </Modal>
      <Modal
        open={!!dialog}
        onClose={close}
        className={dialog?.kind === "help" ? "sm:max-w-2xl" : ""}
        title={
          dialog?.kind === "signout"
            ? "Are you sure you want to sign out?"
            : dialog?.kind === "batch-details"
              ? `Inspect Batch · ${dialog.batch!.code}`
              : dialog?.kind === "evaluation-details"
                ? `Evaluation · ${batchName(dialog.evaluation!.batch_id)}`
                : dialog?.kind === "alert"
                  ? dialog.alert!.title
                  : dialog?.kind === "superadmin-account-edit"
                    ? `Edit User Account · ${dialog.account?.display_name || dialog.account?.email}`
                    : dialog?.kind === "superadmin-account-delete"
                      ? `Delete User Account · ${dialog.account?.display_name || dialog.account?.email}`
                      : dialog?.kind === "superadmin-grant-serial"
                        ? "Grant Hardware Chamber Serial ID to Operator"
                        : dialog?.kind === "superadmin-assign-evaluator"
                          ? "Assign Evaluator to Operator"
                          : dialog?.kind === "operator-evaluator-edit"
                            ? `Edit Evaluator Details · ${dialog.evaluator?.display_name || dialog.evaluator?.email}`
                            : ({
                              "batch-create": "Create batch",
                              device: "Add device",
                              schedule: "Add irrigation schedule",
                              evidence: "Record evidence",
                              evaluation: "Evaluate batch",
                              maintenance: "Record maintenance",
                              access: "Grant evaluator access",
                              notifications: "Notifications",
                              help: "Help & FAQ",
                              support: "Request support",
                              "incident-report": "Report current situation",
                              readings: "Sensor history",
                            }[dialog?.kind ?? ""] ?? "")
        }
      >
        {dialogError && (
          <p role="alert" className="feedback-error mb-4">
            {dialogError}
          </p>
        )}
        {dialog?.kind === "device" && operator && <DeviceConnectionForm
          devices={data.devices} mqtt={live.mqtt} liveError={live.error}
          onSaved={(device) => setData((current) => ({ ...current, devices: current.devices.some((d) => d.id === device.id) ? current.devices.map((d) => d.id === device.id ? { ...d, ...device } : d) : [device, ...current.devices] }))}
          onDone={(deviceId) => { close(); if (deviceId !== undefined) { setSelectedDevice(String(deviceId)); navigate("readings"); } }}
        />}
        {dialog?.kind === "signout" && (
          <div className="mt-6 flex justify-end gap-3">
            <Btn disabled={busy} variant="outline" onClick={close}>
              No
            </Btn>
            <Btn
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSignOut();
                } catch (e) {
                  setDialogError(errorMessage(e));
                  setBusy(false);
                }
              }}
            >
              {busy ? "Signing out…" : "Yes"}
            </Btn>
          </div>
        )}
        {dialog?.kind === "readings" &&
          table(
            [
              "Device",
              "Air °C",
              "Humidity %",
              "Fresh water %",
              "Water °C",
              "Light lux",
              "Wastewater %",
              "Recorded",
            ],
            data.readings
              .filter(
                (reading) =>
                  selectedDevice === "all" ||
                  reading.device_id === Number(selectedDevice),
              )
              .map((reading) => [
                deviceName(reading.device_id),
                reading.temperature_c ?? "—",
                reading.humidity_percent ?? "—",
                reading.water_level_percent ?? "—",
                reading.water_temperature_c ?? "—",
                reading.light_lux ?? "—",
                reading.wastewater_level_percent ?? "—",
                date(reading.recorded_at),
              ]),
            "No sensor readings yet.",
          )}
        {dialog?.kind === "help" && (
            <div className="help-guide space-y-6">
              <section className="help-hero relative overflow-hidden rounded-2xl border border-emerald-100 p-5 sm:p-6">
                <div className="relative z-10 max-w-lg">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                    SproutSync workspace guide
                  </span>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-emerald-950 sm:text-2xl">
                    Grow with confidence.
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-emerald-900/80">
                    Find your way around the workspace, understand who can do what,
                    and know where readings and records come from.
                  </p>
                </div>
                <span className="help-hero-mark" aria-hidden="true">
                  <Logo className="h-36 w-36" />
                </span>
              </section>

              <section aria-labelledby="help-areas-title">
                <h3 id="help-areas-title" className="text-sm font-bold text-foreground">
                  Find what you need
                </h3>
                <div className="help-area-grid mt-3">
                  {[
                    ["Overview", "Check today’s conditions, priorities, and active batches."],
                    ["Production", "Review batches, watering activity, and production records."],
                    ["Alerts", "Read alerts and document a current situation."],
                    ["Review", "Check evidence and independent batch evaluations."],
                    ["System", "Manage equipment, access, and workspace administration."],
                  ].map(([title, description], index) => (
                    <div className="help-area-card" key={title}>
                      <span className="help-area-number">0{index + 1}</span>
                      <div>
                        <strong>{title}</strong>
                        <p>{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="help-faq-title">
                <h3 id="help-faq-title" className="text-sm font-bold text-foreground">
                  Frequently asked questions
                </h3>
                <div className="help-faq-list mt-3">
                  <details>
                    <summary>Who can change production records?</summary>
                    <p>
                      Operators manage production records and evaluator access.
                      Evaluators can review only batches shared with them and submit
                      an assessment; they cannot change machine readings.
                    </p>
                  </details>
                  <details>
                    <summary>Where do chamber readings come from?</summary>
                    <p>
                      Readings are shown when a connected chamber reports them.
                      The workspace does not let users rewrite machine telemetry.
                    </p>
                  </details>
                  <details>
                    <summary>Are sample records real production data?</summary>
                    <p>
                      Sample records are labelled and saved in this workspace.
                      Check the record labels before using information for
                      operational decisions.
                    </p>
                  </details>
                  <details>
                    <summary>How do I get help with account or device access?</summary>
                    <p>
                      Contact your system operator. The in-app support request
                      isn’t connected yet, so it won’t send a message.
                    </p>
                  </details>
                </div>
              </section>
            </div>
          )}
        {dialog?.kind === "support" && (
          <div className="space-y-4">
            <div className="unavailable-action">
              <LifeBuoy size={22} />
              <span>
                <strong>Support submission is not connected yet</strong>
                <small>
                  The request form will be enabled after an Admin IT support
                  destination and response process are configured.
                </small>
              </span>
            </div>
            <label className="field">
              Affected area
              <select disabled defaultValue="">
                <option value="">Select an area…</option>
                <option>Production</option>
                <option>Alerts</option>
                <option>Review</option>
                <option>Sensors & equipment</option>
                <option>Account access</option>
              </select>
            </label>
            <label className="field">
              What happened?
              <textarea disabled rows={4} placeholder="Describe the problem and expected result" />
            </label>
            <Btn disabled className="w-full">Send support request</Btn>
          </div>
        )}
        {dialog?.kind === "incident-report" && (
          <div className="space-y-5">
            <div className="unavailable-action">
              <ShieldCheck size={22} />
              <span>
                <strong>UI draft only</strong>
                <small>
                  Incident submission is not connected yet. You can review the
                  required information, but no report will be saved.
                </small>
              </span>
            </div>
            <ol className="sop-steps" aria-label="Incident response SOP">
              <li><strong>1. Describe</strong><span>State the current problem.</span></li>
              <li><strong>2. Locate</strong><span>Specify the chamber, fan, seal, tray, or water source.</span></li>
              <li><strong>3. Link</strong><span>Connect the affected batch and equipment serial number.</span></li>
              <li><strong>4. Escalate</strong><span>Record the safe response and notify the responsible role.</span></li>
            </ol>
            <label className="field">
              Current situation
              <textarea rows={3} placeholder="What is happening now?" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                Affected location or component
                <input
                  list="incident-components"
                  placeholder="Type or select, for example 3D fan"
                />
                <datalist id="incident-components">
                  <option value="3D fan" />
                  <option value="Chamber door or seal" />
                  <option value="Water reservoir" />
                  <option value="Pump" />
                  <option value="Room" />
                  <option value="Tray" />
                </datalist>
              </label>
              <label className="field">
                Affected batch
                <input
                  list="incident-batches"
                  placeholder="Type a batch code or leave unlinked"
                />
                <datalist id="incident-batches">
                  {data.batches.map((batch) => (
                    <option key={batch.id} value={batch.code} />
                  ))}
                </datalist>
              </label>
            </div>
            <label className="field">
              Risk category
              <select defaultValue="">
                <option value="" disabled>Select a risk…</option>
                <option>Pests or external contamination</option>
                <option>Water contamination</option>
                <option>Compliance risk</option>
                <option>Light leak</option>
                <option>Equipment problem</option>
              </select>
            </label>
            <label className="field">
              Screen or LCD message
              <input placeholder="Copy the exact message, or write None" />
            </label>
            <label className="field">
              Immediate safe action taken
              <textarea rows={3} placeholder="What was checked, isolated, or escalated?" />
            </label>
            <Btn disabled className="w-full">Submit incident report</Btn>
          </div>
        )}
        {dialog?.kind === "notifications" &&
          (notificationAlerts.length ? (
            <div className="space-y-3">
              {notificationAlerts.map((a) => (
                <button
                  key={a.id}
                  className={`alert-row notification-alert ${a.severity}`}
                  onClick={() => open({ kind: "alert", alert: a })}
                >
                  <span className={`alert-symbol ${a.severity}`} aria-hidden="true">
                    <Bell size={18} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <strong>{a.title}</strong>
                    {a.message && (
                      <span className="notification-message">{a.message}</span>
                    )}
                    <span className="notification-meta">
                      <small>{date(a.created_at)}</small>
                      <span className={`notification-severity ${a.severity}`}>
                        {a.severity === "critical"
                          ? "Critical"
                          : a.severity === "warning"
                            ? "Warning"
                            : "Info"}
                      </span>
                    </span>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty text="You’re all caught up. No new notifications." />
          ))}
        {dialog?.kind === "alert" && (
          <div className="space-y-4">
            <Status value={dialog.alert!.status} />
            <p className="text-sm font-semibold">
              {dialog.alert!.batch_id
                ? `Batch ${batchName(dialog.alert!.batch_id)}`
                : "No batch is linked to this alert"}
            </p>
            <dl className="detail-grid">
              <div>
                <dt>Category</dt>
                <dd>{dialog.alert!.category.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>{dialog.alert!.severity}</dd>
              </div>
            </dl>
            <p>{dialog.alert!.message}</p>
            <section className="rounded-xl bg-secondary p-4">
              <h3 className="font-semibold">Recommended action</h3>
              <p className="mt-1 text-sm">
                {dialog.alert!.recommended_action ||
                  "Inspect the device and review its latest readings."}
              </p>
            </section>
            <p className="text-xs text-muted-foreground">
              {date(dialog.alert!.created_at)}
            </p>
            {operator && dialog.alert!.status !== "resolved" && (
              <div className="flex gap-3">
                <Btn
                  disabled={busy || dialog.alert!.status === "acknowledged"}
                  variant="outline"
                  onClick={() =>
                    void mutate(
                      () =>
                        supabase
                          .from("alerts")
                          .update({ status: "acknowledged" })
                          .eq("id", dialog.alert!.id)
                          .select()
                          .single(),
                      "Alert acknowledged.",
                    )
                  }
                >
                  Acknowledge
                </Btn>
                <Btn
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        supabase
                          .from("alerts")
                          .update({ status: "resolved" })
                          .eq("id", dialog.alert!.id)
                          .select()
                          .single(),
                      "Alert resolved.",
                    )
                  }
                >
                  Resolve
                </Btn>
              </div>
            )}
          </div>
        )}
        {dialog?.kind === "evaluation-details" && (
          <div className="space-y-5">
            <dl className="detail-grid">
              <div>
                <dt>Batch</dt>
                <dd>{batchName(dialog.evaluation!.batch_id)}</dd>
              </div>
              <div>
                <dt>Human assessment</dt>
                <dd><Rating value={dialog.evaluation!.rating} /></dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{date(dialog.evaluation!.created_at)}</dd>
              </div>
              <div>
                <dt>Evaluator qualification</dt>
                <dd>Not yet verified</dd>
              </div>
            </dl>
            <section className="rounded-xl bg-secondary p-4">
              <h3 className="font-semibold">Observations</h3>
              <p className="mt-1 text-sm">
                {dialog.evaluation!.comments || "No observations provided."}
              </p>
            </section>
            <div className="unavailable-action">
              <span>
                <strong>Edit or delete evaluation</strong>
                <small>
                  These actions remain unavailable until audit-history and
                  correction rules are implemented.
                </small>
              </span>
              <div className="flex gap-2">
                <Btn variant="outline" disabled>Edit</Btn>
                <Btn variant="outline" disabled>Delete</Btn>
              </div>
            </div>
          </div>
        )}
        {dialog?.kind === "batch-details" && (
          <div className="space-y-6">
            {/* 1. Header Summary */}
            <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold text-foreground">
                    {dialog.batch!.code}
                  </span>
                  <Status value={dialog.batch!.stage} />
                  <Status value={dialog.batch!.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Owner: <strong>Operator #{dialog.batch!.owner_id}</strong>
                </div>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Crop / Seed</dt>
                  <dd className="font-semibold text-foreground">
                    {dialog.batch!.seed_type}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd className="font-semibold text-foreground">
                    {date(dialog.batch!.started_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Target Harvest</dt>
                  <dd className="font-semibold text-foreground">
                    {date(dialog.batch!.target_harvest_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Average Rating</dt>
                  <dd className="font-semibold text-foreground">
                    {(() => {
                      const bEvals = data.evaluations.filter(
                        (e) => e.batch_id === dialog.batch!.id,
                      );
                      if (!bEvals.length) return "Unrated";
                      const avg = Math.round(
                        bEvals.reduce((s, e) => s + e.rating, 0) / bEvals.length,
                      );
                      return `${avg}/5 ★ (${bEvals.length})`;
                    })()}
                  </dd>
                </div>
              </dl>
              {dialog.batch!.notes && (
                <p className="mt-3 text-xs text-muted-foreground bg-card/60 p-2.5 rounded-xl border border-border/40">
                  <strong>Notes:</strong> {dialog.batch!.notes}
                </p>
              )}
            </div>

            {/* 2. Latest Chamber Telemetry Snapshot */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <Activity size={16} className="text-primary" />
                Current Chamber Environment
              </h3>
              {currentReading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Air Temp
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.temperature_c ?? "—"} °C
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Humidity
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.humidity_percent ?? "—"} %
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Fresh Water
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.water_level_percent ?? "—"} %
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Water Temp
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.water_temperature_c ?? "—"} °C
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Light Level
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.light_lux ?? "—"} lux
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-card border border-border/80">
                    <span className="block text-xs text-muted-foreground">
                      Wastewater
                    </span>
                    <strong className="text-sm text-foreground">
                      {currentReading.wastewater_level_percent ?? "—"} %
                    </strong>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No telemetry recorded for this batch's chamber yet.
                </p>
              )}
            </div>

            {/* 3. Watering History for this Batch */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <Droplets size={16} className="text-blue-500" />
                Irrigation Delivered to {dialog.batch!.code}
              </h3>
              {(() => {
                const batchWatering = data.watering.filter(
                  (w) => w.batch_id === dialog.batch!.id,
                );
                if (!batchWatering.length) {
                  return (
                    <p className="text-xs text-muted-foreground">
                      No watering events logged for this batch.
                    </p>
                  );
                }
                return (
                  <div className="rounded-xl border border-border/80 overflow-hidden">
                    <table className="record-table text-xs">
                      <thead>
                        <tr>
                          <th>Volume</th>
                          <th>Duration</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchWatering.slice(0, 5).map((w) => (
                          <tr key={w.id}>
                            <td>{(w.volume_ml / 1000).toFixed(2)} L</td>
                            <td>{w.duration_seconds}s</td>
                            <td>{date(w.occurred_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* 4. Acceptance Evidence for this Batch */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                Evidence & Verification Checks
              </h3>
              {(() => {
                const batchEvidence = data.evidence.filter(
                  (e) => e.batch_id === dialog.batch!.id,
                );
                if (!batchEvidence.length) {
                  return (
                    <p className="text-xs text-muted-foreground">
                      No evidence records logged for this batch.
                    </p>
                  );
                }
                return (
                  <div className="rounded-xl border border-border/80 overflow-hidden">
                    <table className="record-table text-xs">
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Category</th>
                          <th>Result</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchEvidence.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{e.title}</strong>
                            </td>
                            <td>{e.category.replaceAll("_", " ")}</td>
                            <td>
                              <Status value={e.result} />
                            </td>
                            <td>{e.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* 5. Evaluations & Quality Ratings */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <Star size={16} className="text-amber-500" />
                Human Quality Evaluations
              </h3>
              {(() => {
                const batchEvals = data.evaluations.filter(
                  (e) => e.batch_id === dialog.batch!.id,
                );
                return (
                  <div className="space-y-3">
                    {batchEvals.length > 0 ? (
                      batchEvals.map((ev) => (
                        <div
                          key={ev.id}
                          className="p-3 rounded-xl bg-card border border-border/80 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <Rating value={ev.rating} />
                            <span className="text-muted-foreground">
                              {date(ev.created_at)}
                            </span>
                          </div>
                          <p className="text-foreground">{ev.comments}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No evaluations have been submitted for this batch yet.
                      </p>
                    )}

                    {evaluator && (
                      <div className="pt-3 border-t border-border/60">
                        <Btn
                          variant="outline"
                          className="w-full text-xs"
                          onClick={() =>
                            open({
                              kind: "evaluation",
                              batch_id: dialog.batch!.id,
                            })
                          }
                        >
                          <Star size={14} className="text-amber-500" />
                          Submit New Evaluation for {dialog.batch!.code}
                        </Btn>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* If Operator: stage / status update form */}
            {operator && dialog.batch!.status === "active" && (
              <div className="pt-4 border-t border-border/80">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                  Update Batch Lifecycle
                </h4>
                <RecordForm
                  busy={busy}
                  submitLabel="Save batch changes"
                  fields={[
                    {
                      name: "stage",
                      label: "Growth stage",
                      options: stages.map((s) => [s, s]),
                      value: dialog.batch!.stage,
                    },
                    {
                      name: "notes",
                      label: "Notes",
                      type: "textarea",
                      required: false,
                      value: dialog.batch!.notes ?? "",
                    },
                    {
                      name: "status",
                      label: "Status",
                      options: [
                        ["active", "Active"],
                        ["archived", "Archived"],
                      ],
                      value: dialog.batch!.status,
                    },
                  ]}
                  onSubmit={(values) =>
                    mutate(
                      () =>
                        supabase
                          .from("batches")
                          .update(values)
                          .eq("id", dialog.batch!.id)
                          .select()
                          .single(),
                      "Batch updated.",
                    )
                  }
                />
              </div>
            )}
          </div>
        )}
        {dialog?.kind === "superadmin-account-edit" && dialog.account && (
          <RecordForm
            busy={busy}
            submitLabel="Update Account"
            fields={[
              {
                name: "first_name",
                label: "First Name",
                value: dialog.account.first_name || "",
              },
              {
                name: "last_name",
                label: "Last Name",
                value: dialog.account.last_name || "",
              },
              {
                name: "email",
                label: "Email Address",
                value: dialog.account.email,
              },
              {
                name: "role",
                label: "User Role",
                options: [
                  ["pending", "Pending"],
                  ["operator", "Operator"],
                  ["evaluator", "Evaluator"],
                  ["superadmin", "Superadmin"],
                ],
                value: dialog.account.role,
              },
              {
                name: "organization",
                label: "Organization / Facility",
                required: false,
                value: dialog.account.organization || "",
              },
              {
                name: "phone",
                label: "Phone Number",
                required: false,
                value: dialog.account.phone || "",
              },
            ]}
            onSubmit={async (values) => {
              setBusy(true);
              try {
                await updateAccount(dialog.account!.id, {
                  first_name: values.first_name,
                  last_name: values.last_name,
                  email: values.email,
                  role: values.role,
                  organization: values.organization,
                  phone: values.phone,
                });
                const updatedAccounts = await fetchAccounts();
                setAccounts(updatedAccounts);
                setToast("Account updated successfully.");
                close();
              } catch (e) {
                setDialogError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {dialog?.kind === "superadmin-account-delete" && dialog.account && (() => {
          const isSelf = dialog.account.id === profile.id;
          const isLastSuperadmin =
            (dialog.account.role === "superadmin" || dialog.account.role === "admin") &&
            accounts.filter((a) => a.role === "superadmin" || a.role === "admin").length <= 1;
          const cannotDelete = isSelf || isLastSuperadmin;

          return (
            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-3">
                <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">
                    Are you sure you want to delete {dialog.account.display_name || dialog.account.email}?
                  </p>
                  <p className="mt-1 text-xs opacity-90 leading-relaxed">
                    This will permanently remove account #{dialog.account.id} ({dialog.account.role}),
                    revoke all associated chamber allocations, unlink evaluator permissions, and purge
                    pending requests. This action is audited and cannot be undone.
                  </p>
                </div>
              </div>

              {isSelf && (
                <div className="p-3 rounded-lg bg-secondary text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-semibold text-amber-500">Notice:</span> You cannot delete your own active superadmin account.
                </div>
              )}

              {!isSelf && isLastSuperadmin && (
                <div className="p-3 rounded-lg bg-secondary text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-semibold text-amber-500">Notice:</span> Cannot delete the sole remaining superadmin account in the system.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-border/60">
                <Btn disabled={busy} variant="outline" onClick={close}>
                  Cancel
                </Btn>
                <button
                  type="button"
                  disabled={busy || cannotDelete}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await deleteAccount(dialog.account!.id);
                      setAccounts((prev) => prev.filter((a) => a.id !== dialog.account!.id));
                      setToast("Account deleted successfully.");
                      close();
                    } catch (e) {
                      setDialogError(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 transition-colors"
                >
                  {busy ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>
          );
        })()}
        {dialog?.kind === "superadmin-grant-serial" && (
          <RecordForm
            busy={busy}
            submitLabel="Grant Serial ID"
            fields={[
              {
                name: "operator_id",
                label: "Assign to Operator",
                options: accounts
                  .filter((a) => a.role === "operator")
                  .map((a) => [
                    String(a.id),
                    `${a.display_name || a.email} (ID #${a.id})`,
                  ]),
                value: dialog.operator_id ? String(dialog.operator_id) : undefined,
              },
              {
                name: "serial_number",
                label: "Printed Hardware Serial Number",
                placeholder: "e.g. SS-CHAMBER-0001",
              },
              {
                name: "name",
                label: "Chamber Name / Equipment Label",
                placeholder: "e.g. Primary Production Chamber",
              },
            ]}
            onSubmit={async (values) => {
              setBusy(true);
              try {
                await grantDeviceSerial({
                  operator_id: Number(values.operator_id),
                  serial_number: values.serial_number.trim().toUpperCase(),
                  name: values.name.trim(),
                });
                await reload();
                const updatedAccounts = await fetchAccounts();
                setAccounts(updatedAccounts);
                setToast("Chamber serial ID granted to operator.");
                close();
              } catch (e) {
                setDialogError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {dialog?.kind === "superadmin-assign-evaluator" && (
          <RecordForm
            busy={busy}
            submitLabel="Assign Evaluator"
            fields={[
              {
                name: "evaluator_id",
                label: "Evaluator Account",
                options: accounts
                  .filter((a) => a.role === "evaluator" || a.role === "pending")
                  .map((a) => [
                    String(a.id),
                    `${a.display_name || a.email} (ID #${a.id} · ${a.role})`,
                  ]),
                value: dialog.evaluator_id ? String(dialog.evaluator_id) : undefined,
              },
              {
                name: "operator_id",
                label: "Target Operator",
                options: accounts
                  .filter((a) => a.role === "operator")
                  .map((a) => [
                    String(a.id),
                    `${a.display_name || a.email} (ID #${a.id})`,
                  ]),
                value: dialog.operator_id ? String(dialog.operator_id) : undefined,
              },
            ]}
            onSubmit={async (values) => {
              setBusy(true);
              try {
                await assignEvaluator({
                  evaluator_id: Number(values.evaluator_id),
                  operator_id: Number(values.operator_id),
                });
                await reload();
                const updatedAccounts = await fetchAccounts();
                setAccounts(updatedAccounts);
                setToast("Evaluator assigned to operator successfully.");
                close();
              } catch (e) {
                setDialogError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {dialog?.kind === "operator-evaluator-edit" && dialog.evaluator && (
          <RecordForm
            busy={busy}
            submitLabel="Update Evaluator"
            fields={[
              {
                name: "first_name",
                label: "First Name",
                value: dialog.evaluator.first_name || "",
              },
              {
                name: "last_name",
                label: "Last Name",
                value: dialog.evaluator.last_name || "",
              },
              {
                name: "email",
                label: "Email Address",
                value: dialog.evaluator.email,
              },
            ]}
            onSubmit={async (values) => {
              setBusy(true);
              try {
                await updateOperatorEvaluator(dialog.evaluator!.id, {
                  first_name: values.first_name,
                  last_name: values.last_name,
                  email: values.email,
                });
                const [evals, updatedAccounts] = await Promise.all([
                  fetchOperatorEvaluators(),
                  fetchAccounts().catch(() => []),
                ]);
                setOperatorEvaluators(evals);
                if (updatedAccounts.length) setAccounts(updatedAccounts);
                setToast("Evaluator details updated successfully.");
                close();
              } catch (e) {
                setDialogError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {dialog &&
          [
            "batch-create",
            "schedule",
            "evidence",
            "evaluation",
            "maintenance",
            "access",
          ].includes(dialog.kind) && (
            <RecordForm
              key={dialog.kind}
              busy={busy}
              fields={formFields(dialog.kind, data, dialog.batch_id)}
              onSubmit={async (values) => {
                const payload: Record<string, unknown> = {
                  ...values,
                  owner_id: profile.id,
                };
                let table = "";
                if (dialog.kind === "batch-create") {
                  const normalizedCode = values.code.trim().toLowerCase();
                  if (
                    data.batches.some(
                      (batch) => batch.code.trim().toLowerCase() === normalizedCode,
                    )
                  ) {
                    setDialogError(
                      "That batch code already exists. Use a unique code before saving.",
                    );
                    return;
                  }
                  table = "batches";
                  payload.started_at = new Date(
                    values.started_at,
                  ).toISOString();
                  payload.target_harvest_at = values.target_harvest_at
                    ? new Date(values.target_harvest_at).toISOString()
                    : null;
                  if (
                    payload.target_harvest_at &&
                    String(payload.target_harvest_at) <
                    String(payload.started_at)
                  ) {
                    setDialogError(
                      "Harvest date must be after the start date.",
                    );
                    return;
                  }
                }
                if (dialog.kind === "access") {
                  table = "evaluator_access";
                  payload.evaluator_email = values.evaluator_email
                    .trim()
                    .toLowerCase();
                }
                if (dialog.kind === "maintenance") {
                  table = "maintenance_records";
                  payload.device_id = Number(values.device_id);
                }
                if (dialog.kind === "schedule") {
                  table = "irrigation_schedules";
                  payload.device_id = Number(values.device_id);
                  payload.duration_seconds = Number(values.duration_seconds);
                  payload.next_run_at = new Date(
                    values.next_run_at,
                  ).toISOString();
                }
                if (dialog.kind === "evidence") {
                  table = "evidence_records";
                  payload.batch_id = values.batch_id
                    ? Number(values.batch_id)
                    : null;
                }
                if (dialog.kind === "evaluation") {
                  table = "evaluations";
                  delete payload.owner_id;
                  payload.evaluator_id = profile.id;
                  payload.batch_id = Number(values.batch_id);
                  payload.rating = Number(values.rating);
                }
                await mutate(
                  () => supabase.from(table).insert(payload).select().single(),
                  "Record saved.",
                );
              }}
            />
          )}
      </Modal>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="app-toast"
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <CheckCircle2 size={19} />
            <span>{toast}</span>
            <button
              onClick={() => setToast("")}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
  onClick,
  targetLabel,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  onClick?: () => void;
  targetLabel?: string;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="summary-card summary-card-interactive group relative"
        aria-label={`${label}: ${value}. ${detail}${targetLabel ? `. Click to open ${targetLabel}` : ""}`}
      >
        <div className="flex items-start justify-between">
          <span className="summary-icon">{icon}</span>
          <ChevronRight
            size={16}
            className="text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all mt-1"
            aria-hidden="true"
          />
        </div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </button>
    );
  }
  return (
    <section className="summary-card">
      <span className="summary-icon">{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`record-status status-${value}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Rating({ value }: { value: number }) {
  return (
    <span className="rating-display" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          size={15}
          fill={index < value ? "currentColor" : "none"}
          aria-hidden="true"
        />
      ))}
      <span>{value}/5</span>
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Sprout size={30} />
      <p>{text}</p>
    </div>
  );
}
function DataTable({
  headings,
  rows,
  empty,
}: {
  headings: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  if (!rows.length) return <Empty text={empty} />;
  const pageNumbers: (number | "...")[] =
    pageCount <= 7
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : page <= 4
        ? [1, 2, 3, 4, 5, "...", pageCount]
        : page >= pageCount - 3
          ? [1, "...", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
          : [1, "...", page - 1, page, page + 1, "...", pageCount];
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <div
        className="record-table-wrap"
        tabIndex={0}
        aria-label="Scrollable records"
      >
        <table className="record-table">
          <thead>
            <tr>
              {headings.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={(page - 1) * pageSize + index}>
                {row.map((cell, i) => (
                  <td key={i} data-label={headings[i]}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="table-pagination" aria-label="Table pages">
          <button
            aria-label="Previous page"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          {pageNumbers.map((number, index) =>
            number === "..." ? (
              <span className="table-pagination-ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>
                …
              </span>
            ) : (
              <button
                key={number}
                aria-current={page === number ? "page" : undefined}
                aria-label={`Page ${number}`}
                onClick={() => setPage(number)}
              >
                {number}
              </button>
            ),
          )}
          <button
            aria-label="Next page"
            disabled={page === pageCount}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}
type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[][];
  value?: string;
  placeholder?: string;
  min?: number;
  max?: number;
};
function RecordForm({
  fields,
  busy,
  onSubmit,
  submitLabel = "Save",
}: {
  fields: Field[];
  busy: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  submitLabel?: string;
}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<string, string>;
    try {
      await onSubmit(values);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-4">
        {fields.map((f) =>
          f.type === "rating" ? (
            <fieldset className="field" key={f.name}>
              <legend>{f.label}</legend>
              <div className="rating-picker">
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={f.name}
                      value={value}
                      required={f.required !== false}
                      defaultChecked={f.value === String(value)}
                    />
                    <Star size={21} aria-hidden="true" />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
              <small className="text-muted-foreground">
                1 Poor · 2 Fair · 3 Good · 4 Very good · 5 Excellent
              </small>
            </fieldset>
          ) : (
            <label className="field" key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  name={f.name}
                  required={f.required !== false}
                  defaultValue={f.value ?? ""}
                >
                  <option value="" disabled={f.required !== false}>
                    Select…
                  </option>
                  {f.options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  rows={3}
                  maxLength={2000}
                  required={f.required !== false}
                  defaultValue={f.value}
                />
              ) : (
                <input
                  name={f.name}
                  type={f.type ?? "text"}
                  required={f.required !== false}
                  defaultValue={f.value}
                  placeholder={f.placeholder}
                  min={f.min}
                  max={f.max}
                  maxLength={f.name === "code" ? 64 : 120}
                />
              )}
            </label>
          ),
        )}
        {error && (
          <p role="alert" className="feedback-error">
            {error}
          </p>
        )}
        <Btn className="w-full" disabled={busy} type="submit">
          {busy ? "Saving…" : submitLabel}
        </Btn>
      </fieldset>
    </form>
  );
}
function formFields(
  kind: string,
  data: WorkspaceData,
  defaultBatchId?: number,
): Field[] {
  const device: Field = {
    name: "device_id",
    label: "Device",
    options: data.devices.map((d) => [String(d.id), d.name]),
  };
  const batch: Field = {
    name: "batch_id",
    label: "Batch",
    options: data.batches.map((b) => [String(b.id), b.code]),
    value: defaultBatchId ? String(defaultBatchId) : undefined,
  };
  const notes: Field = { name: "notes", label: "Notes", type: "textarea" };
  return (
    (
      {
        "batch-create": [
          { name: "code", label: "Batch code" },
          { name: "seed_type", label: "Crop", value: "Mung beans" },
          { name: "started_at", label: "Start date", type: "datetime-local" },
          {
            name: "target_harvest_at",
            label: "Target harvest (optional)",
            type: "datetime-local",
            required: false,
          },
          { ...notes, required: false },
        ],
        access: [
          {
            name: "evaluator_email",
            label: "Evaluator’s account email",
            type: "email",
          },
        ],
        maintenance: [device, notes],
        schedule: [
          device,
          { name: "next_run_at", label: "Next run", type: "datetime-local" },
          {
            name: "duration_seconds",
            label: "Duration (seconds)",
            type: "number",
            min: 1,
            max: 600,
          },
        ],
        evidence: [
          { ...batch, required: false },
          { name: "title", label: "Test title" },
          {
            name: "category",
            label: "Category",
            options: [
              ["calibration", "Calibration"],
              ["irrigation", "Irrigation"],
              ["safety", "Safety"],
              ["offline_sync", "Offline sync"],
            ],
          },
          {
            name: "result",
            label: "Result",
            options: [
              ["passed", "Passed"],
              ["failed", "Failed"],
              ["pending", "Pending"],
            ],
          },
          notes,
        ],
        evaluation: [
          batch,
          {
            name: "rating",
            label: "Human assessment",
            type: "rating",
          },
          {
            name: "comments",
            label: "Observations or disagreement with machine data",
            type: "textarea",
          },
        ],
      } as Record<string, Field[]>
    )[kind] ?? []
  );
}
function Preferences({
  userId,
  onChange,
}: {
  userId: number;
  onChange: (values: {
    alerts_enabled: boolean;
    harvest_enabled: boolean;
  }) => void;
}) {
  const [values, setValues] = useState<{
    alerts_enabled: boolean;
    harvest_enabled: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    supabase
      .from("notification_preferences")
      .select("alerts_enabled,harvest_enabled")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setValues(data ?? { alerts_enabled: true, harvest_enabled: true });
      });
    return () => {
      active = false;
    };
  }, [userId]);
  async function toggle(key: "alerts_enabled" | "harvest_enabled") {
    if (!values) return;
    setBusy(true);
    setError("");
    const next = { ...values, [key]: !values[key] };
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...next });
    if (error) setError(error.message);
    else {
      setValues(next);
      onChange(next);
    }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="feedback-error">
          {error}
        </p>
      )}
      {values
        ? (["alerts_enabled", "harvest_enabled"] as const).map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span>
              {key === "alerts_enabled"
                ? "In-app alert notifications"
                : "Harvest notifications"}
            </span>
            <input
              type="checkbox"
              checked={values[key]}
              disabled={busy}
              onChange={() => void toggle(key)}
              className="h-5 w-5 accent-emerald-600"
            />
          </label>
        ))
        : !error && <p>Loading preferences…</p>}
      <p className="text-xs text-muted-foreground">
        Preferences are saved to your account. Alert history is always
        available.
      </p>
    </div>
  );
}
