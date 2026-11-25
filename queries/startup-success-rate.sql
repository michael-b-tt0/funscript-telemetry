-- Parameters are the inclusive start and exclusive end in Unix milliseconds,
-- followed by the app version and browser family (NULL or '' for all).
-- Correlated lookups use the batch and position index to scan only events from the matching batches.
WITH attempted_loads AS (
    SELECT batch.page_load_id
    FROM telemetry_events AS attempt
    JOIN telemetry_batches AS batch USING (batch_id)
    WHERE attempt.type = 'startup_attempt'
      AND attempt.occurred_at_ms >= CAST(?1 AS INTEGER)
      AND attempt.occurred_at_ms < CAST(?2 AS INTEGER)
      AND (NULLIF(?3, '') IS NULL OR batch.app_version = ?3)
      AND (NULLIF(?4, '') IS NULL OR batch.browser_family = ?4)
      AND NOT EXISTS (
          SELECT 1
          FROM telemetry_batches AS earlier_batch
          CROSS JOIN telemetry_events AS earlier INDEXED BY telemetry_events_by_batch_position
          WHERE earlier_batch.page_load_id = batch.page_load_id
            AND earlier.batch_id = earlier_batch.batch_id
            AND earlier.type = 'startup_attempt'
            AND (earlier.occurred_at_ms, earlier.event_id) < (attempt.occurred_at_ms, attempt.event_id)
      )
), outcomes AS (
    SELECT EXISTS (
        SELECT 1
        FROM telemetry_batches AS batch
        CROSS JOIN telemetry_events AS event INDEXED BY telemetry_events_by_batch_position
        WHERE batch.page_load_id = attempted_loads.page_load_id
          AND event.batch_id = batch.batch_id
          AND event.type = 'startup_success'
    ) AS succeeded
    FROM attempted_loads
), totals AS (
    SELECT COUNT(*) AS attempted_page_loads, COALESCE(SUM(succeeded), 0) AS successful_page_loads
    FROM outcomes
)
SELECT
    attempted_page_loads,
    successful_page_loads,
    1.0 * successful_page_loads / NULLIF(attempted_page_loads, 0) AS startup_success_rate
FROM totals;
