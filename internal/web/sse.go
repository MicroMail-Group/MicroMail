package web

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type SSEBroadcaster struct {
	clients map[string]map[chan []byte]bool // map[userID]map[clientChan]bool
	mu      sync.RWMutex
}

func NewSSEBroadcaster() *SSEBroadcaster {
	return &SSEBroadcaster{
		clients: make(map[string]map[chan []byte]bool),
	}
}

func (b *SSEBroadcaster) Subscribe(userID string) chan []byte {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan []byte, 16)
	if _, ok := b.clients[userID]; !ok {
		b.clients[userID] = make(map[chan []byte]bool)
	}
	b.clients[userID][ch] = true
	return ch
}

func (b *SSEBroadcaster) Unsubscribe(userID string, ch chan []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if userClients, ok := b.clients[userID]; ok {
		delete(userClients, ch)
		close(ch)
		if len(userClients) == 0 {
			delete(b.clients, userID)
		}
	}
}

func (b *SSEBroadcaster) Broadcast(userID, eventType string, data any) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	userClients, ok := b.clients[userID]
	if !ok || len(userClients) == 0 {
		return
	}

	payload, err := json.Marshal(map[string]any{
		"type": eventType,
		"data": data,
	})
	if err != nil {
		return
	}

	msg := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, string(payload)))

	for ch := range userClients {
		select {
		case ch <- msg:
		default:
			// Non-blocking drop if channel is full
		}
	}
}

func (b *SSEBroadcaster) ServeHTTP(w http.ResponseWriter, r *http.Request, userID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	clientChan := b.Subscribe(userID)
	defer b.Unsubscribe(userID, clientChan)

	// Send initial connected event
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-clientChan:
			if !ok {
				return
			}
			_, _ = w.Write(msg)
			flusher.Flush()
		case <-ticker.C:
			// Heartbeat comment
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}
