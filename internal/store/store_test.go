package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreOperations(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "micromail-store-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := Open(tempDir)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer s.Close()

	// 1. Ensure User
	user, err := s.EnsureUser("test@example.com", "secret123", "Test User")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	if user.Email != "test@example.com" {
		t.Errorf("expected email test@example.com, got %s", user.Email)
	}

	// 2. Authenticate User
	authed, err := s.AuthenticateUser("test@example.com", "secret123")
	if err != nil {
		t.Fatalf("authentication failed: %v", err)
	}
	if authed.ID != user.ID {
		t.Errorf("user ID mismatch")
	}

	// 3. Create Message
	msg := &Message{
		UserID:      user.ID,
		Folder:      "INBOX",
		Sender:      "alice@example.com",
		Recipients:  []string{"test@example.com"},
		Subject:     "Quarterly Report",
		Snippet:     "Here is the report...",
		BodyText:    "Here is the report for Q3 with financial metrics.",
		RawBlobPath: filepath.Join("2026", "11", "msg1.eml"),
		Tags:        []string{"finance", "verified-sender"},
		SpamScore:   0.05,
		IsRead:      false,
	}

	if err := s.CreateMessage(msg); err != nil {
		t.Fatalf("failed to create message: %v", err)
	}

	// 4. List Threads
	threads, err := s.ListThreads(user.ID, "INBOX", 10, 0)
	if err != nil {
		t.Fatalf("failed to list threads: %v", err)
	}
	if len(threads) != 1 {
		t.Fatalf("expected 1 thread, got %d", len(threads))
	}
	if threads[0].Subject != "Quarterly Report" {
		t.Errorf("expected subject 'Quarterly Report', got %s", threads[0].Subject)
	}
	if !threads[0].HasUnread {
		t.Errorf("expected thread to have unread status initially")
	}

	counts, err := s.GetFolderCounts(user.ID)
	if err != nil || counts["INBOX"] != 1 {
		t.Errorf("expected 1 unread message in INBOX, got %d (err: %v)", counts["INBOX"], err)
	}

	// Mark thread as read
	if err := s.UpdateUserThreadRead(user.ID, threads[0].ThreadID, true); err != nil {
		t.Fatalf("failed to mark thread as read: %v", err)
	}

	threadsRead, err := s.ListThreads(user.ID, "INBOX", 10, 0)
	if err != nil || len(threadsRead) != 1 {
		t.Fatalf("failed to list threads after marking read: %v", err)
	}
	if threadsRead[0].HasUnread {
		t.Errorf("expected thread HasUnread to be false after marking read")
	}

	countsRead, err := s.GetFolderCounts(user.ID)
	if err != nil || countsRead["INBOX"] != 0 {
		t.Errorf("expected 0 unread messages in INBOX after reading, got %d", countsRead["INBOX"])
	}

	// 5. Search Messages via FTS5
	searchResults, err := s.SearchMessages(user.ID, "financial", 10)
	if err != nil {
		t.Fatalf("failed to search messages: %v", err)
	}
	if len(searchResults) != 1 {
		t.Errorf("expected 1 search result for 'financial', got %d", len(searchResults))
	}

	// 6. Addons Table CRUD
	addon := &InstalledAddon{
		ID:           "test.addon",
		Name:         "Test Addon",
		Version:      "1.0.0",
		Runtime:      "frontend",
		ManifestJSON: `{"id":"test.addon","name":"Test Addon"}`,
		ConfigJSON:   `{"active":true}`,
		Enabled:      true,
	}
	if err := s.SaveAddon(addon); err != nil {
		t.Fatalf("failed to save addon: %v", err)
	}

	savedAddon, err := s.GetAddon("test.addon")
	if err != nil || savedAddon == nil {
		t.Fatalf("failed to retrieve addon: %v", err)
	}
	if !savedAddon.Enabled {
		t.Errorf("expected addon to be enabled")
	}

	if err := s.SetAddonEnabled("test.addon", false); err != nil {
		t.Fatalf("failed to toggle addon: %v", err)
	}

	disabledAddon, _ := s.GetAddon("test.addon")
	if disabledAddon.Enabled {
		t.Errorf("expected addon to be disabled")
	}

	if err := s.DeleteAddon("test.addon"); err != nil {
		t.Fatalf("failed to delete addon: %v", err)
	}

	// 7. Test Moving Thread from Spam to INBOX (verifying unique IMAP UID re-indexing and spam tag cleanup)
	spamMsg := &Message{
		UserID:      user.ID,
		Folder:      "Spam",
		Sender:      "suspicious@example.org",
		Recipients:  []string{"test@example.com"},
		Subject:     "Potential Spam Notification",
		Snippet:     "Check this link...",
		BodyText:    "Suspicious message body",
		RawBlobPath: filepath.Join("2026", "11", "msg2.eml"),
		Tags:        []string{"spam", "unverified"},
		SpamScore:   0.85,
		IsRead:      false,
	}
	if err := s.CreateMessage(spamMsg); err != nil {
		t.Fatalf("failed to create spam message: %v", err)
	}

	// Verify it starts in Spam
	spamThreads, err := s.ListThreads(user.ID, "Spam", 10, 0)
	if err != nil || len(spamThreads) != 1 {
		t.Fatalf("expected 1 thread in Spam, got %d (err: %v)", len(spamThreads), err)
	}

	// Move user thread from Spam to INBOX
	if err := s.MoveUserThread(user.ID, spamMsg.ThreadID, "INBOX"); err != nil {
		t.Fatalf("failed to move user thread from Spam to INBOX: %v", err)
	}

	// Verify Spam is now empty
	spamThreadsAfter, err := s.ListThreads(user.ID, "Spam", 10, 0)
	if err != nil || len(spamThreadsAfter) != 0 {
		t.Fatalf("expected 0 threads in Spam after move, got %d", len(spamThreadsAfter))
	}

	// Verify INBOX now has 2 threads
	inboxThreadsAfter, err := s.ListThreads(user.ID, "INBOX", 10, 0)
	if err != nil || len(inboxThreadsAfter) != 2 {
		t.Fatalf("expected 2 threads in INBOX after move, got %d", len(inboxThreadsAfter))
	}

	// Verify the moved message's attributes: folder=INBOX, spam tag stripped, spam_score reset
	movedMsgs, err := s.GetUserThreadMessages(user.ID, spamMsg.ThreadID)
	if err != nil || len(movedMsgs) != 1 {
		t.Fatalf("failed to get moved message: %v", err)
	}
	if movedMsgs[0].Folder != "INBOX" {
		t.Errorf("expected folder INBOX, got %s", movedMsgs[0].Folder)
	}
	if movedMsgs[0].SpamScore != 0.0 {
		t.Errorf("expected spam score 0.0, got %f", movedMsgs[0].SpamScore)
	}
	for _, tag := range movedMsgs[0].Tags {
		if tag == "spam" {
			t.Errorf("expected 'spam' tag to be stripped, but found it in tags: %v", movedMsgs[0].Tags)
		}
	}
	// Verify IMAP UID is distinct from the first message in INBOX (which had UID 1)
	if movedMsgs[0].IMAPUID <= 1 {
		t.Errorf("expected newly re-indexed IMAP UID > 1 in INBOX, got %d", movedMsgs[0].IMAPUID)
	}

	// 8. Test Postmaster Deduplication & No Localhost Auto-Creation
	// Simulate legacy database that had postmaster@localhost created
	legacyPM, err := s.EnsureUser("postmaster@localhost", "secret123", "Legacy Postmaster")
	if err != nil {
		t.Fatalf("failed to create legacy postmaster: %v", err)
	}
	// Add an email to legacy postmaster
	pmMsg := &Message{
		UserID:      legacyPM.ID,
		Folder:      "INBOX",
		Sender:      "reports@dmarc.google.com",
		Recipients:  []string{"postmaster@localhost"},
		Subject:     "Report Domain: example.com",
		Snippet:     "DMARC Report",
		BodyText:    "DMARC aggregate data",
		RawBlobPath: "2026/11/pm1.eml",
		Tags:        []string{"dmarc"},
		IsRead:      true,
	}
	if err := s.CreateMessage(pmMsg); err != nil {
		t.Fatalf("failed to create message for legacy postmaster: %v", err)
	}

	// Run ResegmentUserMailboxes for configured domain
	if err := s.ResegmentUserMailboxes("example.com", "admin@example.com"); err != nil {
		t.Fatalf("ResegmentUserMailboxes failed: %v", err)
	}

	// Assert postmaster@localhost is gone from users
	afterLegacyPM, _ := s.GetUserByEmail("postmaster@localhost")
	if afterLegacyPM != nil {
		t.Errorf("expected postmaster@localhost to be deleted, but still exists")
	}

	// Assert postmaster@example.com exists
	domainPM, err := s.GetUserByEmail("postmaster@example.com")
	if err != nil || domainPM == nil {
		t.Fatalf("expected postmaster@example.com to exist")
	}

	// Assert the message was migrated to domain postmaster
	migratedMsgs, err := s.GetUserThreadMessages(domainPM.ID, pmMsg.ThreadID)
	if err != nil || len(migratedMsgs) != 1 {
		t.Fatalf("expected message to be migrated to postmaster@example.com, got %d messages", len(migratedMsgs))
	}
	if migratedMsgs[0].UserID != domainPM.ID {
		t.Errorf("expected message user_id to be %s, got %s", domainPM.ID, migratedMsgs[0].UserID)
	}
}

