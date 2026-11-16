package web

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"micromail/internal/store"
)

func setupTestStore(t *testing.T) (*store.Store, func()) {
	tmpDir, err := os.MkdirTemp("", "micromail-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	st, err := store.Open(tmpDir)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatalf("failed to open store: %v", err)
	}

	cleanup := func() {
		st.Close()
		os.RemoveAll(tmpDir)
	}
	return st, cleanup
}

func TestUserSessionManagement(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	authMgr := NewAuthManager(st)

	user, err := st.CreateUser("user@example.com", "password123", "User One")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	// Create 2 sessions
	req1 := httptest.NewRequest("GET", "/", nil)
	req1.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0")
	req1.RemoteAddr = "192.168.1.100:54321"
	token1 := authMgr.CreateSessionWithReq(user, req1)

	req2 := httptest.NewRequest("GET", "/", nil)
	req2.Header.Set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")
	req2.RemoteAddr = "10.0.0.5:12345"
	token2 := authMgr.CreateSessionWithReq(user, req2)

	// Test ListUserSessionsHandler with session 1 as current
	listReq := httptest.NewRequest("GET", "/api/user/sessions", nil)
	ctx := context.WithValue(listReq.Context(), userContextKey, user)
	ctx = context.WithValue(ctx, sessionTokenContextKey, token1)
	listReq = listReq.WithContext(ctx)

	rr := httptest.NewRecorder()
	authMgr.ListUserSessionsHandler(rr, listReq)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var sessions []UserSessionDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("failed to unmarshal sessions: %v", err)
	}

	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	if !sessions[0].Current {
		t.Errorf("expected first session to be current")
	}

	var remoteSessID string
	for _, s := range sessions {
		if !s.Current {
			remoteSessID = s.ID
		}
	}
	if remoteSessID == "" {
		t.Fatalf("expected remote session ID")
	}

	// Test Revoke specific session (remote session 2)
	revokePayload, _ := json.Marshal(map[string]string{"session_id": remoteSessID})
	revokeReq := httptest.NewRequest("POST", "/api/user/sessions/revoke", bytes.NewReader(revokePayload))
	revokeReq = revokeReq.WithContext(ctx)

	rrRevoke := httptest.NewRecorder()
	authMgr.RevokeUserSessionHandler(rrRevoke, revokeReq)

	if rrRevoke.Code != http.StatusOK {
		t.Fatalf("expected revoke status 200, got %d: %s", rrRevoke.Code, rrRevoke.Body.String())
	}

	// Check that token2 is now invalid
	if u := authMgr.GetUser(token2); u != nil {
		t.Errorf("token2 should have been revoked")
	}
	// Check that token1 is still valid
	if u := authMgr.GetUser(token1); u == nil {
		t.Errorf("token1 should still be valid")
	}

	// Create a third session and test RevokeOtherUserSessionsHandler
	token3 := authMgr.CreateSessionWithReq(user, req2)
	if u := authMgr.GetUser(token3); u == nil {
		t.Errorf("token3 should be valid")
	}

	revokeOthersReq := httptest.NewRequest("POST", "/api/user/sessions/revoke-others", nil)
	revokeOthersReq = revokeOthersReq.WithContext(ctx)

	rrOthers := httptest.NewRecorder()
	authMgr.RevokeOtherUserSessionsHandler(rrOthers, revokeOthersReq)

	if rrOthers.Code != http.StatusOK {
		t.Fatalf("expected 200 from revoke-others, got %d", rrOthers.Code)
	}

	if u := authMgr.GetUser(token3); u != nil {
		t.Errorf("token3 should have been revoked by revoke-others")
	}
	if u := authMgr.GetUser(token1); u == nil {
		t.Errorf("token1 (current) should still be valid")
	}
}

func TestEmailTemplatesLifecycle(t *testing.T) {
	st, cleanup := setupTestStore(t)
	defer cleanup()

	user, err := st.CreateUser("user2@example.com", "password123", "User Two")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	mailHdls := &MailHandlers{store: st}

	// 1. Create Template
	createBody, _ := json.Marshal(CreateTemplateRequest{
		Name:    "Client Follow-up",
		Subject: "Quick check-in regarding our call",
		Body:    "Hi [Client],\nJust following up on our discussion.",
	})
	createReq := httptest.NewRequest("POST", "/api/user/templates", bytes.NewReader(createBody))
	createReq = createReq.WithContext(context.WithValue(createReq.Context(), userContextKey, user))

	rrCreate := httptest.NewRecorder()
	mailHdls.CreateTemplateHandler(rrCreate, createReq)

	if rrCreate.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rrCreate.Code, rrCreate.Body.String())
	}

	var created store.EmailTemplate
	if err := json.Unmarshal(rrCreate.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created template: %v", err)
	}
	if created.Name != "Client Follow-up" {
		t.Errorf("expected name 'Client Follow-up', got %s", created.Name)
	}

	// 2. List Templates
	listReq := httptest.NewRequest("GET", "/api/user/templates", nil)
	listReq = listReq.WithContext(context.WithValue(listReq.Context(), userContextKey, user))

	rrList := httptest.NewRecorder()
	mailHdls.ListTemplatesHandler(rrList, listReq)

	if rrList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrList.Code, rrList.Body.String())
	}
	var list []*store.EmailTemplate
	if err := json.Unmarshal(rrList.Body.Bytes(), &list); err != nil {
		t.Fatalf("failed to decode list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 template in list, got %d", len(list))
	}

	// 3. Update Template
	updateBody, _ := json.Marshal(UpdateTemplateRequest{
		Name:    "Client Follow-up (Updated)",
		Subject: "Quick check-in regarding our call (Updated)",
		Body:    "Updated body content",
	})
	updateReq := httptest.NewRequest("PUT", "/api/user/templates/"+created.ID, bytes.NewReader(updateBody))
	updateReq.SetPathValue("id", created.ID)
	updateReq = updateReq.WithContext(context.WithValue(updateReq.Context(), userContextKey, user))

	rrUpdate := httptest.NewRecorder()
	mailHdls.UpdateTemplateHandler(rrUpdate, updateReq)

	if rrUpdate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrUpdate.Code, rrUpdate.Body.String())
	}

	// 4. Delete Template
	delReq := httptest.NewRequest("DELETE", "/api/user/templates/"+created.ID, nil)
	delReq.SetPathValue("id", created.ID)
	delReq = delReq.WithContext(context.WithValue(delReq.Context(), userContextKey, user))

	rrDel := httptest.NewRecorder()
	mailHdls.DeleteTemplateHandler(rrDel, delReq)

	if rrDel.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrDel.Code, rrDel.Body.String())
	}

	// 5. Verify list is empty
	rrList2 := httptest.NewRecorder()
	mailHdls.ListTemplatesHandler(rrList2, listReq)
	var list2 []*store.EmailTemplate
	_ = json.Unmarshal(rrList2.Body.Bytes(), &list2)
	if len(list2) != 0 {
		t.Errorf("expected 0 templates after delete, got %d", len(list2))
	}
}
