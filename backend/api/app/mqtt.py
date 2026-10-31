"""Read-only MQTT bridge. Browser clients never publish hardware commands."""

import logging
import queue
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import paho.mqtt.client as mqtt
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    ValidationError,
    model_validator,
)
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import SessionLocal
from app.models import Alert, Device, TelemetryReading, User

logger = logging.getLogger(__name__)
SENSORS = {
    "airTemp": ("temperature_c", -40, 125),
    "airHum": ("humidity_percent", 0, 100),
    "waterTemp": ("water_temperature_c", -55, 125),
    "lux": ("light_lux", 0, 1_000_000_000),
    "waterLevel": ("water_level_percent", 0, 100),
    "wastewaterLevel": ("wastewater_level_percent", 0, 100),
}


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def broker_address():
    """Validate server configuration before opening sockets or exposing a URL."""
    url = urlsplit(settings.mqtt_broker_url)
    if (
        url.scheme != "wss"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.port == 0
    ):
        raise ValueError("Invalid MQTT broker URL")
    return url


class SensorPacket(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    airTemp: StrictFloat | None = None
    airHum: StrictFloat | None = None
    waterTemp: StrictFloat | None = None
    lux: StrictFloat | None = None
    waterLevel: StrictFloat | None = None
    wastewaterLevel: StrictFloat | None = None
    voltage: StrictFloat | None = Field(default=None, ge=0, le=100)
    sdOK: StrictBool | None = None
    status: str = Field(default="NONE", min_length=1, max_length=120)
    serialNumber: str | None = Field(default=None, min_length=1, max_length=64)
    messageId: str | None = Field(default=None, min_length=1, max_length=128)
    recordedAt: datetime | None = None

    @model_validator(mode="after")
    def require_sensor(self):
        if not any(getattr(self, field) is not None for field in SENSORS):
            raise ValueError("At least one sensor measurement is required")
        if self.recordedAt is not None and self.recordedAt.tzinfo is None:
            raise ValueError("recordedAt must include a timezone")
        return self


def ingest_message(
    db, topic: str, payload: bytes, *, retained=False, received_at=None
) -> bool:
    """Persist a fresh packet atomically with its device heartbeat."""
    if retained or len(payload) > 8192 or not topic.endswith("/telemetry"):
        return False
    try:
        packet = SensorPacket.model_validate_json(payload)
    except (ValidationError, ValueError):
        return False
    received = received_at or datetime.now(timezone.utc)
    recorded = packet.recordedAt or received
    # Buffered/replayed data must not manufacture a live heartbeat.
    if recorded < received - timedelta(
        seconds=settings.mqtt_stale_seconds
    ) or recorded > received + timedelta(seconds=5):
        return False
    device = db.scalar(
        select(Device)
        .join(User, User.id == Device.owner_id)
        .where(
            Device.mqtt_topic_prefix == topic.removesuffix("/telemetry"),
            Device.is_demo.is_(False),
            User.is_active.is_(True),
            User.role.in_(("operator", "admin", "superadmin")),
        )
        .with_for_update()
    )
    if device is None or (
        packet.serialNumber
        and packet.serialNumber.strip().upper() != device.serial_number.upper()
    ):
        return False
    if device.requires_serial_number and not packet.serialNumber:
        return False
    if device.connection_requested_at and received < utc(
        device.connection_requested_at
    ):
        return False
    if device.last_seen_at and received <= utc(device.last_seen_at):
        return False
    message_id = packet.messageId
    if message_id is None and packet.recordedAt is not None:
        message_id = "time:" + packet.recordedAt.astimezone(timezone.utc).isoformat()
    if (
        message_id
        and db.scalar(
            select(TelemetryReading.id).where(
                TelemetryReading.device_id == device.id,
                TelemetryReading.message_id == message_id,
            )
        )
        is not None
    ):
        return False
    values = {}
    invalid_sensor = False
    for field, (column, minimum, maximum) in SENSORS.items():
        value = getattr(packet, field)
        invalid = value is not None and not minimum <= value <= maximum
        invalid_sensor |= invalid
        values[column] = None if invalid else value
    sensor_status = packet.status.strip().upper()[:120] or "NONE"
    if invalid_sensor and sensor_status in ("NONE", "OK", "NORMAL"):
        sensor_status = "SENSOR_FAULT"
    if packet.sdOK is False and sensor_status in ("NONE", "OK", "NORMAL"):
        sensor_status = "SD_ERROR"
    previous_status = device.status
    device.status = "online" if sensor_status in ("NONE", "OK", "NORMAL") else "fault"
    device.last_seen_at = received
    device_fault = device.status == "fault"
    active_device_alert = db.scalar(
        select(Alert)
        .where(
            Alert.device_id == device.id,
            Alert.category == "device",
            Alert.status.in_(("open", "acknowledged")),
            Alert.is_demo.is_(False),
        )
        .order_by(Alert.created_at.desc(), Alert.id.desc())
        .limit(1)
        .with_for_update()
    )
    fault_message = (
        f"{device.name} ({device.serial_number}) reported {sensor_status}. "
        "Check the latest sensor readings before relying on them."
    )
    if device_fault:
        if active_device_alert is not None:
            active_device_alert.title = f"Device fault: {device.name}"
            active_device_alert.message = fault_message
        else:
            latest_device_alert = db.scalar(
                select(Alert.id)
                .where(
                    Alert.device_id == device.id,
                    Alert.category == "device",
                    Alert.is_demo.is_(False),
                )
                .order_by(Alert.created_at.desc(), Alert.id.desc())
                .limit(1)
            )
            if latest_device_alert is None or previous_status != "fault":
                db.add(
                    Alert(
                        owner_id=device.owner_id,
                        device_id=device.id,
                        title=f"Device fault: {device.name}",
                        message=fault_message,
                        recommended_action=(
                            "Inspect the reported device fault. Confirm fresh, "
                            "valid sensor readings have returned before relying on them."
                        ),
                        severity="warning",
                        status="open",
                        category="device",
                    )
                )
    elif active_device_alert is not None:
        active_device_alert.status = "resolved"

    db.add(
        TelemetryReading(
            owner_id=device.owner_id,
            device_id=device.id,
            **values,
            voltage=packet.voltage,
            sd_ok=packet.sdOK,
            sensor_status=sensor_status,
            message_id=message_id,
            recorded_at=recorded,
            received_at=received,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    return True


class MQTTBridge:
    """One subscriber per API process, with bounded buffering and automatic reconnect."""

    def __init__(self, session_factory=SessionLocal):
        self.session_factory = session_factory
        self.connected = False
        self.state = "disabled"
        self.client = None
        self._stop = threading.Event()
        self._thread = None
        self._messages = queue.Queue(maxsize=1000)
        self._subscriptions = set()

    def start(self):
        if not settings.mqtt_enabled:
            return
        try:
            url = broker_address()
        except ValueError:
            self.state = "configuration_error"
            logger.error(
                "MQTT_BROKER_URL must be a wss URL without credentials or query parameters"
            )
            return
        self._stop.clear()
        self.state = "connecting"
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, transport="websockets"
        )
        self.client.ws_set_options(path=url.path or "/mqtt")
        self.client.tls_set()
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_connect_fail = self._on_connect_fail
        self.client.on_message = self._on_message
        self.client.on_subscribe = self._on_subscribe
        self.client.connect_async(url.hostname, url.port or 443, keepalive=30)
        self.client.loop_start()
        self._thread = threading.Thread(
            target=self._run, name="mqtt-ingestion", daemon=True
        )
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
        if self._thread:
            self._thread.join(timeout=5)
        self.connected = False

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        self.connected = not reason_code.is_failure
        self.state = "connected" if self.connected else "connection_error"
        self._subscriptions.clear()

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected = False
        self.state = "reconnecting"

    def _on_connect_fail(self, client, userdata):
        self.connected = False
        self.state = "reconnecting"

    def _on_subscribe(self, client, userdata, mid, reason_codes, properties):
        if any(code.is_failure for code in reason_codes):
            self.state = "subscription_error"
            self._subscriptions.clear()

    def _on_message(self, client, userdata, message):
        if message.retain or len(message.payload) > 8192:
            return
        try:
            self._messages.put_nowait(
                (message.topic, message.payload, datetime.now(timezone.utc))
            )
        except queue.Full:
            logger.warning("MQTT input buffer full; packet dropped")

    def _sync(self, db):
        prefixes = set(
            db.scalars(
                select(Device.mqtt_topic_prefix)
                .join(User, User.id == Device.owner_id)
                .where(
                    Device.mqtt_topic_prefix.is_not(None),
                    Device.is_demo.is_(False),
                    User.is_active.is_(True),
                    User.role.in_(("operator", "admin", "superadmin")),
                )
            ).all()
        )
        if self.connected:
            for prefix in prefixes - self._subscriptions:
                result, _ = self.client.subscribe(
                    [(prefix + "/telemetry", 0), (prefix + "/status", 0)]
                )
                if result == mqtt.MQTT_ERR_SUCCESS:
                    self._subscriptions.add(prefix)
            for prefix in self._subscriptions.copy() - prefixes:
                self.client.unsubscribe([prefix + "/telemetry", prefix + "/status"])
                self._subscriptions.discard(prefix)
        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=settings.mqtt_stale_seconds
        )
        query = update(Device).where(
            Device.mqtt_topic_prefix.is_not(None),
            Device.status.in_(("online", "fault")),
        )
        if self.connected:
            query = query.where(Device.last_seen_at < cutoff)
        db.execute(query.values(status="offline"))
        db.commit()

    def _run(self):
        next_sync = 0
        while not self._stop.is_set():
            try:
                if time.monotonic() >= next_sync:
                    with self.session_factory() as db:
                        self._sync(db)
                    next_sync = time.monotonic() + 2
                try:
                    topic, payload, received = self._messages.get(timeout=0.5)
                except queue.Empty:
                    continue
                with self.session_factory() as db:
                    if topic.endswith("/telemetry"):
                        ingest_message(db, topic, payload, received_at=received)
                    elif topic.endswith("/status") and payload.decode(
                        "utf-8", errors="replace"
                    ).strip().upper() in ("OFFLINE", "DISCONNECTED"):
                        db.execute(
                            update(Device)
                            .where(
                                Device.mqtt_topic_prefix
                                == topic.removesuffix("/status")
                            )
                            .values(status="offline")
                        )
                        db.commit()
            except Exception as error:
                # Never log sensor payloads, database URLs, or credentials.
                logger.warning("MQTT ingestion failed (%s)", type(error).__name__)
                self._stop.wait(1)

    def snapshot(self):
        try:
            broker_address()
            public_url = settings.mqtt_broker_url
        except ValueError:
            public_url = "Invalid broker configuration"
        return {
            "state": self.state,
            "connected": self.connected,
            "broker_url": public_url,
            "stale_seconds": settings.mqtt_stale_seconds,
        }


bridge = MQTTBridge()
