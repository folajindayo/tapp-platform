# imports/

Source material being consumed by the consolidation, kept whole and working
until the last thing that needs it has been ported out.

## `tender/`

The cash settlement layer, imported with its history. It is a **separate Go
module** (`tender/api`), so it does not participate in `apps/api`'s build and
cannot break it. It stays buildable and testable on its own, which is the
point: porting a ledger by reading a dead snapshot is how invariants get lost,
and its test suite is the reference for whether the port is faithful.

What comes out of it, and when:

| From | To | Phase |
|---|---|---|
| `internal/money` | `apps/api/internal/money` | 1 |
| `internal/ledger` | `apps/api/internal/ledger` | 1 |
| `internal/migrate/sql` | `apps/api/migrations` | 1 |
| `internal/vision`, `phash` | `apps/api/internal/risk/vision` | 3 |
| `internal/settle`, `domain` | `apps/api/internal/cash` | 3 |
| `internal/payout` | `apps/api/internal/settlement` | 4 |

`internal/store`, `stream`, `httpapi`, `config`, `fintava` and `bootstrap`
have equivalents in `apps/api` already and are not ported; where the tender
version is better, the improvement moves across rather than the file.

**This directory is deleted at the end of Phase 4.** If it is still here after
that, either the port is incomplete or something is still depending on it —
both are worth noticing, which is why it is not being quietly carried along
inside `apps/api`.
