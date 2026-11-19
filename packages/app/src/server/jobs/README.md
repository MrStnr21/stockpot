# Jobs

The job runner and daily schedules ([D2](../../../../../docs/principles.md#decisions)). Jobs are rows
in the `jobs` table, so they survive a restart, and one worker in the server process works through
them. The [architecture](../../../../../docs/architecture.md#one-process-and-the-job-runner) explains
where the runner sits.

| File                           | What it holds                                                     |
| ------------------------------ | ----------------------------------------------------------------- |
| [`types.ts`](types.ts)         | the public types: job definitions, schedules, the runner, health  |
| [`runner.ts`](runner.ts)       | `createRunner`, and `startRunner`/`stopRunner` for the process    |
| [`worker.ts`](worker.ts)       | the worker: claims, retries, timeouts, backoff on database errors |
| [`queue.ts`](queue.ts)         | the queries on the `jobs` table                                   |
| [`schedules.ts`](schedules.ts) | planning each schedule's run                                      |
| [`daily.ts`](daily.ts)         | the time zone math for daily runs                                 |

## Jobs

A feature defines each kind of job as a `JobDefinition`: its `kind`, its handler and, optionally,
`maxAttempts` and `timeout`. `server/` never imports a feature, so the entry that starts the server
passes every feature's definitions to the runner:

```ts
const runner = await startRunner({
	db,
	jobs: [researchJob],
	schedules: [{ job: digestJob, at: '07:00' }],
})

runner.enqueue(researchJob, { noteId }, { priority: 'now' })
```

- **Enqueue and return.** `enqueue` writes the row and returns its id; a request handler never waits
  for the job. The payload is stored as JSON, so it holds plain data.
- **Priorities.** The worker takes the due job with the highest priority, then the earliest run time,
  then the oldest row: a `now` job overtakes the queued `batch` jobs. The query is served by
  `jobs_queue_idx`, and a spec checks its plan.
- **No polling.** The worker sleeps on one timer set for the earliest queued run time, and enqueue
  wakes it.
- **Retries.** A handler that throws runs again after 30 seconds, then after a delay that doubles up
  to an hour. After its last attempt (5 unless the definition says otherwise) the job is `failed`,
  with the error in `last_error`.
- **Timeouts.** A run that takes longer than its `timeout` (30 minutes unless the definition says
  otherwise; research runs up to 15) counts as a failed attempt and is retried the same way.
- **Restarts.** Jobs that were `running` when the process stopped go back to the queue on the next
  start. Their attempt stays counted, so a job that crashes the process every time still runs out
  of attempts.

### The handler contract

A handler gets an `AbortSignal` in its context. It aborts when the run times out or when the runner
stops. **Every handler passes this signal to whatever it awaits:** `fetch`, `spawn`, engine calls
and anything else that can take long. The worker stops waiting for a handler when its time is up,
and a stop waits for it at most 10 seconds, but JavaScript cannot end a promise from outside.

A handler that ignores the signal keeps running after its timeout or after a stop that stopped
waiting for it. Its row is retried, or requeued on the next start, so **a new runner may run the same
row again while the old handler is still at work**, and both may write their results. The runner
does not guard against this; passing the signal on is what prevents it.

## Daily schedules

A schedule runs a job once a day at a local time (`'HH:MM'`) in the time zone that the `timeZone`
getter returns. The getter defaults to the system's time zone; SRV-2 passes the setting, and
`refreshSchedules()` plans again when the setting changes. The handler's payload is the local date
its run belongs to, such as `{ day: '2026-11-18' }`.

- **One planned run.** Each schedule keeps exactly one queued row for its next run, and only the
  schedule queues its kind. A run is claimed and the next day's run planned in one transaction, so a
  crash or an invalid time zone neither leaves the row running nor loses the plan.
- **Changes keep the day.** When the time zone or the time of day changes, the planned run keeps its
  day and moves to that day's time in the new zone or at the new time. If that time has passed, it
  fires at once, so a change never runs a day twice or skips one.
- **Missed runs.** Only the latest missed run fires. When the server was down at the run time, or the
  queue was busy past a later day's time, the run fires once with the latest missed day, and the
  next run is planned for the day after it.
- **DST.** A time that the clocks skip runs as much later as they moved (02:30 runs at 03:30); a time
  that they repeat runs at its first occurrence only. The time zone math uses Temporal, which is
  server-only here; `src/lib/` runs in the browser.

## Database errors and health

When the worker's own queries fail, for example on a full disk or a read-only file, it logs the
error with its cause and tries again after 30 seconds, doubling up to 5 minutes, instead of
retrying at once. It goes back to normal once it gets through the queue without an error.
`runner.health()` returns `{ status: 'healthy' }` or `{ status: 'failing', lastError, failedAt }` for
the health check (SRV-7). A handler's own errors stay on its job and do not count here.

## Starting and stopping

`startRunner()` starts the one runner of the process, after any stop still in progress, and
`stopRunner()` stops it. The stop takes no new job, aborts the handler's signal and waits at most 10
seconds for it; a job still in hand stays `running` and is requeued on the next start, as after a
crash. The runner counts as started until its stop has finished.

Nothing calls them yet, because Astro 7 has no clean place to do it in production:

- the integration hooks `astro:server:setup`, `astro:server:start` and `astro:server:done` run only
  in the dev server;
- `@astrojs/node` takes only `mode`, `experimentalDisableStreaming`, `staticHeaders` and
  `bodySizeLimit`, with no startup callback;
- the standalone entry starts the server as soon as it is imported, unless `ASTRO_NODE_AUTOSTART` is
  `disabled`, and exports `startServer` and `handler`.

The first story that needs the runner wires it: for example an entry script that disables the
autostart, opens the database, calls `startServer()` and `startRunner()`, and calls `stopRunner()` on
`SIGTERM` and `SIGINT`. Routes and the runner must share one module instance, so that story also
decides how request handlers reach `enqueue`.
