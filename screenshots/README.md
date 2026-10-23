# Screenshots

Screenshots of the UI. The upload size is chosen in decimal (KB, MB, ...) or binary (KiB, MiB, ...) units; exact bytes
are always shown below the human-readable values.

## Upload form

![Upload form](01-upload-form.png)

Generated payload or custom file, optional slow upload, and the "Find maximum size" check below.

## Successful upload

![Upload result](02-upload-result.png)

Live panel (progress, what the browser sent, what the server saw, speed, stopwatch) and the result with the server's
original response expanded. The server answers with nothing but the received byte count.

## Slow upload

![Live view of a slow upload](03-live-slow-upload.png)

A 8 MiB body streamed at 1 MiB/s, shown mid-upload: current and average speed, bytes sent by the browser versus bytes
seen by the server, and the stopwatch. Streamed bodies need HTTPS (HTTP/2), here the built-in port 8443.

## Upload rejected by a proxy

![Upload rejected with 413](04-rejected-by-proxy.png)

The same app behind nginx with `client_max_body_size 5m`. A 10 MiB upload fails with HTTP 413, the original response
of the proxy is shown, and the server never saw a byte.

## Find maximum size

![Find maximum size](05-find-maximum.png)

Behind the same 5 MB nginx limit: doubling from 1 MiB, then bisecting, reports 5.00 MiB as the largest accepted size.

## Dark mode

![Dark mode](06-dark-mode.png)

The UI follows the system's light or dark setting.

## Mobile

![Mobile layout](07-mobile.png)

Fields and buttons stack on narrow screens.
