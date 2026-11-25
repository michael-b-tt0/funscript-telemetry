CREATE TABLE telemetry_batches (
    batch_id TEXT PRIMARY KEY,
    page_load_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    app_version TEXT,
    sent_at_ms INTEGER NOT NULL,
    received_at_ms INTEGER NOT NULL,
    browser_family TEXT NOT NULL,
    browser_major_version INTEGER,
    os_family TEXT NOT NULL,
    os_major_version INTEGER,
    device_type TEXT NOT NULL,
    browser_language TEXT,
    app_language TEXT,
    display_json TEXT NOT NULL CHECK (json_valid(display_json))
) STRICT;

CREATE TABLE telemetry_events (
    event_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES telemetry_batches(batch_id) ON DELETE CASCADE,
    event_index INTEGER NOT NULL CHECK (event_index >= 0),
    occurred_at_ms INTEGER NOT NULL,
    type TEXT NOT NULL,
    tool_id TEXT,
    file_name TEXT,
    phase TEXT,
    error_type TEXT,
    error_code TEXT,
    error_message TEXT
) STRICT;

CREATE INDEX telemetry_batches_by_page_load ON telemetry_batches (page_load_id, received_at_ms);
CREATE INDEX telemetry_batches_by_receipt ON telemetry_batches (received_at_ms);
CREATE UNIQUE INDEX telemetry_events_by_batch_position ON telemetry_events (batch_id, event_index);
CREATE INDEX telemetry_events_by_type_and_time ON telemetry_events (type, occurred_at_ms);
