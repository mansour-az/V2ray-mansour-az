package ui

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/dialog"

	"singbox-launcher/core"
	"singbox-launcher/internal/constants"
	"singbox-launcher/internal/debuglog"
	"singbox-launcher/internal/platform"
)

const venzoUpdateManifestURL = "https://raw.githubusercontent.com/mansour-az/V2ray-mansour-az/venzo-2.0/venzo-windows/latest-windows.json"

type venzoUpdateManifest struct {
	Version      string `json:"version"`
	Tag          string `json:"tag"`
	Name         string `json:"name"`
	InstallerURL string `json:"installer_url"`
	PortableURL  string `json:"portable_url"`
	SHA256       string `json:"sha256"`
	ReleaseURL   string `json:"release_url"`
}

func (v *venzoHome) checkForAppUpdate(manual bool) {
	manifest, err := fetchVenzoUpdateManifest()
	if err != nil {
		debuglog.WarnLog("Venzo update check failed: %v", err)
		if manual {
			fyne.Do(func() { ShowError(v.controller.GetMainWindow(), fmt.Errorf("بررسی بروزرسانی انجام نشد: %w", err)) })
		}
		return
	}
	current := strings.TrimPrefix(constants.AppVersion, "v")
	latest := strings.TrimPrefix(manifest.Version, "v")
	if latest == "" || core.CompareVersions(current, latest) >= 0 {
		if manual {
			fyne.Do(func() { ShowInfo(v.controller.GetMainWindow(), "بروزرسانی", "شما از آخرین نسخه Venzo VPN استفاده می‌کنید.") })
		}
		return
	}

	fyne.Do(func() {
		message := fmt.Sprintf("نسخه جدید %s آماده است. آیا دانلود و نصب شود؟", manifest.Version)
		confirm := dialog.NewConfirm("بروزرسانی Venzo VPN", message, func(ok bool) {
			if !ok {
				return
			}
			v.status.SetText("در حال دانلود بروزرسانی…")
			go v.downloadAndInstallUpdate(manifest)
		}, v.controller.GetMainWindow())
		confirm.SetConfirmText("دانلود و نصب")
		confirm.Show()
	})
}

func fetchVenzoUpdateManifest() (venzoUpdateManifest, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, venzoUpdateManifestURL, nil)
	if err != nil {
		return venzoUpdateManifest{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "VenzoVPN/Windows")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return venzoUpdateManifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return venzoUpdateManifest{}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var manifest venzoUpdateManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return venzoUpdateManifest{}, err
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return venzoUpdateManifest{}, fmt.Errorf("نسخه در کانال بروزرسانی مشخص نشده است")
	}
	return manifest, nil
}

func (v *venzoHome) downloadAndInstallUpdate(manifest venzoUpdateManifest) {
	if runtime.GOOS != "windows" || strings.TrimSpace(manifest.InstallerURL) == "" {
		if manifest.ReleaseURL != "" {
			_ = platform.OpenURL(manifest.ReleaseURL)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifest.InstallerURL, nil)
	if err != nil {
		v.updateDownloadFailed(err)
		return
	}
	req.Header.Set("User-Agent", "VenzoVPN/Windows")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		v.updateDownloadFailed(err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		v.updateDownloadFailed(fmt.Errorf("HTTP %d", resp.StatusCode))
		return
	}
	file, err := os.CreateTemp("", "Venzo-VPN-Setup-*.exe")
	if err != nil {
		v.updateDownloadFailed(err)
		return
	}
	installerPath := file.Name()
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(file, hash), resp.Body)
	closeErr := file.Close()
	if copyErr != nil {
		v.updateDownloadFailed(copyErr)
		return
	}
	if closeErr != nil {
		v.updateDownloadFailed(closeErr)
		return
	}
	if expected := strings.ToLower(strings.TrimSpace(manifest.SHA256)); expected != "" {
		actual := hex.EncodeToString(hash.Sum(nil))
		if actual != expected {
			v.updateDownloadFailed(fmt.Errorf("امضای فایل بروزرسانی معتبر نیست"))
			return
		}
	}
	cmd := exec.Command(installerPath)
	if err := cmd.Start(); err != nil {
		v.updateDownloadFailed(err)
		return
	}
	fyne.Do(func() { v.status.SetText("نصاب بروزرسانی اجرا شد") })
	<-time.After(800 * time.Millisecond)
	v.controller.GracefulExit()
}

func (v *venzoHome) updateDownloadFailed(err error) {
	debuglog.WarnLog("Venzo update download failed: %v", err)
	fyne.Do(func() {
		v.status.SetText("دانلود بروزرسانی ناموفق بود")
		ShowError(v.controller.GetMainWindow(), fmt.Errorf("دانلود بروزرسانی انجام نشد: %w", err))
	})
}
