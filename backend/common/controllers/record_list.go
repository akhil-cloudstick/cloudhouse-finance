package controllers

import "strings"

// maxListedRecords is how many records a refusal names before it says how many more there are.
const maxListedRecords = 5

// RecordList writes the records standing in the way of an action ("LN-00001, LN-00002 and 2 more"), so a refusal says which ones
// to deal with and not only how many there are. total is the full count, items the first few.
func RecordList(items []string, total int64) string {
	if len(items) > maxListedRecords {
		items = items[:maxListedRecords]
	}
	text := strings.Join(items, ", ")
	if more := total - int64(len(items)); more > 0 {
		if text != "" {
			text += " and "
		}
		text += itoa(more) + " more"
	}
	return text
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
