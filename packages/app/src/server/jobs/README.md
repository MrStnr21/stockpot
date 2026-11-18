# Jobs

The job runner and daily schedules ([D2](../../../../../docs/principles.md#decisions)). Jobs are rows
in the `jobs` table, so they survive a restart, and one worker in the server process works through
them. The [architecture](../../../../../docs/architecture.md#one-process-and-the-job-runner) explains
where the runner sits.

## Jobs

A feature defines each kind of job as a `JobDefinition` (in [`types.ts`](types.ts)): its `kind`, its
handler and, optionally, `maxAttempts`. `server/` never imports a feature, so the entry that starts
the server passes every feature's definitions to the runner:

```ts
const runner = startRunner({
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
- **Restarts.** Jobs that were `running` when the process stopped go back to the queue on the next
  start. Their attempt stays counted, so a job that crashes the process every time still runs out
  of attempts. `stop()` aborts the handler's `signal` and leaves its row `running`, so a stop and a
  crash are recovered the same way.

## Daily schedules

A schedule runs a job once a day at a local time (`'HH:MM'`) in the time zone that the `timeZone`
getter returns. The getter defaults to the system's time zone; SRV-2 passes the setting, and
`refreshSchedules()` moves the planned run when the setting changes. The handler's payload is the
local date its run belongs to, such as `{ day: '2026-11-18' }`.

- **One planned run.** Each schedule keeps exactly one queued row for its next run, and only the
  schedule queues its kind. The next day's run is planned when a run starts, so a slow or crashing
  run cannot lose it, and a restart neither fires a run twice nor skips one.
- **Missed runs.** When the server was down at the run time, the latest missed run fires once as
  soon as the runner starts, with that run's day. Earlier missed days are skipped.
- **DST.** A time that the clocks skip runs as much later as they moved (02:30 runs at 03:30); a time
  that they repeat runs at its first occurrence only. The time zone math in [`daily.ts`](daily.ts)
  uses Temporal, which is server-only here; `src/lib/` runs in the browser.

## Starting and stopping

`startRunner()` starts the one runner of the process and `stopRunner()` stops it, waiting for the
job in hand. Nothing calls them yet, because Astro 7 has no clean place to do it in production:

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
