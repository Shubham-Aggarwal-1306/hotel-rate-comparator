# Hotel Rate Comparator

Full-stack hotel search that queries two supplier APIs **in parallel** through a
[Temporal](https://temporal.io) workflow, tolerates their delays/errors, and returns the
cheapest rate.

```
 React (Vite, TS)  ──POST /api/search-hotels──▶  Express API  ──starts──▶  Temporal Workflow
        ▲                                             │                        │
        │                                             │                 ┌──────┴───────┐
        └────────── best rate / error ────────────────┘                 ▼              ▼
                                                                  fetchSupplierA  fetchSupplierB
                                                                        │              │
                                                                   Mock supplier APIs (Express)
```

## Prerequisites

* Node.js 18+ (developed on Node 24)
* A Temporal server for the "real" setup — either the
  [Temporal CLI](https://docs.temporal.io/cli#install) (`temporal server start-dev`) or Docker.
  If you don't want to install anything, use the all-in-one script below, which boots an
  embedded Temporal dev server.

## Quick start

```bash
npm install
```

### Option A — zero extra tooling (recommended for a quick review)

```bash
npm run stack       # embedded Temporal dev server + suppliers + worker + API + frontend
```

Open http://localhost:5173.

### Option B — the realistic setup (separate processes + Temporal Web UI)

```bash
npm run temporal:dev    # terminal 1 — Temporal server on :7233, Web UI on :8233
npm run dev             # terminal 2 — suppliers, API, worker and frontend
```

| Service          | URL                     |
| ---------------- | ----------------------- |
| Frontend         | http://localhost:5173   |
| API              | http://localhost:4000   |
| Mock suppliers   | http://localhost:4001   |
| Temporal Web UI  | http://localhost:8233   |

## Scripts

| Script                    | What it does                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run stack`           | Everything in one command, embedded Temporal server included       |
| `npm run dev`             | Suppliers + API + worker + frontend (needs a Temporal server)      |
| `npm run dev:suppliers`   | Mock supplier APIs only (`:4001`)                                  |
| `npm run dev:api`         | Express API only (`:4000`)                                         |
| `npm run dev:worker`      | Temporal worker only                                               |
| `npm run dev:frontend`    | React app only (`:5173`)                                           |
| `npm run temporal:dev`    | Temporal dev server via the Temporal CLI                           |
| `npm test`                | Full Jest suite (unit + workflow + end-to-end)                     |
| `npm run test:unit`       | Pure unit tests only (fast, no Temporal server)                    |
| `npm run test:workflow`   | Workflow + end-to-end tests (boot an in-process Temporal server)    |
| `npm run build`           | Type-check and compile backend + frontend                          |
| `npm run lint`            | Type-checks both workspaces                                        |

## API

### `POST /api/search-hotels`

```jsonc
{
  "city": "Paris",
  "checkIn": "2026-10-01",
  "checkOut": "2026-10-04",
  "searchId": "optional-client-id",          // enables cancellation
  "scenario": { "A": "error", "B": "cheap" } // optional supplier simulation
}
```

Response (`200`):

```jsonc
{
  "searchId": "…",
  "status": "OK",                 // OK | NO_HOTELS | ALL_SUPPLIERS_FAILED | CANCELLED
  "best": { "hotelId": "H-1002", "name": "Riverside Inn Paris",
            "price": 179, "currency": "USD", "supplier": "A" },
  "suppliers": [ { "supplier": "A", "status": "ok",        "hotels": [ … ], "durationMs": 46 },
                 { "supplier": "B", "status": "timed_out", "error": "…",    "durationMs": 5003 } ]
}
```

| Situation                              | HTTP | `status`                |
| -------------------------------------- | ---- | ----------------------- |
| A cheapest rate was found              | 200  | `OK`                    |
| Suppliers answered but had no hotels   | 200  | `NO_HOTELS`             |
| The caller cancelled the search        | 200  | `CANCELLED`             |
| Every supplier failed                  | 502  | `ALL_SUPPLIERS_FAILED`  |
| Invalid form input                     | 400  | — (`details[]` per field) |
| Temporal unreachable                   | 503  | — (`error`, `message`)  |

### `DELETE /api/search-hotels/:searchId`

Cancels a running search (`202` when the cancel was requested, `404` if no such run).
The UI's **Cancel** button calls this while the search is in flight.

## Mock supplier APIs

`GET /supplierA/hotels?city=&checkIn=&checkOut=` and `GET /supplierB/hotels?…` return
`{ supplier, hotels: [{ hotelId, name, price, currency }] }`.

Behaviour is deterministic by default and can be forced with `?behavior=`, which is also what
the frontend's "Simulate supplier behaviour" dropdowns and the API's `scenario` field drive:

| `behavior`  | Effect                                                    |
| ----------- | --------------------------------------------------------- |
| `ok`        | Normal catalogue (default)                                 |
| `cheap`     | Same catalogue at 60% of the price                         |
| `expensive` | Same catalogue at 160% of the price                        |
| `tie`       | One hotel at a fixed 199 — both suppliers quote the same    |
| `empty`     | `{ hotels: [] }`                                           |
| `error`     | HTTP 500                                                   |
| `flaky`     | HTTP 503 twice, then success (exercises the retry policy)   |
| `slow`      | Responds after 7s — past the workflow's 5s deadline         |
| `timeout`   | Never responds                                             |

Set `SUPPLIER_CHAOS=1` to have unspecified requests pick a random behaviour
(delays, empties, 500s) instead of always succeeding.

## How the workflow behaves

`searchHotelsWorkflow` ([backend/src/temporal/workflows.ts](backend/src/temporal/workflows.ts)):

* Runs `fetchSupplierA` and `fetchSupplierB` **in parallel**; one supplier can never block the other.
* Each activity has a **retry policy** (3 attempts, 200ms initial interval, 1.5× backoff) and a
  4.5s start-to-close timeout per attempt.
* Each supplier also gets a **5s wall-clock deadline** enforced by a `CancellationScope.withTimeout`.
  When it elapses the activity is cancelled (the HTTP request is aborted through the activity's
  cancellation signal) and the workflow proceeds with whatever the other supplier returned.
* Failures are per supplier: a supplier that fails or times out is recorded as an outcome rather
  than failing the workflow, so partial results are still usable.
* The cheapest offer is chosen deterministically: **price → supplier A before B → hotelId**.
  Determinism matters because the workflow may be replayed.
* On external cancellation the workflow stops **gracefully** — it returns `status: "CANCELLED"`
  with the per-supplier detail instead of failing.
* `supplierOutcomes` query — inspect what each supplier answered while a search is still running
  (also visible in the Temporal Web UI).

## Tests

```bash
npm test          # 63 tests, 7 suites
```

Workflow tests run the real workflow code against an **in-process Temporal server**
(`TestWorkflowEnvironment.createLocal()`), so retries, deadlines and cancellation are exercised
for real rather than mocked. The first run downloads the Temporal test server binary.

### Required scenario coverage

| Scenario                                  | Expected outcome                    | Test |
| ----------------------------------------- | ----------------------------------- | ---- |
| Supplier A cheaper                        | Return A's result                   | `search.workflow.test.ts`, `compare.unit.test.ts` |
| Supplier B cheaper                        | Return B's result                   | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| Both return the same rate                 | Deterministically pick A            | `search.workflow.test.ts`, `compare.unit.test.ts` |
| Supplier A fails, B succeeds              | Return B's result                   | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| Both fail                                 | `ALL_SUPPLIERS_FAILED` (HTTP 502)   | `search.workflow.test.ts`, `api.unit.test.ts` |
| One returns empty                         | Use the available result            | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| Both return empty                         | `NO_HOTELS` / "No hotels found"     | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| One supplier takes > 5s                   | Cancel it, proceed with one result  | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| Supplier A fails 2× before success        | Still succeeds within the retry budget | `search.workflow.test.ts`, `e2e.workflow.test.ts` |
| User cancels mid-way                      | Workflow stops gracefully           | `search.workflow.test.ts` |

Supporting suites: `activities.unit.test.ts` (HTTP timeouts, abort on cancellation, error
mapping), `suppliers.unit.test.ts` (mock supplier behaviours), `validation.unit.test.ts`
(form validation), `api.unit.test.ts` (status-code mapping, cancellation endpoint).

## Configuration

| Variable                   | Default                  | Used by |
| -------------------------- | ------------------------ | ------- |
| `API_PORT`                 | `4000`                   | API, Vite proxy |
| `SUPPLIERS_PORT`           | `4001`                   | Mock suppliers |
| `SUPPLIERS_BASE_URL`       | `http://localhost:4001`  | Activities |
| `SUPPLIER_HTTP_TIMEOUT_MS` | `4000`                   | Activities (per HTTP attempt) |
| `SUPPLIER_CHAOS`           | off                      | Mock suppliers |
| `TEMPORAL_ADDRESS`         | `localhost:7233`         | API, worker |
| `TEMPORAL_NAMESPACE`       | `default`                | API, worker |
| `TEMPORAL_TASK_QUEUE`      | `hotel-search`           | API, worker |

The workflow's own timings (5s supplier deadline, retry policy) live in
[backend/src/temporal/constants.ts](backend/src/temporal/constants.ts) — workflow code must not
read `process.env`, since that would break determinism on replay.

## Assumptions & known limitations

* **Prices are compared as plain numbers in a single currency (USD).** Real suppliers quote
  different currencies, taxes and cancellation policies; a production comparator would normalise
  to a common currency and compare total stay cost.
* **The API call is synchronous** — it blocks until the workflow finishes (bounded by the 5s
  supplier deadline). A production system would return the `searchId` immediately and stream
  results (polling, SSE or websockets); the workflow already supports this via the
  `supplierOutcomes` query.
* **Cancellation needs a client-supplied `searchId`.** The frontend generates a UUID per search;
  without one the API generates its own and the cancel endpoint cannot address the run.
* **Both suppliers return a hotel *list* and only the single cheapest offer is surfaced.**
  The full per-supplier lists are in the response (`suppliers[]`), so showing all rates is
  a UI change only.
* `ALL_SUPPLIERS_FAILED` is returned as a structured `502` body rather than a failed workflow, so
  the caller still sees per-supplier diagnostics. The workflow itself only fails on unexpected errors.
* **No persistence, auth or rate limiting**, and the mock supplier "flaky" counters are in-memory,
  so they reset when the process restarts.
* The all-in-one `npm run stack` uses the Temporal **dev** server (in-memory); state is lost on
  restart and it is not meant for production.
