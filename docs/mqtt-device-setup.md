# Connect an operator's device

The operator workspace accepts the test page's MQTT contract and defaults to
`wss://broker.hivemq.com:8884/mqtt`. The FastAPI process subscribes and saves
telemetry; the browser receives authorized Supabase Realtime inserts and checks
the API every two seconds to recover missed updates and refresh connection state.

1. Find and register an ESP32 using **Add device → Search Wi-Fi / Search Bluetooth**.
   See [wireless discovery and firmware integration](device-discovery.md).
   Alternatively, have an administrator grant an existing printed hardware serial.
   Neither registration nor a grant marks hardware online. Sample devices cannot
   be connected to a live MQTT stream.
2. Power on the ESP32 and connect it to Wi-Fi. It must publish to
   `sproutsync/telemetry`, or another concrete prefix followed by `/telemetry`.
3. In **Add device**, choose a discovered board or granted serial and name it.
   A discovered board supplies its prefix; for a granted serial, enter the
   prefix configured in the firmware. Use `sproutsync` for the
   supplied test page. Every controller needs a different prefix; a prefix
   cannot be assigned to two device records, including across operators.
4. Select **Connect device**. The dialog waits for a fresh, valid packet before
   showing **Device detected**. You can keep listening in the background or open
   **Readings** after detection. Readings survive page reloads and API restarts.

The shared HiveMQ test broker does not authenticate hardware identity or provide
private topics. Detection means that fresh telemetry arrived on the selected
topic; matching a printed serial in the UI is not proof of the physical sender.
Use an authenticated broker with per-device topic ACLs before production use.
This integration only subscribes. It does not send power, relay, irrigation, or
calibration commands.

## Sensor packet

Publish a JSON object, normally every two seconds:

```json
{
  "serialNumber": "ESP32-A1B2C3",
  "airTemp": 26.2,
  "airHum": 87,
  "waterTemp": 20.4,
  "lux": 0,
  "voltage": 5.02,
  "sdOK": true,
  "status": "NONE"
}
```

Numbers must be finite JSON numbers. At least one measurement is required.
Missing readings stay null; the four-sensor test payload cannot supply fresh-water
or wastewater levels. Optional `waterLevel` and `wastewaterLevel` are percentages.
Disconnected sensor sentinels such as `waterTemp: -127` and `lux: -1` are saved
as unavailable values and cause a fault state. Existing UI reference ranges are
informational; no physical safety limits or calibration are configured here.

Replace the example `serialNumber` with the board's actual discovery/printed
serial. `serialNumber` is required for devices registered through Wi-Fi/Bluetooth and
must match the registered serial. It remains optional for legacy granted
devices, but must match whenever present. Firmware can
also provide `messageId` (unique across boots, e.g. `bootUUID:sequence`) and
`recordedAt` (an ISO 8601 timestamp with timezone). Message IDs, or recorded
timestamps when IDs are absent, suppress duplicate replay. Legacy packets without
either field are accepted as separate arrivals; run one API ingestion process
to avoid duplicate legacy packets from multiple subscribers.

The bridge ignores retained telemetry, unknown topics, malformed or oversized
packets, mismatched serials, and old/future source timestamps. `received_at` is
the server arrival time; `recorded_at` uses the source timestamp when supplied,
otherwise arrival time. Offline backfill is not part of this live ingestion path.
`NONE`, `OK`, or `NORMAL` indicate healthy telemetry; other status strings or an
SD error mark a device as faulty. Status messages containing `OFFLINE` or
`DISCONNECTED` mark it offline; an `ONLINE` status message alone never detects it.

A fresh faulty packet creates a device alert in both workspace **Notifications**
and **Alerts**. Further fault packets update that alert rather than creating
duplicates; a healthy packet resolves it. Adding or registering a device does
not itself create a fault alert. Device alerts follow the account's system-alert
notification preference.

## Server setup and recovery

Restart the launcher; it installs missing or outdated requirements automatically:

```powershell
.\start.bat
```

The launcher applies migrations through `0014_wireless_discovery` before starting the API.
The server defaults already match HiveMQ. Optional server-only `.env` settings:

| Setting | Default |
| --- | --- |
| `MQTT_ENABLED` | `true` |
| `MQTT_BROKER_URL` | `wss://broker.hivemq.com:8884/mqtt` |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Empty for the shared test broker |
| `MQTT_STALE_SECONDS` | `30` |

With no fresh packet for 30 seconds, or when the server loses the broker
connection, a connected device becomes offline. The last known reading remains
visible with an unavailable/stale message. The MQTT client reconnects automatically;
new telemetry restores online/fault status. The browser also retries automatically.
An API failure shows an error with a retry action. For a pending device, check
its Wi-Fi and topic prefix, then retry detection; changing a prefix preserves
stored history.

Devices with recorded telemetry cannot be reassigned through the API because
their readings retain the original ownership. This avoids exposing history to a
different operator. Existing rows remain unbound until explicitly connected.
Migration downgrade removes MQTT-specific fields and bindings but preserves
the original sensor-history columns; export MQTT metadata before downgrading.

## Validation

Read-only broker check (no publishing or database writes):

```powershell
.\backend\api\.venv\Scripts\python.exe scripts/check_mqtt.py --topic-prefix sproutsync
```

PostgreSQL persistence, access policies, and Realtime publication check (all
synthetic records roll back):

```powershell
.\backend\api\.venv\Scripts\python.exe scripts/verify_mqtt_persistence.py
```

The backend tests cover detection, packet validation, ownership, duplicate replay,
faults, stale data, and broker loss. The browser flow checks topic conflicts,
waiting/detection, live readings, missing values, chamber filtering, and reloads.
Physical calibration and the identity of the public-topic publisher require a
separate hardware bench check.

Implementation references: [Eclipse Paho client documentation](https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html).
