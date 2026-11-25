# Funscript telemetry

Send batches to `POST /telemetry` using `telemetry.schema.json`. For a browser beacon, pass `JSON.stringify(batch)` to `navigator.sendBeacon`. A `204` response means D1 accepted the batch, including any previously recorded event IDs. The Worker accepts up to 64 KiB per request and stores filenames and error messages as submitted within the schema.

## D1 setup

Start the local Worker with `npm run dev`. For the project's name-only D1 binding, apply the initial schema once to a fresh local database. The commands below use PowerShell.

```powershell
$migration = (Get-Content migrations/0001_telemetry.sql) -join ' '
npx cf d1 raw DB-funscript-telemetry --local --sql $migration
```

For a deployed database, apply the versioned migration with `npx cf d1 migrations apply DATABASE_UUID` using the UUID of `funscript-telemetry-db`.

## Startup success rate

Emit `startup_attempt` from the JavaScript collector before starting Blazor, and reuse its `pageLoadId` when reporting the outcome. The query counts each observed attempt once, credits a success from any batch for that page load, and returns `NULL` when the cohort has zero attempts.

Run the query with an inclusive start and exclusive end in Unix milliseconds. The third and fourth parameters filter by app version and browser family at the time of the first attempt. Use empty strings to include all versions and browsers. Choose an end time that gives recent attempts time to report their outcomes.

```powershell
$fromMs = [DateTimeOffset]::UtcNow.AddDays(-7).ToUnixTimeMilliseconds()
$toMs = [DateTimeOffset]::UtcNow.AddHours(-1).ToUnixTimeMilliseconds()
$query = (Get-Content queries/startup-success-rate.sql | Where-Object { $_ -notmatch '^\s*--' }) -join ' '
npx cf d1 raw DB-funscript-telemetry --local --sql $query --params $fromMs $toMs '2.4' 'safari'
```
