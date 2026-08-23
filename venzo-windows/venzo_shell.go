package ui

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"singbox-launcher/api"
	"singbox-launcher/core"
	"singbox-launcher/core/config/configtypes"
	"singbox-launcher/core/services"
	"singbox-launcher/core/state"
	"singbox-launcher/core/uiservice"
	"singbox-launcher/internal/debuglog"
	"singbox-launcher/internal/locale"
	"singbox-launcher/internal/platform"
)

// VenzoWindowSize is deliberately compact. The upstream desktop layout starts
// at 1000x700; Venzo's home screen is designed as a focused one-click client.
var VenzoWindowSize = fyne.NewSize(920, 610)

const (
	venzoFreeCatalogURL = "https://venzo-store-api.mascot-gt.workers.dev/v1/free/subscription"
	venzoFallbackURL    = "https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/all/configs_base64.txt"
	venzoStoreURL       = "https://t.me/venzo_vpn"
)

type venzoHome struct {
	app        *App
	controller *core.AppController

	root       *fyne.Container
	body       *fyne.Container
	home       fyne.CanvasObject
	status     *widget.Label
	location   *widget.Label
	protocol   *widget.Label
	ping       *widget.Label
	healthy    *widget.Label
	power      *widget.Button
	refresh    *widget.Button

	stop chan struct{}
}

// NewVenzoShell wraps the mature upstream engine with Venzo's compact home
// experience. Advanced pages remain available through Servers and Settings.
func NewVenzoShell(app *App, controller *core.AppController) fyne.CanvasObject {
	v := &venzoHome{
		app:        app,
		controller: controller,
		stop:       make(chan struct{}),
	}
	v.home = v.buildHome()
	v.body = container.NewStack(v.home)
	v.root = container.NewBorder(v.buildHeader(), v.buildFooter(), nil, nil, v.body)

	go v.bootstrap()
	go v.refreshLoop()
	return v.root
}

func (v *venzoHome) bootstrap() {
	if err := ensureVenzoFreeSources(v.controller); err != nil {
		debuglog.WarnLog("Venzo bootstrap: failed to prepare free sources: %v", err)
		return
	}
	if _, err := os.Stat(v.controller.FileService.ConfigPath); os.IsNotExist(err) {
		core.RunParserProcess()
	}
}

func (v *venzoHome) buildHeader() fyne.CanvasObject {
	iconResource := fyne.NewStaticResource("venzo.ico", v.controller.UIService.AppIconData.Content())
	logo := canvas.NewImageFromResource(iconResource)
	logo.FillMode = canvas.ImageFillContain
	logo.SetMinSize(fyne.NewSize(64, 64))

	brand := widget.NewLabelWithStyle("VenzoVPN", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	tagline := widget.NewLabel("SECURE · FAST · PRIVATE")
	brandBlock := container.NewVBox(brand, tagline)

	darkMode := widget.NewCheck("حالت شب", func(on bool) {
		uiservice.ApplyVenzoTheme(v.controller.UIService.Application, on)
	})
	darkMode.SetChecked(true)

	header := container.NewBorder(nil, nil, container.NewHBox(logo, brandBlock), darkMode)
	return container.NewPadded(header)
}

func (v *venzoHome) buildHome() fyne.CanvasObject {
	v.location = trailingLabel("در حال یافتن بهترین سرور…", true)
	v.protocol = trailingLabel("—", false)
	v.ping = trailingLabel("— ms", false)
	v.healthy = trailingLabel("۰ سرور سالم", false)

	v.refresh = widget.NewButtonWithIcon("بروزرسانی", theme.ViewRefreshIcon(), v.refreshSources)
	serverCard := widget.NewCard("بهترین سرور", "انتخاب خودکار بر اساس اینترنت شما", container.NewVBox(
		v.location,
		separator(),
		v.protocol,
		separator(),
		v.ping,
		separator(),
		v.healthy,
		layout.NewSpacer(),
		v.refresh,
	))

	v.status = widget.NewLabelWithStyle("آماده اتصال", fyne.TextAlignCenter, fyne.TextStyle{Bold: true})
	v.power = widget.NewButtonWithIcon("اتصال هوشمند", theme.MediaPlayIcon(), v.toggleConnection)
	v.power.Importance = widget.HighImportance
	connectCard := widget.NewCard("اتصال هوشمند", "سریع‌ترین سرور سالم به‌صورت خودکار انتخاب می‌شود", container.NewVBox(
		layout.NewSpacer(),
		container.NewCenter(v.power),
		container.NewCenter(v.status),
		layout.NewSpacer(),
	))

	grid := container.NewGridWithColumns(2, serverCard, connectCard)
	return container.NewPadded(grid)
}

func (v *venzoHome) buildFooter() fyne.CanvasObject {
	servers := widget.NewButtonWithIcon("سرورها", theme.StorageIcon(), func() {
		v.showTab(v.app.clashAPITab)
	})
	store := widget.NewButtonWithIcon("خرید اشتراک", theme.AccountIcon(), func() {
		if err := platform.OpenURL(venzoStoreURL); err != nil {
			ShowError(v.controller.GetMainWindow(), err)
		}
	})
	settings := widget.NewButtonWithIcon("تنظیمات", theme.SettingsIcon(), func() {
		for _, item := range v.app.tabs.Items {
			if strings.Contains(item.Text, locale.T("app.tab.settings")) {
				v.showTab(item)
				return
			}
		}
	})
	home := widget.NewButtonWithIcon("اتصال", theme.HomeIcon(), func() {
		v.showHome()
	})
	return container.NewPadded(container.NewGridWithColumns(4, home, servers, store, settings))
}

func (v *venzoHome) showTab(item *container.TabItem) {
	if item == nil {
		return
	}
	v.app.tabs.Select(item)
	v.body.Objects = []fyne.CanvasObject{container.NewScroll(v.app.tabs)}
	v.body.Refresh()
}

func (v *venzoHome) showHome() {
	if v.controller.APIService != nil {
		v.controller.APIService.SetProxyScope(services.ScopeLocal)
	}
	v.body.Objects = []fyne.CanvasObject{v.home}
	v.body.Refresh()
	v.refreshStatus()
}

func (v *venzoHome) refreshLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			fyne.Do(v.refreshStatus)
		case <-v.stop:
			return
		}
	}
}

