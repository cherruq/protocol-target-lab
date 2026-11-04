# HTTP target

The HTTP worker runs continuously in its Docker container until explicitly stopped.
It uses Python 3.12's standard library and has no package downloads or external service dependencies.
The manager supplies `--bind-ip`, `--port`, and `--response-body` as individual arguments.
The default response body is UTF-8 `hello`.

| Path | GET response delimiter | HEAD | POST |
| --- | --- | --- | --- |
| `/ok` | Content-Length | Same response headers, no body | Echo request body |
| `/chunked` | Transfer-Encoding: chunked | Same response headers, no body | Echo request body in chunks |
| `/close` | Connection: close, no length header | Same response headers, no body | Echo request body then close |

Unknown paths return 404. Other methods return 501. Requests use HTTP/1.1; `/ok`
and `/chunked` support repeated requests on one connection. A request body is limited
to 1 MiB; chunked request bodies are unsupported. Each connection has a five-second
socket timeout, and at most 64 connections run concurrently. These limits do not
expire the service or limit its total request count.

JSON events go to stdout. Request and response body logs include `body_length`,
a hexadecimal preview of at most 256 bytes, and `body_truncated`. They describe
HTTP bodies rather than claiming to be a full wire capture. Docker's bounded log
driver and the manager provide log retention and streaming. SIGTERM closes active
sockets and the listening socket.

To validate an already-running instance without changing it:

```sh
python3 public-tests/http_smoke.py --host 192.0.2.20 --port 18090 --body hello --output evidence/http.json
```

Replace the documentation address with the actual target address. The client checks
two rounds of GET/HEAD/POST on all three paths, the response delimiters, repeat
requests, 404, and raw HEAD responses. It exits nonzero on failure. It does not start
containers, modify instances, or simulate protocol success.
