package admin

// tsLayout is how the operator console renders timestamps.
//
// It lived in transactions.go, which went with the Route A order timeline it
// existed to display. Every other admin view formats times with it, so it
// belongs here rather than in whichever file happens to survive next.
const tsLayout = "2006-01-02T15:04:05Z07:00"
