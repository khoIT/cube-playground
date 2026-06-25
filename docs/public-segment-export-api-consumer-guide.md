# Public Segment Export API — Consumer Integration Guide

> Audience: engineers of **downstream apps** that pull full segment cohorts
> (hundreds of thousands of uids) from cube-playground. Read this before writing a
> consumer — one section ("Completion contract") is the difference between a
> correct daily snapshot and a silently truncated one.

Status: **planned** (see `plans/260625-1106-public-segment-export-api/`). This guide
documents the contract the endpoint will honor so downstream apps can be built to it.

---

## 1. What this API is

A documented, API-key-secured, **streaming** export. One call streams the entire
cohort of a segment as it is read from the warehouse — the server holds roughly one
page in memory, never the whole cohort.

- `GET /api/public/v1/segments/:id/members` — stream the full cohort (NDJSON or CSV).
- `GET /api/public/v1/segments` / `GET /api/public/v1/segments/:id` — metadata
  (size, freshness, which pull path) so you decide *when* and *what* to pull.

Auth: `Authorization: Bearer sk_live_…` (an API key minted by an admin; scoped to
specific workspaces/segments). Interactive docs live at `/docs`.

> This endpoint is the ONLY full-cohort path. The in-app `GET /api/segments/:id/members`
> is a **capped sampler** (≤1000 ranked profiles / ≤5000 uids) for UI preview — it
> will NOT return all 800k uids. Do not build a snapshot on it.

---

## 2. Streaming response shape

### NDJSON (default, `?format=ndjson`)

```
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
X-Total-Count: 872014

{"uid":"a0000001"}
{"uid":"a0000002"}
…
{"uid":"zzzz9998"}
{"_complete":true,"count":872014}      ← sentinel (last line, only on clean finish)
```

- Each **data** line has one field today, `uid` (more fields land later via
  `?fields=` — see "Forward compatibility"; parse by key, not by assuming one field).
- The **last** line is a control object with `_complete:true`. It is the only line
  that carries `_complete`, so it is unambiguous.

### CSV (`?format=csv`)

```
uid
a0000001
a0000002
…
zzzz9998
# complete,872014                      ← sentinel (last line, only on clean finish)
```

---

## 3. ⚠️ Completion contract — READ THIS

**The problem.** The response streams. The `200 OK` status line goes out on the wire
*before* the first row and cannot be taken back (TCP has no undo). If the warehouse
fails on page 12 of 18, the server can only **close the socket** — it cannot turn the
already-sent `200 OK` into a `500`. To a naive consumer, a truncated pull looks
exactly like a complete one: `200 OK`, valid rows, clean EOF.

**The consequence if you ignore this:** you save 600k of 872k uids, with no error.
Tomorrow's campaign targets 69% of the cohort and nobody notices.

**The contract.** The server gives you two redundant completion signals. A correct
consumer MUST check BOTH before trusting the data:

| Signal | When | What to check |
|---|---|---|
| `X-Total-Count` header | sent before the body | `rows_received == X-Total-Count` |
| trailing sentinel line | only after the final page flushes cleanly | the `_complete` / `# complete` line was seen |

If **either** check fails → the pull is **truncated** → discard it and resume (§4).
Never persist a pull that failed these checks.

> Why two signals? `X-Total-Count` is a cheap up-front cross-check. The sentinel is
> authoritative because HTTP **trailers** (metadata after the body) are stripped by
> many proxies, but a body line we fully control. Together: belt and suspenders.

### What you must implement — 3 rules

Whatever language you use, a correct consumer is exactly these three steps:

1. **Read `X-Total-Count`** from the response header before you start.
2. **Keep reading lines until you see the `_complete` sentinel.** If the connection
   drops before it, re-request with `?cursor=<last uid received>` (§4).
3. **Before saving, assert `rows received == X-Total-Count`.** On mismatch, discard
   and retry — never persist a partial pull.

The reference implementations below mark these three lines.

### Reference consumer — JavaScript (Node 18+)