func TestConversationThreadingAndRepair(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "micromail-thread-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := Open(tempDir)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer s.Close()

	user, err := s.EnsureUser("bob@example.com", "pass123", "Bob")
	if err != nil {
		t.Fatalf("failed to ensure user: %v", err)
	}

	// 1. Initial message
	msg1 := &Message{
		UserID:          user.ID,
		Folder:          "INBOX",
		MessageIDHeader: "<msg1@example.com>",
		Sender:          "alice@example.com",
		Recipients:      []string{"bob@example.com"},
		Subject:         "Product Launch Planning",
		Snippet:         "Let's discuss the Q4 launch.",
		BodyText:        "Let's discuss the Q4 launch details.",
	}
	if err := s.CreateMessage(msg1); err != nil {
		t.Fatalf("failed to create msg1: %v", err)
	}

	// 2. Reply recognized by Subject
	msg2 := &Message{
		UserID:     user.ID,
		Folder:     "INBOX",
		Sender:     "alice@example.com",
		Recipients: []string{"bob@example.com"},
		Subject:    "Re: Product Launch Planning",
		Snippet:    "Here are the launch dates.",
		BodyText:    "Here are the launch dates we agreed on.",
	}
	if err := s.CreateMessage(msg2); err != nil {
		t.Fatalf("failed to create msg2: %v", err)
	}
	if msg2.ThreadID != msg1.ThreadID {
		t.Errorf("expected msg2 to share thread_id %s, got %s", msg1.ThreadID, msg2.ThreadID)
	}

	// 3. Reply recognized by InReplyTo
	msg3 := &Message{
		UserID:     user.ID,
		Folder:     "INBOX",
		InReplyTo:  "<msg1@example.com>",
		Sender:     "charlie@example.com",
		Recipients: []string{"bob@example.com"},
		Subject:    "Different Subject But In-Reply-To",
		Snippet:    "Adding my thoughts.",
		BodyText:    "Adding my thoughts to the launch.",
	}
	if err := s.CreateMessage(msg3); err != nil {
		t.Fatalf("failed to create msg3: %v", err)
	}
	if msg3.ThreadID != msg1.ThreadID {
		t.Errorf("expected msg3 to share thread_id %s via InReplyTo, got %s", msg1.ThreadID, msg3.ThreadID)
	}

	threadMsgs, err := s.GetUserThreadMessages(user.ID, msg1.ThreadID)
	if err != nil || len(threadMsgs) != 3 {
		t.Fatalf("expected 3 messages in thread %s, got %d", msg1.ThreadID, len(threadMsgs))
	}
}
