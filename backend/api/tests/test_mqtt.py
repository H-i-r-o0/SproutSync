"""Device detection must come from fresh, valid telemetry on an owned binding."""

import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Alert, Device, EvaluatorAccess, TelemetryReading, User
from app.discovery import Advertisement, DeviceIdentity, discovery
from app.mqtt import MQTTBridge, bridge, ingest_message, utc


@pytest.fixture
def workspace(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        users = [
            User(
                google_subject=role,
                email=f"{role}@example.test",
                display_name=role,
                role=role,
                is_active=True,
            )
            for role in ("operator", "evaluator", "pending", "superadmin")
        ]
        db.add_all(users)
        db.flush()
        owner, evaluator, pending, admin = users
        device = Device(
            owner_id=owner.id, serial_number="ESP-001", name="Chamber", is_demo=False
        )
        other = Device(
            owner_id=admin.id,
            serial_number="ESP-OTHER",
            name="Private",
            mqtt_topic_prefix="private/esp",
            is_demo=False,
        )
        db.add_all([device, other])
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: owner
        with TestClient(app) as client:
            monkeypatch.setattr(settings, "mqtt_enabled", True)
            monkeypatch.setattr(bridge, "connected", True)
            monkeypatch.setattr(bridge, "state", "connected")
            yield SimpleNamespace(
                client=client,
                db=db,
                owner=owner,
                evaluator=evaluator,
                pending=pending,
                admin=admin,
                device=device,
                other=other,
                factory=factory,
            )
        app.dependency_overrides.clear()
    engine.dispose()


def connect(workspace, prefix="sproutsync"):
    return workspace.client.post(
        "/api/v1/devices/connect",
        json={
            "serial_number": " esp-001 ",
            "name": "Live chamber",
            "topic_prefix": prefix,
        },
    )


def count(db):
    return db.scalar(select(func.count()).select_from(TelemetryReading))


def test_connect_waits_for_packet_then_persists_real_readings(workspace):
    w = workspace
    response = connect(w)
    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    assert response.json()["last_seen_at"] is None
    assert count(w.db) == 0
    now = datetime.now(timezone.utc)
    packet = {
        "airTemp": 26.2,
        "airHum": 87,
        "waterTemp": 20.4,
        "lux": 0,
        "voltage": 5.02,
        "sdOK": True,
        "status": "NONE",
    }
    assert ingest_message(
        w.db, "sproutsync/telemetry", json.dumps(packet).encode(), received_at=now
    )
    live = w.client.get("/api/v1/devices/live").json()
    assert live["devices"][0]["status"] == "online"
    reading = live["readings"][0]
    assert reading["temperature_c"] == 26.2 and reading["humidity_percent"] == 87
    assert reading["light_lux"] == 0 and reading["voltage"] == 5.02
    assert (
        reading["water_level_percent"] is None
        and reading["wastewater_level_percent"] is None
    )
    assert reading["sensor_status"] == "NONE"
    assert count(w.db) == 1
    # A new DB session sees saved data independently of the browser/request.
    with w.factory() as fresh:
        assert fresh.scalar(select(TelemetryReading)).temperature_c == 26.2


@pytest.mark.parametrize(
    "payload",
    [
        b"bad json",
        b"[]",
        b"{}",
        b'{"airTemp":"26"}',
        b'{"airTemp":true}',
        b'{"airTemp":NaN}',
        b'{"airTemp":Infinity}',
        b'{"airTemp":23,"sdOK":"false"}',
        b'{"airTemp":23,"recordedAt":"2026-01-01T00:00:00"}',
        b" " * 8193,
    ],
)
def test_invalid_packets_never_detect_device(workspace, payload):
    assert connect(workspace).status_code == 202
    assert not ingest_message(workspace.db, "sproutsync/telemetry", payload)
    assert workspace.db.get(Device, workspace.device.id).status == "pending"
    assert count(workspace.db) == 0


def test_retained_wrong_serial_wrong_topic_and_old_packets_are_ignored(workspace):
    w = workspace
    connect(w)
    payload = b'{"airTemp":25}'
    assert not ingest_message(w.db, "sproutsync/telemetry", payload, retained=True)
    assert not ingest_message(w.db, "unknown/telemetry", payload)
    assert not ingest_message(w.db, "sproutsync/status", payload)
    assert not ingest_message(
        w.db, "sproutsync/telemetry", b'{"airTemp":25,"serialNumber":"WRONG"}'
    )
    assert not ingest_message(
        w.db,
        "sproutsync/telemetry",
        payload,
        received_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    for delta in (-120, 120):
        data = {
            "airTemp": 25,
            "recordedAt": (
                datetime.now(timezone.utc) + timedelta(seconds=delta)
            ).isoformat(),
        }
        assert not ingest_message(
            w.db, "sproutsync/telemetry", json.dumps(data).encode()
        )
    assert count(w.db) == 0


def test_duplicate_ids_do_not_refresh_heartbeat(workspace):
    w = workspace
    connect(w)
    now = datetime.now(timezone.utc)
    payload = b'{"airTemp":25,"messageId":"boot-123:1"}'
    assert ingest_message(w.db, "sproutsync/telemetry", payload, received_at=now)
    assert not ingest_message(
        w.db, "sproutsync/telemetry", payload, received_at=now + timedelta(seconds=5)
    )
    assert count(w.db) == 1
    assert utc(w.db.get(Device, w.device.id).last_seen_at) == now


def test_live_delta_snapshots_return_only_new_visible_readings(workspace):
    w = workspace
    connect(w)
    assert ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":25}')
    first_id = w.client.get("/api/v1/devices/live").json()["readings"][0]["id"]
    assert (
        w.client.get(f"/api/v1/devices/live?after_id={first_id}").json()["readings"]
        == []
    )
    assert ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":26}')
    delta = w.client.get(f"/api/v1/devices/live?after_id={first_id}").json()["readings"]
    assert len(delta) == 1 and delta[0]["temperature_c"] == 26
    assert w.client.get("/api/v1/devices/live?after_id=-1").status_code == 422
    app.dependency_overrides[get_current_user] = lambda: w.evaluator
    assert w.client.get("/api/v1/devices/live?after_id=0").json()["readings"] == []


def test_sensor_disconnect_sentinels_are_faults_not_measurements(workspace):
    w = workspace
    connect(w)
    assert ingest_message(
        w.db,
        "sproutsync/telemetry",
        b'{"airTemp":-127,"waterTemp":-127,"lux":-1,"airHum":88}',
    )
    reading = w.db.scalar(select(TelemetryReading))
    assert (
        reading.temperature_c is None
        and reading.water_temperature_c is None
        and reading.light_lux is None
    )
    assert reading.humidity_percent == 88 and reading.sensor_status == "SENSOR_FAULT"
    assert w.db.get(Device, w.device.id).status == "fault"


def test_device_fault_alerts_are_deduplicated_and_resolved_on_recovery(workspace):
    w = workspace
    connect(w)
    received = datetime.now(timezone.utc)

    def send(message_id, status, sd_ok, offset):
        packet = {
            "airTemp": 25.0,
            "messageId": message_id,
            "sdOK": sd_ok,
            "status": status,
        }
        return ingest_message(
            w.db,
            "sproutsync/telemetry",
            json.dumps(packet).encode(),
            received_at=received + timedelta(seconds=offset),
        )

    assert send("fault-1", "SD CARD ERR", False, 0)
    alert = w.db.scalar(select(Alert))
    assert alert is not None
    assert alert.owner_id == w.owner.id and alert.device_id == w.device.id
    assert alert.category == "device" and alert.severity == "warning"
    assert alert.status == "open"
    assert "SD CARD ERR" in alert.message
    assert alert.recommended_action

    assert send("fault-2", "SD CARD ERR", False, 1)
    assert w.db.scalar(select(func.count()).select_from(Alert)) == 1

    assert send("recovered-1", "NONE", True, 2)
    assert alert.status == "resolved"

    assert send("fault-3", "SD CARD ERR", False, 3)
    alerts = w.db.scalars(select(Alert).order_by(Alert.id)).all()
    assert len(alerts) == 2
    assert alerts[1].status == "open"


def test_stale_or_broker_disconnected_devices_go_offline_and_recover(
    workspace, monkeypatch
):
    w = workspace
    connect(w)
    assert ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":25}')
    monkeypatch.setattr(bridge, "connected", False)
    assert (
        w.client.get("/api/v1/devices/live").json()["devices"][0]["status"] == "offline"
    )
    worker = MQTTBridge(w.factory)
    worker._sync(w.db)
    assert w.db.get(Device, w.device.id).status == "offline"
    monkeypatch.setattr(bridge, "connected", True)
    assert ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":26}')
    assert (
        w.client.get("/api/v1/devices/live").json()["devices"][0]["status"] == "online"
    )
    w.device.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=31)
    w.db.commit()
    worker.connected = True
    worker.client = Mock()
    worker.client.subscribe.return_value = (0, 1)
    worker._sync(w.db)
    assert w.db.get(Device, w.device.id).status == "offline"


def test_ownership_permissions_and_unique_topic_binding(workspace):
    w = workspace
    assert connect(w, "private/esp").status_code == 409
    assert connect(w, "sproutsync/#").status_code == 422
    for user in (w.evaluator, w.pending):
        app.dependency_overrides[get_current_user] = lambda: user
        assert connect(w).status_code == 403
        assert w.client.get("/api/v1/devices/live").json()["devices"] == []
    app.dependency_overrides[get_current_user] = lambda: w.admin
    response = w.client.post(
        "/api/v1/devices/connect",
        json={
            "serial_number": "ESP-OTHER",
            "name": "Private",
            "topic_prefix": "private/esp",
        },
    )
    assert response.status_code == 202
    assert ingest_message(w.db, "private/esp/telemetry", b'{"airTemp":29}')
    app.dependency_overrides[get_current_user] = lambda: w.owner
    assert (
        w.client.post(
            "/api/v1/devices/connect",
            json={
                "serial_number": "ESP-OTHER",
                "name": "Stolen",
                "topic_prefix": "stolen",
            },
        ).status_code
        == 404
    )
    assert w.client.get("/api/v1/devices/live").json()["readings"] == []
    app.dependency_overrides[get_current_user] = lambda: w.evaluator
    w.db.add(
        EvaluatorAccess(
            owner_id=w.admin.id,
            evaluator_id=w.evaluator.id,
            evaluator_email=w.evaluator.email,
        )
    )
    w.db.commit()
    live = w.client.get("/api/v1/devices/live").json()
    assert [d["id"] for d in live["devices"]] == [w.other.id]
    assert [r["temperature_c"] for r in live["readings"]] == [29]


def test_disabled_bridge_and_inactive_owner_cannot_connect_or_ingest(
    workspace, monkeypatch
):
    w = workspace
    monkeypatch.setattr(settings, "mqtt_enabled", False)
    assert connect(w).status_code == 503
    assert w.device.mqtt_topic_prefix is None
    monkeypatch.setattr(settings, "mqtt_enabled", True)
    connect(w)
    w.owner.is_active = False
    w.db.commit()
    assert not ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":25}')
    assert connect(w).status_code == 403


def test_serial_grant_is_pending_and_preserves_telemetry_ownership(workspace):
    w = workspace
    app.dependency_overrides[get_current_user] = lambda: w.admin
    payload = {
        "operator_id": w.owner.id,
        "serial_number": "FRESH-001",
        "name": "New chamber",
    }
    result = w.client.post("/api/v1/superadmin/device-grants", json=payload)
    assert result.status_code == 201 and result.json()["status"] == "pending"
    assert (
        w.client.post(
            "/api/v1/superadmin/device-grants", json={**payload, "serial_number": "   "}
        ).status_code
        == 422
    )
    w.owner.is_active = False
    w.db.commit()
    assert (
        w.client.post("/api/v1/superadmin/device-grants", json=payload).status_code
        == 400
    )
    w.owner.is_active = True
    w.db.commit()
    app.dependency_overrides[get_current_user] = lambda: w.owner
    connect(w)
    assert ingest_message(w.db, "sproutsync/telemetry", b'{"airTemp":25}')
    app.dependency_overrides[get_current_user] = lambda: w.admin
    transfer = {
        "operator_id": w.admin.id,
        "serial_number": "ESP-001",
        "name": "Transferred chamber",
    }
    assert (
        w.client.post("/api/v1/superadmin/device-grants", json=transfer).status_code
        == 409
    )
    assert w.db.get(Device, w.device.id).owner_id == w.owner.id


@pytest.mark.parametrize(
    "broker_url",
    [
        "ws://broker/mqtt",
        "wss://user:secret@broker/mqtt",
        "wss://broker/mqtt?secret=secret",
        "wss://broker:invalid/mqtt",
    ],
)
def test_invalid_broker_configuration_never_opens_a_socket_or_leaks_credentials(
    monkeypatch, broker_url
):
    monkeypatch.setattr(settings, "mqtt_enabled", True)
    monkeypatch.setattr(settings, "mqtt_broker_url", broker_url)
    worker = MQTTBridge()
    worker.start()
    assert worker.client is None and worker.state == "configuration_error"
    assert worker.snapshot()["broker_url"] == "Invalid broker configuration"


def nearby_entry(serial="ESP32-NEARBY", prefix="sproutsync/nearby"):
    return Advertisement(
        DeviceIdentity(
            protocol="sproutsync-discovery-v1",
            model="ESP32",
            serial_number=serial,
            name="Nearby ESP32",
            topic_prefix=prefix,
        ),
        ["192.168.1.80"],
        "nearby-token",
        time.monotonic() + 120,
    )


def test_wifi_discovery_and_registration_need_no_prior_serial_grant(
    workspace, monkeypatch
):
    w = workspace
    w.db.delete(w.device)
    w.db.commit()
    entry = nearby_entry()
    monkeypatch.setattr(discovery, "scan", lambda: [entry])
    monkeypatch.setattr(
        discovery, "lookup", lambda token: entry if token == "nearby-token" else None
    )
    found = w.client.get("/api/v1/devices/discover")
    assert found.status_code == 200 and found.json()["devices"][0]["available"] is True
    assert found.json()["devices"][0]["addresses"] == ["192.168.1.80"]
    response = w.client.post(
        "/api/v1/devices/nearby",
        json={
            "transport": "wifi",
            "discovery_id": "nearby-token",
            "name": "My first chamber",
        },
    )
    assert response.status_code == 202
    added = response.json()
    assert (
        added["serial_number"] == "ESP32-NEARBY"
        and added["owner_id"] == w.owner.id
        and added["status"] == "pending"
    )
    assert added["last_seen_at"] is None
    # Unrelated public-broker packets cannot turn this wireless board online.
    assert not ingest_message(w.db, "sproutsync/nearby/telemetry", b'{"airTemp":25}')
    assert not ingest_message(
        w.db, "sproutsync/nearby/telemetry", b'{"airTemp":25,"serialNumber":"OTHER"}'
    )
    assert ingest_message(
        w.db,
        "sproutsync/nearby/telemetry",
        b'{"airTemp":25,"serialNumber":"ESP32-NEARBY"}',
    )
    assert (
        w.client.get("/api/v1/devices/live").json()["readings"][0]["temperature_c"]
        == 25
    )


def test_nearby_registration_never_takes_over_another_workspace(workspace, monkeypatch):
    w = workspace
    entry = nearby_entry(w.other.serial_number, "private/esp")
    monkeypatch.setattr(discovery, "scan", lambda: [entry])
    monkeypatch.setattr(discovery, "lookup", lambda _token: entry)
    found = w.client.get("/api/v1/devices/discover").json()["devices"][0]
    assert found["available"] is False and "owner_id" not in found
    for payload in (
        {"transport": "wifi", "discovery_id": "nearby-token", "name": "Attempt"},
        {
            "transport": "bluetooth",
            "identity": entry.identity.model_dump(),
            "name": "Attempt",
        },
    ):
        assert w.client.post("/api/v1/devices/nearby", json=payload).status_code == 409
    assert w.db.get(Device, w.other.id).owner_id == w.admin.id


def test_bluetooth_identity_registers_new_board_and_rejects_invalid_protocol(workspace):
    w = workspace
    identity = nearby_entry().identity.model_dump()
    payload = {"transport": "bluetooth", "identity": identity, "name": "BLE chamber"}
    assert (
        w.client.post(
            "/api/v1/devices/nearby",
            json={**payload, "identity": {**identity, "protocol": "unrelated-device"}},
        ).status_code
        == 422
    )
    response = w.client.post("/api/v1/devices/nearby", json=payload)
    assert response.status_code == 202 and response.json()["status"] == "pending"
    assert response.json()["owner_id"] == w.owner.id
    # A second serial cannot reuse an existing device's MQTT prefix.
    assert (
        w.client.post(
            "/api/v1/devices/nearby",
            json={
                **payload,
                "identity": {**identity, "serial_number": "ANOTHER-ESP32"},
            },
        ).status_code
        == 409
    )
    # The assigned-serial form must not weaken wireless telemetry validation.
    assert (
        w.client.post(
            "/api/v1/devices/connect",
            json={
                "serial_number": identity["serial_number"],
                "name": "Reconnected",
                "topic_prefix": identity["topic_prefix"],
            },
        ).status_code
        == 202
    )
    assert not ingest_message(
        w.db, identity["topic_prefix"] + "/telemetry", b'{"airTemp":25}'
    )


def test_discovery_rejects_expired_results_and_nonoperators(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr(discovery, "lookup", lambda _token: None)
    assert (
        w.client.post(
            "/api/v1/devices/nearby",
            json={
                "transport": "wifi",
                "discovery_id": "expired",
                "name": "Expired board",
            },
        ).status_code
        == 410
    )
    for user in (w.evaluator, w.pending):
        app.dependency_overrides[get_current_user] = lambda: user
        assert w.client.get("/api/v1/devices/discover").status_code == 403
        assert (
            w.client.post(
                "/api/v1/devices/nearby",
                json={
                    "transport": "bluetooth",
                    "identity": nearby_entry().identity.model_dump(),
                    "name": "Forbidden",
                },
            ).status_code
            == 403
        )


def test_network_discovery_failure_has_actionable_feedback(workspace, monkeypatch):
    def fail():
        raise OSError("Blocked multicast")

    monkeypatch.setattr(discovery, "scan", fail)
    result = workspace.client.get("/api/v1/devices/discover")
    assert (
        result.status_code == 503
        and "local network/multicast" in result.json()["detail"]
    )