func (v *venzoHome) refreshStatus() {
	if v.controller == nil || v.controller.APIService == nil {
		return
	}
	proxies := v.controller.APIService.GetProxiesList()
	best := bestProxy(proxies)
	healthy := 0
	for _, p := range proxies {
		if p.Delay > 0 {
			healthy++
		}
	}
	if best.Name != "" {
		v.location.SetText(countryFromName(best.DisplayOrName()))
		protocol := strings.ToUpper(strings.TrimSpace(best.ClashType))
		if protocol == "" {
			protocol = "AUTO"
		}
		v.protocol.SetText(protocol)
		if best.Delay > 0 {
			v.ping.SetText(fmt.Sprintf("%d ms", best.Delay))
		} else {
			v.ping.SetText("در انتظار تست پینگ")
		}
	} else {
		v.location.SetText("در حال یافتن بهترین سرور…")
		v.protocol.SetText("—")
		v.ping.SetText("— ms")
	}
	v.healthy.SetText(fmt.Sprintf("%d سرور سالم", healthy))

	if v.controller.RunningState != nil && v.controller.RunningState.IsRunning() {
		v.status.SetText("متصل و محافظت‌شده")
		v.power.SetText("قطع اتصال")
		v.power.SetIcon(theme.MediaStopIcon())
	} else {
		v.status.SetText("آماده اتصال")
		v.power.SetText("اتصال هوشمند")
		v.power.SetIcon(theme.MediaPlayIcon())
	}
}

func (v *venzoHome) toggleConnection() {
	if v.controller.RunningState != nil && v.controller.RunningState.IsRunning() {
		v.status.SetText("در حال قطع اتصال…")
		go core.StopSingBoxProcess()
		return
	}
	v.power.Disable()
	v.status.SetText("بروزرسانی و تست سرورها…")
	go func() {
		defer fyne.Do(v.power.Enable)
		if err := ensureVenzoFreeSources(v.controller); err != nil {
			debuglog.WarnLog("Venzo bootstrap: %v", err)
		}
		core.RunParserProcess()
		if !waitForFile(v.controller.FileService.ConfigPath, 25*time.Second) {
			fyne.Do(func() { v.status.SetText("ساخت کانفیگ ناموفق بود؛ دوباره تلاش کنید") })
			return
		}
		core.StartSingBoxProcess()
		<-time.After(5 * time.Second)
		v.controller.APIService.AutoLoadProxies(context.Background())
		if v.controller.UIService.AutoPingAfterConnectFunc != nil {
			v.controller.UIService.AutoPingAfterConnectFunc()
		}
		<-time.After(7 * time.Second)
		selectBestProxy(v.controller)
		fyne.Do(v.refreshStatus)
	}()
}

