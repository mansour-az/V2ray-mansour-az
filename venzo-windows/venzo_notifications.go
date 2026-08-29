package ui

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"fyne.io/fyne/v2"
	"singbox-launcher/internal/debuglog"
)

const venzoAnnouncementsURL = venzoStoreAPI + "/v1/announcements"

type venzoAnnouncement struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	ActionURL string `json:"action_url"`
}

func (v *venzoHome) startAnnouncementLoop() {
	<-time.After(12 * time.Second)
	v.checkAnnouncements()
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			v.checkAnnouncements()
		case <-v.stop:
			return
		}
	}
}

func (v *venzoHome) checkAnnouncements() {
	seen, _ := loadSeenAnnouncements()
	rows, err := fetchVenzoAnnouncements()
	if err != nil {
		debuglog.WarnLog("Venzo announcements: %v", err)
		return
	}
	changed := false
	for _, row := range rows {
		if row.ID == "" || seen[row.ID] {
			continue
		}
		seen[row.ID] = true
		changed = true
		if v.controller != nil && v.controller.UIService != nil && v.controller.UIService.Application != nil {
			v.controller.UIService.Application.SendNotification(fyne.NewNotification(row.Title, row.Body))
		}
	}
	if changed {
		if err := saveSeenAnnouncements(seen); err != nil {
			debuglog.WarnLog("Venzo announcements state: %v", err)
		}
	}
}

func fetchVenzoAnnouncements() ([]venzoAnnouncement, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, venzoAnnouncementsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "VenzoVPN/Windows-2.7")
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	var envelope struct {
		Announcements []venzoAnnouncement `json:"announcements"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope); err != nil {
		return nil, err
	}
	return envelope.Announcements, nil
}

func seenAnnouncementsPath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "Venzo VPN", "seen-announcements.json"), nil
}

func loadSeenAnnouncements() (map[string]bool, error) {
	path, err := seenAnnouncementsPath()
	if err != nil {
		return map[string]bool{}, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]bool{}, nil
	}
	if err != nil {
		return map[string]bool{}, err
	}
	seen := map[string]bool{}
	if err := json.Unmarshal(data, &seen); err != nil {
		return map[string]bool{}, err
	}
	return seen, nil
}

func saveSeenAnnouncements(seen map[string]bool) error {
	path, err := seenAnnouncementsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(seen)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