```js
// Node 18+ — global fetch streams the body; we never buffer the whole cohort.
async function pullSegment(segId, token, base = "https://playground.gds.vng.vn") {
  const url = `${base}/api/public/v1/segments/${segId}/members`;
  const uids = [];
  let cursor = null, expected = null, completed = false;

  while (!completed) {
    const qs = new URLSearchParams({ format: "ndjson" });
    if (cursor) qs.set("cursor", cursor);          // resume from last uid
    const res = await fetch(`${url}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (expected === null)
      expected = Number(res.headers.get("X-Total-Count"));  // rule 1

    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {          // read line by line
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line);
        if (obj._complete) { completed = true; break; }  // rule 2: sentinel
        uids.push(obj.uid);
        cursor = obj.uid;                          // last uid = cursor
      }
      if (completed) break;
    }
    // socket closed before sentinel? loop re-requests from cursor
  }

  if (uids.length !== expected)                    // rule 3
    throw new Error(`truncated: ${uids.length} != ${expected}`);
  return uids;
}
```

### Reference consumer — Go

```go
// bufio.Scanner reads NDJSON line by line; the body is never fully buffered.
func pullSegment(segID, token, base string) ([]string, error) {
	endpoint := base + "/api/public/v1/segments/" + segID + "/members"
	var uids []string
	cursor, expected, completed := "", -1, false

	for !completed {
		q := url.Values{"format": {"ndjson"}}
		if cursor != "" {
			q.Set("cursor", cursor) // resume from last uid
		}
		req, _ := http.NewRequest("GET", endpoint+"?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		if expected < 0 { // rule 1
			expected, _ = strconv.Atoi(resp.Header.Get("X-Total-Count"))
		}

		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Bytes()
			if len(line) == 0 {
				continue
			}
			var obj struct {
				UID      string `json:"uid"`
				Complete bool   `json:"_complete"`
			}
			if json.Unmarshal(line, &obj) != nil {
				continue
			}
			if obj.Complete { // rule 2: sentinel
				completed = true
				break
			}
			uids = append(uids, obj.UID)
			cursor = obj.UID // last uid = cursor
		}
		resp.Body.Close()
		// socket closed before sentinel? loop re-requests from cursor
	}

	if len(uids) != expected { // rule 3
		return nil, fmt.Errorf("truncated: %d != %d", len(uids), expected)
	}
	return uids, nil
}
```

### Reference consumer — Python

```python
import json, requests

def pull_segment(seg_id, token, base="https://playground.gds.vng.vn"):
    url     = f"{base}/api/public/v1/segments/{seg_id}/members"
    headers = {"Authorization": f"Bearer {token}"}
    cursor, uids, completed, expected = None, [], False, None

    while not completed:
        params = {"format": "ndjson"}
        if cursor:
            params["cursor"] = cursor          # resume from last uid
        with requests.get(url, headers=headers, params=params, stream=True) as r:
            r.raise_for_status()
            if expected is None:
                expected = int(r.headers["X-Total-Count"])   # rule 1
            for line in r.iter_lines():        # read line by line
                if not line:
                    continue
                obj = json.loads(line)
                if obj.get("_complete"):       # rule 2: sentinel
                    completed = True
                    break
                uids.append(obj["uid"])
                cursor = obj["uid"]            # last data uid = resume cursor
        # loop re-requests from `cursor` if the socket closed before the sentinel

    assert len(uids) == expected, f"truncated: {len(uids)} != {expected}"  # rule 3
    return uids
```

All three are the same shape: **resume from `cursor` until the sentinel is seen**,
then **assert the count**. Both guards are mandatory in every language.

> A bilingual (EN/Tiếng Việt) interactive version of this guide is published as an
> artifact for downstream teams — share that link for the tabbed, toggleable view.

---

## 4. Resumable pulls (`?cursor=`)

Rows are uid-sorted and keyset-paginated. If a stream truncates, you do **not**
re-pull from zero:

- Re-request with `?cursor=<last data uid you received>`.
- The server resumes at the next uid after the cursor.
- Repeat until you observe the sentinel.

This also lets you pull a huge cohort in deliberate chunks (pass `?limit=` per call)
and survive transient warehouse blips without wasted work.

---

## 5. Choosing when to pull (metadata first)

Call `GET /api/public/v1/segments/:id` first:

- `size` / `uid_count` — how big the pull is.
- `status` — pull only when `fresh`.
- `last_refreshed_at` — freshness.
- which pull path the server will use (pre-built daily snapshot table vs. live
  predicate) — informational; the members endpoint picks automatically.

Daily snapshots refresh nightly; pull once per day after the refresh window.

---

## 6. Errors

| HTTP | Meaning | Action |
|---|---|---|
| `401` | missing/invalid API key | check the `Bearer` token |
| `403` | key not scoped to this segment/workspace | request scope from an admin |
| `404` | segment not visible to this key | verify id + scope |
| `429` | per-key concurrency/quota exceeded | honor `Retry-After`; reduce parallelism |
| `200` then **no sentinel** | mid-stream warehouse failure | resume with `?cursor=` (§3, §4) |

A `200` is necessary but **not sufficient** — completion is proven by §3, not status.

---

## Forward compatibility — more fields are coming

v1 streams **`uid` only at first ship**, but **the API will add more fields over
time** (e.g. rank, identity attributes) as a non-breaking, SemVer-minor evolution
*within v1* — not a v2. To stay compatible, build your consumer to this contract:

- **Tolerate unknown fields.** NDJSON stays object-per-line; a future row may be
  `{"uid":"…","rank":12}`. Read the keys you know, ignore the rest. CSV columns are
  additive with `uid` always first — key by header name, not column index.
- **Opt in with `?fields=`.** Request extra columns explicitly, e.g.
  `?fields=uid,rank`. Default (no param) = `uid`, so today's code keeps working
  unchanged. Unknown/forbidden fields → `400` with the allowed list.
- **Discover what's available.** `GET /api/public/v1/segments/:id` returns
  `available_fields` — the columns your key may request. Some fields may be PII-
  gated and only visible to specifically-scoped keys.

The completion contract (§3) and cursor resume (§4) are unchanged by added fields —
the keyset cursor always stays on `uid`.

## Unresolved questions

- Whether/which PII fields land in the `available_fields` set, and the scope grant
  required to request them (current first ship: `uid` only, no PII).