func (v *venzoHome) refreshSources() {
	v.refresh.Disable()
	v.status.SetText("در حال بروزرسانی منابع رایگان…")
	go func() {
		defer fyne.Do(v.refresh.Enable)
		if err := ensureVenzoFreeSources(v.controller); err != nil {
			fyne.Do(func() { v.status.SetText("خطا در آماده‌سازی منابع") })
			return
		}
		core.RunParserProcess()
		<-time.After(4 * time.Second)
		fyne.Do(func() { v.status.SetText("منابع بروزرسانی شدند") })
	}()
}

func ensureVenzoFreeSources(controller *core.AppController) error {
	if controller == nil || controller.FileService == nil {
		return fmt.Errorf("file service unavailable")
	}
	statePath := platform.GetWizardStatePath(controller.FileService.ExecDir)
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		return err
	}
	s, err := state.Load(statePath)
	if err != nil {
		s = state.New()
	}
	if s == nil {
		s = state.New()
	}
	known := make(map[string]bool)
	for _, source := range s.Connections.Sources {
		known[source.URL] = true
	}
	for _, sourceURL := range []string{venzoFreeCatalogURL, venzoFallbackURL} {
		if known[sourceURL] {
			continue
		}
		s.Connections.Sources = append(s.Connections.Sources, state.Source{
			ID:      state.MakeULID(),
			Type:    state.SourceTypeSubscription,
			Enabled: true,
			Label:   "Venzo Free",
			URL:     sourceURL,
		})
	}
	if len(s.Connections.Outbounds) == 0 {
		s.Connections.Outbounds = []configtypes.OutboundConfig{
			{Tag: "auto-proxy-out", Ref: configtypes.RefTemplate},
			{Tag: "proxy-out", Ref: configtypes.RefTemplate},
		}
	}
	if s.Connections.Defaults.Reload == "" {
		s.Connections.Defaults.Reload = "1h"
	}
	return s.Save(statePath)
}

func selectBestProxy(controller *core.AppController) {
	if controller == nil || controller.APIService == nil {
		return
	}
	best := bestProxy(controller.APIService.GetProxiesList())
	group := controller.APIService.GetSelectedClashGroup()
	if best.Name == "" || group == "" {
		return
	}
	if err := controller.APIService.SwitchProxy(group, best.Name); err != nil {
		debuglog.WarnLog("Venzo smart-connect: switch to %q failed: %v", best.Name, err)
	}
}

func bestProxy(proxies []api.ProxyInfo) api.ProxyInfo {
	var best api.ProxyInfo
	for _, p := range proxies {
		kind := strings.ToLower(strings.TrimSpace(p.ClashType))
		if kind == "selector" || kind == "urltest" || kind == "direct" || p.Delay <= 0 {
			continue
		}
		if best.Name == "" || p.Delay < best.Delay {
			best = p
		}
	}
	if best.Name == "" {
		for _, p := range proxies {
			kind := strings.ToLower(strings.TrimSpace(p.ClashType))
			if kind != "selector" && kind != "urltest" && kind != "direct" {
				return p
			}
		}
	}
	return best
}

func countryFromName(name string) string {
	lower := strings.ToLower(name)
	countries := []struct {
		keys []string
		name string
	}{
		{[]string{"germany", "de-", " de ", "آلمان"}, "آلمان"},
		{[]string{"netherlands", "nl-", "هلند"}, "هلند"},
		{[]string{"finland", "fi-", "فنلاند"}, "فنلاند"},
		{[]string{"france", "fr-", "فرانسه"}, "فرانسه"},
		{[]string{"turkey", "tr-", "ترکیه"}, "ترکیه"},
		{[]string{"united kingdom", "uk-", "gb-", "انگلیس"}, "انگلیس"},
		{[]string{"united states", "usa", "us-", "آمریکا"}, "آمریکا"},
		{[]string{"canada", "ca-", "کانادا"}, "کانادا"},
		{[]string{"singapore", "sg-", "سنگاپور"}, "سنگاپور"},
		{[]string{"japan", "jp-", "ژاپن"}, "ژاپن"},
	}
	for _, country := range countries {
		for _, key := range country.keys {
			if strings.Contains(lower, key) {
				return country.name
			}
		}
	}
	if strings.TrimSpace(name) == "" {
		return "موقعیت نامشخص"
	}
	return name
}

func trailingLabel(text string, bold bool) *widget.Label {
	return widget.NewLabelWithStyle(text, fyne.TextAlignTrailing, fyne.TextStyle{Bold: bold})
}

func separator() fyne.CanvasObject {
	line := canvas.NewRectangle(theme.Color(theme.ColorNameSeparator))
	line.SetMinSize(fyne.NewSize(0, 1))
	return line
}

func waitForFile(path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if info, err := os.Stat(path); err == nil && info.Size() > 0 {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}
