# Data Sources

All incident data in `data/seed_incidents.json` is sourced from real closed bug issues
on public GitHub repositories. Every incident entry carries a `source_url` field pointing
to the original issue so anyone can verify the data.

## Repositories (153 incidents across 16 repos)

| Repository | Label | What we pulled | Count |
|---|---|---|---|
| [redis/redis](https://github.com/redis/redis) | `class:bug` | Memory, replication, clustering bugs | 14 |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | `kind/bug` | Scheduler, kubelet, networking, storage | 14 |
| [prometheus/prometheus](https://github.com/prometheus/prometheus) | `kind/bug` | Scrape failures, TSDB issues, query bugs | 12 |
| [etcd-io/etcd](https://github.com/etcd-io/etcd) | `type/bug` | Raft, WAL, leader election, snapshot issues | 12 |
| [hashicorp/vault](https://github.com/hashicorp/vault) | `bug` | Auth, token, secret engine failures | 12 |
| [grafana/grafana](https://github.com/grafana/grafana) | `type/bug` | Dashboard, datasource, alerting bugs | 12 |
| [grafana/loki](https://github.com/grafana/loki) | `type/bug` | Log ingestion, querier, compactor issues | 10 |
| [containerd/containerd](https://github.com/containerd/containerd) | `kind/bug` | Container runtime, image pull, snapshot bugs | 10 |
| [cilium/cilium](https://github.com/cilium/cilium) | `kind/bug` | eBPF networking, policy, load balancing bugs | 10 |
| [cockroachdb/cockroach](https://github.com/cockroachdb/cockroach) | `C-bug` | Distributed SQL, replication, storage engine | 8 |
| [jaegertracing/jaeger](https://github.com/jaegertracing/jaeger) | `bug` | Tracing, sampling, storage backend bugs | 8 |
| [vitessio/vitess](https://github.com/vitessio/vitess) | `type: bug` | MySQL sharding, VTGate, replication bugs | 7 |
| [longhorn/longhorn](https://github.com/longhorn/longhorn) | `kind/bug` | Distributed block storage, volume, snapshot | 7 |
| [argoproj/argo-cd](https://github.com/argoproj/argo-cd) | `bug` | GitOps sync, app health, RBAC issues | 6 |
| [open-telemetry/opentelemetry-collector](https://github.com/open-telemetry/opentelemetry-collector) | `bug` | Telemetry pipeline, exporter, receiver bugs | 6 |
| [nats-io/nats-server](https://github.com/nats-io/nats-server) | `bug` | Messaging, clustering, JetStream bugs | 5 |

## How to refresh

```bash
# Requires a GitHub personal access token for the full set (rate limits)
GITHUB_TOKEN=ghp_xxxx python scripts/fetch_real_incidents.py
```

Token needs no scopes — public repo read is unauthenticated by default, the token just
raises the rate limit from 60 to 5000 requests/hour.

## Licenses

All source repos are Apache 2.0, BSD, or MIT licensed. The issue text (bug reports) is
user-contributed content on GitHub, used here for non-commercial research/hackathon purposes
with clear attribution to the source issue URL in every record.
