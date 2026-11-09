per-run list price (low / central / high): {'sonnet': '$0.223 / $0.404 / $0.776', 'haiku': '$0.011 / $0.027 / $0.089'}

### minimum viable: L only, Haiku 5.5 (effort high), arms A0 baseline / A1 compact_nograph / A2 compact_graph

| Stage | Repo | Model | Tasks | Arms | Repeats | Runs | List price low / central / high |
|---|---|---|---:|---:|---:|---:|---|
| pilot (dev) | L | haiku | 6 | 3 | 1 | 18 | $0 / $0 / $2 |
| main (test) | L | haiku | 18 | 3 | 3 | 162 | $2 / $4 / $14 |
| **total** | | | | | | **180** | **$2 / $5 / $16** |

Tokens processed (central): 108M input-side (mostly cache reads), 1.4M output. Wall clock (sequential): 4-15 h. Pro 5-hour windows if usage tracks list price: 0.2-1.5.

### full scale: M + L, Haiku A0-A2 x3, no-Grep A3/A4 on L x3, Sonnet 5.5 (effort high) A0/A2 on L x2

| Stage | Repo | Model | Tasks | Arms | Repeats | Runs | List price low / central / high |
|---|---|---|---:|---:|---:|---:|---|
| pilot (dev) | M+L | haiku | 17 | 5 | 1 | 85 | $1 / $2 / $8 |
| pilot (dev) | L | sonnet | 6 | 2 | 1 | 12 | $3 / $5 / $9 |
| main (test) | M+L | haiku | 44 | 3 | 3 | 396 | $4 / $11 / $35 |
| main (test) | L | haiku | 18 | 2 | 3 | 108 | $1 / $3 / $10 |
| main (test) | L | sonnet | 18 | 2 | 2 | 72 | $16 / $29 / $56 |
| **total** | | | | | | **673** | **$25 / $50 / $117** |

Tokens processed (central): 404M input-side (mostly cache reads), 5.4M output. Wall clock (sequential): 17-56 h. Pro 5-hour windows if usage tracks list price: 2.3-10.7.
