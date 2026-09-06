package money

// Physical banknote denominations, which are a property of a currency's
// circulating cash rather than of the money type. Cash recognition needs them;
// nothing else does.

// NairaDenominations lists Nigerian banknotes currently in circulation,
// largest first. Both the older designs and the redesigned 200, 500 and 1000
// notes circulate and are the same denomination.
var NairaDenominations = []Amount{
	Naira(1000), Naira(500), Naira(200),
	Naira(100), Naira(50), Naira(20),
	Naira(10), Naira(5),
}

// IsNairaDenomination reports whether v is a real Nigerian banknote value.
// Recognition output claiming anything else is a reading error, not a
// banknote, and must be rejected rather than counted -- a model that reports a
// ₦300 note has misread something, and averaging that into a total produces a
// number nobody can reconcile against the cash on the table.
func IsNairaDenomination(v Amount) bool {
	if v.Currency() != NGN {
		return false
	}
	for _, d := range NairaDenominations {
		if d.Minor() == v.Minor() {
			return true
		}
	}
	return false
}
