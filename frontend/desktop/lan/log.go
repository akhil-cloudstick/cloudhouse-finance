// Package lan lets PCs running this app find each other on a local network (a direct LAN cable, a switch or a router) and
// shows every step in a log. Phase 0 only discovers and tests the connection: it never touches the offline store.
package lan

import (
	"fmt"
	"os"
	"sync"
	"time"
)

const (
	maxEntries = 2000
	maxLogFile = 1 << 20 // the file is rotated to <name>.old above this size
)

// Entry is one line of the LAN log, as shown on the Network screen.
type Entry struct {
	Time      string `json:"time"`
	Level     string `json:"level"` // info, ok, warn, error
	Component string `json:"component"`
	Message   string `json:"message"`
}

// Logger keeps the last lines in memory, appends every line to a file, and tells the screen about each new one.
type Logger struct {
	mu     sync.Mutex
	buf    []Entry
	path   string
	fileMu sync.Mutex
	emit   func(event string, data any)
}

func NewLogger(path string, emit func(event string, data any)) *Logger {
	return &Logger{path: path, emit: emit}
}

func (l *Logger) Path() string { return l.path }

func (l *Logger) Log(level, component, format string, args ...any) {
	e := Entry{
		Time:      time.Now().Format("15:04:05"),
		Level:     level,
		Component: component,
		Message:   fmt.Sprintf(format, args...),
	}
	l.mu.Lock()
	l.buf = append(l.buf, e)
	if len(l.buf) > maxEntries {
		l.buf = append([]Entry(nil), l.buf[len(l.buf)-maxEntries:]...)
	}
	l.mu.Unlock()
	l.appendFile(e)
	if l.emit != nil {
		l.emit("lan:log", e)
	}
}

// Entries returns a copy of the lines held in memory, oldest first.
func (l *Logger) Entries() []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]Entry(nil), l.buf...)
}

// Clear empties the on-screen log. The file keeps its history.
func (l *Logger) Clear() {
	l.mu.Lock()
	l.buf = nil
	l.mu.Unlock()
}

func (l *Logger) appendFile(e Entry) {
	if l.path == "" {
		return
	}
	l.fileMu.Lock()
	defer l.fileMu.Unlock()
	if info, err := os.Stat(l.path); err == nil && info.Size() > maxLogFile {
		_ = os.Remove(l.path + ".old")
		_ = os.Rename(l.path, l.path+".old")
	}
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %-5s %-8s %s\n", time.Now().Format("2006-01-02 15:04:05"), e.Level, e.Component, e.Message)
}
