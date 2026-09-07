package v1

import (
	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/internal/agents"
	"github.com/usezoracle/tapp/api/internal/cash"
	"github.com/usezoracle/tapp/api/internal/risk"
	"github.com/usezoracle/tapp/api/internal/risk/forensics"
	"github.com/usezoracle/tapp/api/internal/risk/rules"
	"github.com/usezoracle/tapp/api/internal/risk/vision"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// NewCashHandler builds the cash pledge flow.
//
// Returns nil when there is no recogniser, and the routes are then not
// registered. That is deliberate and it is the one place this decision can be
// made honestly: a cash pledge with no recognition is a photograph nobody
// looked at, and accepting those would mean crediting people for pictures.
// Better that the feature is visibly absent than silently unscreened.
func NewCashHandler() *CashHandler {
	key := config.CryptoConfig().AnthropicAPIKey()
	if key == "" {
		logger.Infof("cash: no ANTHROPIC_API_KEY -- cash pledges are not available")
		return nil
	}

	recogniser := vision.NewClaude(key, config.VisionModel())

	// The engine every pledge is put through. Order does not matter -- checks
	// are independent by contract -- but the set does: dropping one silently
	// weakens every pledge that follows.
	engine := &risk.Engine{
		Thresholds: risk.DefaultThresholds(),
		Store:      &risk.PostgresStore{Pool: storage.Pool},
		Checks: []risk.Check{
			&vision.Check{Provider: recogniser},
			&forensics.Check{},
			rules.NewVelocity(storage.Pool),
			&rules.Geo{Pool: storage.Pool},
		},
	}

	return &CashHandler{
		Svc: &cash.Service{
			Pool:       storage.Pool,
			Recogniser: recogniser,
			Risk:       engine,
		},
		Read:   &cash.Reader{Pool: storage.Pool},
		Agents: &agents.Store{Pool: storage.Pool},
		User:   UserFromContext,
	}
}
