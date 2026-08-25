package ui

import (
	"context"
	"fmt"
	"image/color"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
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
	"singbox-launcher/internal/debuglog"
	"singbox-launcher/internal/locale"
	"singbox-launcher/internal/platform"
)

// VenzoWindowSize matches the approved desktop composition: server rail on
// the left, one-click connection in the middle and Persian navigation right.
var VenzoWindowSize = fyne.NewSize(1080, 720)

const (
	venzoFreeCatalogURL = "https://venzo-store-api.mascot-gt.workers.dev/v1/free/subscription"
	venzoFallbackURL    = "https://cdn.jsdelivr.net/gh/0xRadikal/Free-v2ray-Configs@main/all/configs_base64.txt"
	venzoFilteredURL    = "https://raw.githubusercontent.com/indelingDanil/MyAppVPN/proxylist/output/filtered.txt"
	venzoUniversalURL   = "https://raw.githubusercontent.com/zieng2/wl/main/vless_universal.txt"
	venzoIgareckURL     = "https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/BLACK_VLESS_RUS.txt"
	venzoSupportURL     = "https://t.me/Venzzo_vpn"
)

var (
	venzoCyan      = color.NRGBA{R: 88, G: 213, B: 228, A: 255}
	venzoCyanDeep  = color.NRGBA{R: 11, G: 70, B: 82, A: 255}
	venzoGraphite  = color.NRGBA{R: 5, G: 12, B: 24, A: 255}
	venzoPanel     = color.NRGBA{R: 9, G: 24, B: 38, A: 255}
	venzoSilver    = color.NRGBA{R: 171, G: 190, B: 202, A: 255}
)

type venzoHome struct {
	app        *App
	controller *core.AppController

	root  *fyne.Container
	body  *fyne.Container
	home  fyne.CanvasObject
	store fyne.CanvasObject

	status          *widget.Label
	location        *widget.Label
	locationDetail  *widget.Label
	protocol        *widget.Label
	ping            *widget.Label
	healthy         *widget.Label
	serviceStatus   *widget.Label
	duration        *widget.Label
	durationSummary *widget.Label
	protection      *widget.Label
	power           *widget.Button
	refresh         *widget.Button
	serverRows      *fyne.Container
	serverSignature string
	connectedAt     time.Time
	connectionMu    sync.RWMutex
	connecting      bool
	verified        bool
	verifiedProxy   string
	baselineIP      string
	lastFailure     string

	navHome     *widget.Button
	navServers  *widget.Button
	navPrivacy  *widget.Button
	navStore    *widget.Button
	navSettings *widget.Button
	stop        chan struct{}
}

// NewVenzoShell preserves the real upstream sing-box controller and replaces
// only the user-facing shell with the approved Venzo 2.5.1 desktop design.
func NewVenzoShell(app *App, controller *core.AppController) fyne.CanvasObject {
	v := &venzoHome{app: app, controller: controller, stop: make(chan struct{})}
	v.home = v.buildHome()
	v.body = container.NewStack(v.home)
	v.root = container.NewBorder(v.buildHeader(), v.buildStatusBar(), nil, nil, v.body)

	go v.bootstrap()
	go v.refreshLoop()
	go func() {
		<-time.After(4 * time.Second)
		v.checkForAppUpdate(false)
	}()
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
	logo.SetMinSize(fyne.NewSize(42, 42))
	brand := container.NewHBox(logo, container.NewVBox(
		widget.NewLabelWithStyle("Venzo VPN", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("Windows · 2.6.0"),
	))

	v.navHome = widget.NewButtonWithIcon("خانه", theme.HomeIcon(), v.showHome)
	v.navHome.Importance = widget.HighImportance
	v.navServers = widget.NewButtonWithIcon("سرورها", theme.StorageIcon(), v.showServers)
	v.navPrivacy = widget.NewButtonWithIcon("حریم خصوصی", theme.VisibilityOffIcon(), v.showPrivacy)
	v.navStore = widget.NewButtonWithIcon("فروشگاه", theme.AccountIcon(), v.showStore)
	v.navSettings = widget.NewButtonWithIcon("تنظیمات", theme.SettingsIcon(), func() {
		v.setActiveNav(v.navSettings)
		for _, item := range v.app.tabs.Items {
			if strings.Contains(item.Text, locale.T("app.tab.settings")) {
				v.showTab(item)
				return
			}
		}
	})
	updateButton := widget.NewButtonWithIcon("بروزرسانی", theme.DownloadIcon(), func() { go v.checkForAppUpdate(true) })
	nav := container.NewHBox(v.navSettings, v.navStore, v.navPrivacy, v.navServers, v.navHome)
	return container.NewPadded(container.NewBorder(nil, nil, brand, updateButton, container.NewCenter(nav)))
}

func (v *venzoHome) buildNavigation() fyne.CanvasObject {
	iconResource := fyne.NewStaticResource("venzo.ico", v.controller.UIService.AppIconData.Content())
	logo := canvas.NewImageFromResource(iconResource)
	logo.FillMode = canvas.ImageFillContain
	logo.SetMinSize(fyne.NewSize(54, 54))
	brand := widget.NewLabelWithStyle("Venzo VPN", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true})
	tagline := widget.NewLabelWithStyle("امن، سریع، ساده", fyne.TextAlignTrailing, fyne.TextStyle{})
	brandRow := container.NewHBox(layout.NewSpacer(), container.NewVBox(brand, tagline), logo)

	v.serviceStatus = widget.NewLabelWithStyle("در حال آماده‌سازی سرویس…", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true})
	serviceCard := widget.NewCard("وضعیت سرویس", "", container.NewVBox(v.serviceStatus, trailingLabel("کانفیگ‌های رایگان و اختصاصی", false)))

	v.navHome = widget.NewButtonWithIcon("خانه", theme.HomeIcon(), v.showHome)
	v.navHome.Importance = widget.HighImportance
	v.navServers = widget.NewButtonWithIcon("سرورها", theme.StorageIcon(), func() {
		v.setActiveNav(v.navServers)
		v.showTab(v.app.clashAPITab)
	})
	v.navStore = widget.NewButtonWithIcon("فروشگاه", theme.AccountIcon(), v.showStore)
	v.navSettings = widget.NewButtonWithIcon("تنظیمات", theme.SettingsIcon(), func() {
		v.setActiveNav(v.navSettings)
		for _, item := range v.app.tabs.Items {
			if strings.Contains(item.Text, locale.T("app.tab.settings")) {
				v.showTab(item)
				return
			}
		}
	})
	support := widget.NewButtonWithIcon("پشتیبانی", theme.HelpIcon(), func() {
		if err := platform.OpenURL(venzoSupportURL); err != nil {
			ShowError(v.controller.GetMainWindow(), err)
		}
	})

	content := container.NewVBox(brandRow, serviceCard, separator(), v.navHome, v.navServers, v.navStore, v.navSettings, layout.NewSpacer(), support)
	background := canvas.NewRectangle(venzoPanel)
	background.SetMinSize(fyne.NewSize(235, 0))
	return container.NewStack(background, container.NewPadded(content))
}

func (v *venzoHome) buildServerPanel() fyne.CanvasObject {
	v.location = trailingLabel("در حال یافتن بهترین سرور…", true)
	v.locationDetail = trailingLabel("انتخاب هوشمند", false)
	v.protocol = widget.NewLabelWithStyle("—", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true, Bold: true})
	v.ping = widget.NewLabelWithStyle("— ms", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true, Bold: true})
	v.healthy = trailingLabel("۰ سرور سالم", false)

	selected := widget.NewCard("سرور منتخب", "", container.NewVBox(
		v.location,
		v.locationDetail,
		separator(),
		container.NewGridWithColumns(2,
			widget.NewCard("پروتکل", "", container.NewCenter(v.protocol)),
			widget.NewCard("پینگ", "", container.NewCenter(v.ping)),
		),
	))
	v.serverRows = container.NewVBox(widget.NewLabel("در حال دریافت نتایج پینگ…"))
	v.refresh = widget.NewButtonWithIcon("بروزرسانی سرورها", theme.ViewRefreshIcon(), v.refreshSources)
	heading := widget.NewLabelWithStyle("بهترین سرور", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true})
	caption := widget.NewLabelWithStyle("انتخاب هوشمند بر اساس پینگ", fyne.TextAlignTrailing, fyne.TextStyle{})

	content := container.NewVBox(
		container.NewHBox(layout.NewSpacer(), container.NewVBox(heading, caption), widget.NewIcon(theme.StorageIcon())),
		separator(), selected, v.healthy,
		widget.NewLabelWithStyle("۳ سرور سریع‌تر", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true}),
		v.serverRows, layout.NewSpacer(), v.refresh,
	)
	background := canvas.NewRectangle(venzoGraphite)
	background.SetMinSize(fyne.NewSize(305, 0))
	return container.NewStack(background, container.NewPadded(content))
}

func (v *venzoHome) buildHome() fyne.CanvasObject {
	v.status = widget.NewLabelWithStyle("آماده اتصال", fyne.TextAlignCenter, fyne.TextStyle{Bold: true})
	v.duration = widget.NewLabelWithStyle("00:00:00", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true})
	v.durationSummary = widget.NewLabelWithStyle("00:00:00", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true})
	v.protection = widget.NewLabelWithStyle("برای شروع فقط دکمه اتصال را بزنید", fyne.TextAlignCenter, fyne.TextStyle{})
	v.power = widget.NewButtonWithIcon("اتصال هوشمند", theme.MediaPlayIcon(), v.toggleConnection)
	v.power.Importance = widget.HighImportance

	v.location = trailingLabel("انتخاب خودکار", true)
	v.locationDetail = trailingLabel("سریع‌ترین سرور قابل اتصال", false)
	v.protocol = widget.NewLabelWithStyle("AUTO", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true, Bold: true})
	v.ping = widget.NewLabelWithStyle("— ms", fyne.TextAlignCenter, fyne.TextStyle{Monospace: true, Bold: true})
	v.healthy = trailingLabel("در انتظار تست", false)
	v.serviceStatus = trailingLabel("آماده", true)
	v.serverRows = container.NewVBox(trailingLabel("پس از اتصال، سرورهای قابل استفاده نمایش داده می‌شوند", false))
	v.refresh = widget.NewButtonWithIcon("بروزرسانی فهرست سرورها", theme.ViewRefreshIcon(), v.refreshSources)

	intro := widget.NewCard("اتصال امن و ساده", "Venzo بهترین سرور را پیدا می‌کند و عبور واقعی اینترنت را قبل از نمایش وضعیت متصل بررسی می‌کند.", container.NewVBox(
		v.status,
		container.NewCenter(v.duration),
		container.NewCenter(v.power),
		v.protection,
	))
	server := widget.NewCard("سرور انتخاب‌شده", "Ping به‌تنهایی به معنی اتصال نیست", container.NewVBox(
		v.location,
		v.locationDetail,
		container.NewGridWithColumns(3,
			widget.NewCard("پروتکل", "", container.NewCenter(v.protocol)),
			widget.NewCard("تأخیر", "", container.NewCenter(v.ping)),
			widget.NewCard("وضعیت", "", container.NewCenter(v.healthy)),
		),
	))
	quickPrivacy := widget.NewCard("حریم خصوصی", "برگرفته از راهنمای پیوست", container.NewGridWithColumns(3,
		container.NewVBox(widget.NewLabelWithStyle("DNS", fyne.TextAlignCenter, fyne.TextStyle{Bold: true}), widget.NewLabelWithStyle("محافظت در حالت TUN", fyne.TextAlignCenter, fyne.TextStyle{})),
		container.NewVBox(widget.NewLabelWithStyle("WebRTC", fyne.TextAlignCenter, fyne.TextStyle{Bold: true}), widget.NewLabelWithStyle("راهنمای مرورگر", fyne.TextAlignCenter, fyne.TextStyle{})),
		container.NewVBox(widget.NewLabelWithStyle("Fingerprint", fyne.TextAlignCenter, fyne.TextStyle{Bold: true}), widget.NewLabelWithStyle("کاهش ردپای دیجیتال", fyne.TextAlignCenter, fyne.TextStyle{})),
	))
	content := container.NewVBox(layout.NewSpacer(), intro, server, quickPrivacy, layout.NewSpacer())
	background := canvas.NewRectangle(venzoGraphite)
	return container.NewStack(background, container.NewPadded(content))
}

func (v *venzoHome) buildStatusBar() fyne.CanvasObject {
	return container.NewPadded(container.NewBorder(nil, nil,
		widget.NewLabel("Venzo Core · sing-box"), v.serviceStatus,
		container.NewCenter(widget.NewLabel("VPN (TUN) · بررسی اتصال انتها‌به‌انتها"))))
}

func (v *venzoHome) setActiveNav(active *widget.Button) {
	for _, button := range []*widget.Button{v.navHome, v.navServers, v.navPrivacy, v.navStore, v.navSettings} {
		if button != nil {
			button.Importance = widget.MediumImportance
			button.Refresh()
		}
	}
	if active != nil {
		active.Importance = widget.HighImportance
		active.Refresh()
	}
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
	v.setActiveNav(v.navHome)
	if v.controller.APIService != nil {
		v.controller.APIService.SetProxyScope(services.ScopeLocal)
	}
	v.body.Objects = []fyne.CanvasObject{v.home}
	v.body.Refresh()
	v.refreshStatus()
}

func (v *venzoHome) showServers() {
	v.setActiveNav(v.navServers)
	heading := trailingLabel("سرورها", true)
	description := trailingLabel("فهرست بر اساس Ping مرتب می‌شود، اما نشان «تأییدشده» فقط بعد از عبور واقعی اینترنت نمایش داده می‌شود.", false)
	panel := widget.NewCard("انتخاب سرور", "Venzo هنگام اتصال چند سرور سریع را به‌ترتیب آزمایش می‌کند.", container.NewVBox(
		v.healthy,
		v.serverRows,
		v.refresh,
	))
	content := container.NewVBox(heading, description, separator(), panel, layout.NewSpacer())
	v.body.Objects = []fyne.CanvasObject{container.NewStack(canvas.NewRectangle(venzoGraphite), container.NewPadded(content))}
	v.body.Refresh()
}

func (v *venzoHome) showPrivacy() {
	v.setActiveNav(v.navPrivacy)
	dnsState := "برای فعال‌سازی، ابتدا VPN را متصل کنید"
	v.connectionMu.RLock()
	if v.verified {
		dnsState = "مسیر VPN تأیید شده؛ DNS در حالت TUN محافظت می‌شود"
	}
	v.connectionMu.RUnlock()

	dns := widget.NewCard("محافظت DNS", dnsState, trailingLabel("در نسخه جدید، وضعیت امن فقط بعد از تست اینترنت اعلام می‌شود.", false))
	webrtc := widget.NewCard("نشت WebRTC", "WebRTC به مرورگر مربوط است و از داخل VPN قابل خاموش‌کردن نیست.", widget.NewButton("اجرای تست WebRTC در مرورگر", func() {
		if err := platform.OpenURL("https://browserleaks.com/webrtc"); err != nil {
			ShowError(v.controller.GetMainWindow(), err)
		}
	}))
	fingerprint := widget.NewCard("کاهش ردپای دیجیتال", "مطابق راهنمای پیوست: افزونه‌های ضد Fingerprint و تغییر User-Agent را فقط از منبع رسمی مرورگر نصب کنید.", trailingLabel("Venzo تنظیمات مرورگر را بدون اجازه تغییر نمی‌دهد.", false))
	guide := widget.NewCard("راهنمای امنیت", "سه لایه‌ای که باید جداگانه بررسی شوند", container.NewGridWithColumns(3,
		container.NewVBox(widget.NewIcon(theme.StorageIcon()), widget.NewLabelWithStyle("DNS", fyne.TextAlignCenter, fyne.TextStyle{Bold: true})),
		container.NewVBox(widget.NewIcon(theme.VisibilityIcon()), widget.NewLabelWithStyle("WebRTC", fyne.TextAlignCenter, fyne.TextStyle{Bold: true})),
		container.NewVBox(widget.NewIcon(theme.AccountIcon()), widget.NewLabelWithStyle("Fingerprint", fyne.TextAlignCenter, fyne.TextStyle{Bold: true})),
	))
	content := container.NewVBox(trailingLabel("حریم خصوصی", true), trailingLabel("کنترل‌های روشن و بدون ادعای گمراه‌کننده", false), separator(), dns, webrtc, fingerprint, guide, layout.NewSpacer())
	v.body.Objects = []fyne.CanvasObject{container.NewScroll(container.NewStack(canvas.NewRectangle(venzoGraphite), container.NewPadded(content)))}
	v.body.Refresh()
}

func (v *venzoHome) showStore() {
	v.setActiveNav(v.navStore)
	if v.store == nil {
		v.store = NewVenzoStorePanel(v.controller, func() { fyne.Do(v.showHome) })
	}
	v.body.Objects = []fyne.CanvasObject{container.NewScroll(v.store)}
	v.body.Refresh()
}

func (v *venzoHome) refreshLoop() {
	ticker := time.NewTicker(time.Second)
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
		v.locationDetail.SetText(cleanProxyName(best.DisplayOrName()))
		protocol := strings.ToUpper(strings.TrimSpace(best.ClashType))
		if protocol == "" {
			protocol = "AUTO"
		}
		v.protocol.SetText(protocol)
		if best.Delay > 0 {
			v.ping.SetText(fmt.Sprintf("%d ms", best.Delay))
		} else {
			v.ping.SetText("در انتظار پینگ")
		}
	} else {
		v.location.SetText("در حال یافتن بهترین سرور…")
		v.locationDetail.SetText("انتخاب هوشمند")
		v.protocol.SetText("—")
		v.ping.SetText("— ms")
	}
	v.healthy.SetText(fmt.Sprintf("%d سرور سالم", healthy))
	if healthy > 0 {
		v.serviceStatus.SetText("سرویس فعال")
	} else {
		v.serviceStatus.SetText("در حال بروزرسانی")
	}
	v.refreshServerRows(proxies)

	running := v.controller.RunningState != nil && v.controller.RunningState.IsRunning()
	v.connectionMu.RLock()
	connecting := v.connecting
	verified := v.verified
	verifiedProxy := v.verifiedProxy
	lastFailure := v.lastFailure
	v.connectionMu.RUnlock()
	if connecting {
		v.power.SetText("در حال بررسی…")
		v.power.SetIcon(theme.ViewRefreshIcon())
		v.serviceStatus.SetText("در حال آزمایش اتصال")
		return
	}
	if running && verified {
		if v.connectedAt.IsZero() {
			v.connectedAt = time.Now()
		}
		v.status.SetText("متصل و تأییدشده")
		v.power.SetText("قطع اتصال")
		v.power.SetIcon(theme.MediaStopIcon())
		v.duration.SetText(formatConnectionDuration(time.Since(v.connectedAt)))
		v.durationSummary.SetText(formatConnectionDuration(time.Since(v.connectedAt)))
		v.protection.SetText("عبور اینترنت از VPN بررسی شد · " + cleanProxyName(verifiedProxy))
		v.serviceStatus.SetText("اتصال تأییدشده")
	} else {
		v.connectedAt = time.Time{}
		if running {
			v.status.SetText("اتصال تأیید نشده")
			v.protection.SetText("پردازش VPN روشن است، اما عبور اینترنت تأیید نشده")
			v.serviceStatus.SetText("نیاز به بررسی")
		} else if lastFailure != "" {
			v.status.SetText("اتصال ناموفق")
			v.protection.SetText(lastFailure)
			v.serviceStatus.SetText("اتصال برقرار نشد")
		} else {
			v.status.SetText("آماده اتصال")
			v.protection.SetText("برای شروع فقط دکمه اتصال را بزنید")
			v.serviceStatus.SetText("آماده")
		}
		v.power.SetText("اتصال هوشمند")
		v.power.SetIcon(theme.MediaPlayIcon())
		v.duration.SetText("00:00:00")
		v.durationSummary.SetText("00:00:00")
	}
}

func (v *venzoHome) refreshServerRows(proxies []api.ProxyInfo) {
	fastest := fastestProxies(proxies, 3)
	parts := make([]string, 0, len(fastest))
	for _, proxy := range fastest {
		parts = append(parts, fmt.Sprintf("%s:%d", proxy.Name, proxy.Delay))
	}
	signature := strings.Join(parts, "|")
	if signature == v.serverSignature {
		return
	}
	v.serverSignature = signature
	rows := make([]fyne.CanvasObject, 0, len(fastest))
	for _, item := range fastest {
		proxy := item
		label := fmt.Sprintf("%s · %s · %d ms", countryFromName(proxy.DisplayOrName()), cleanProxyName(proxy.DisplayOrName()), proxy.Delay)
		button := widget.NewButtonWithIcon(label, theme.StorageIcon(), func() { v.switchProxy(proxy) })
		rows = append(rows, button)
	}
	if len(rows) == 0 {
		rows = append(rows, trailingLabel("هنوز نتیجه پینگ معتبری موجود نیست", false))
	}
	v.serverRows.Objects = rows
	v.serverRows.Refresh()
}

func (v *venzoHome) switchProxy(proxy api.ProxyInfo) {
	if v.controller == nil || v.controller.APIService == nil || proxy.Name == "" {
		return
	}
	group := v.controller.APIService.GetSelectedClashGroup()
	if group == "" {
		return
	}
	if err := v.controller.APIService.SwitchProxy(group, proxy.Name); err != nil {
		ShowError(v.controller.GetMainWindow(), err)
		return
	}
	v.location.SetText(countryFromName(proxy.DisplayOrName()))
	v.locationDetail.SetText(cleanProxyName(proxy.DisplayOrName()))
	v.ping.SetText(fmt.Sprintf("%d ms", proxy.Delay))
	if v.controller.RunningState != nil && v.controller.RunningState.IsRunning() {
		v.status.SetText("در حال تأیید سرور انتخاب‌شده…")
		go func() {
			<-time.After(1500 * time.Millisecond)
			if _, err := fetchPublicIP(8 * time.Second); err != nil {
				fyne.Do(func() { v.protection.SetText("این سرور Ping دارد، اما اینترنت آن تأیید نشد") })
				return
			}
			v.setConnectionResult(true, proxy.Name, "")
			fyne.Do(v.refreshStatus)
		}()
	}
}

func (v *venzoHome) toggleConnection() {
	if v.controller.RunningState != nil && v.controller.RunningState.IsRunning() {
		v.status.SetText("در حال قطع اتصال…")
		v.setConnectionResult(false, "", "")
		go core.StopSingBoxProcess()
		return
	}
	v.connectionMu.Lock()
	if v.connecting {
		v.connectionMu.Unlock()
		return
	}
	v.connecting = true
	v.verified = false
	v.lastFailure = ""
	v.connectionMu.Unlock()
	v.power.Disable()
	v.status.SetText("در حال آماده‌سازی اتصال…")
	go func() {
		defer func() {
			v.connectionMu.Lock()
			v.connecting = false
			v.connectionMu.Unlock()
			fyne.Do(func() {
				v.power.Enable()
				v.refreshStatus()
			})
		}()
		baselineIP, baselineErr := fetchPublicIP(7 * time.Second)
		v.connectionMu.Lock()
		v.baselineIP = baselineIP
		v.connectionMu.Unlock()
		if baselineErr != nil {
			debuglog.WarnLog("Venzo smart-connect: baseline public IP unavailable: %v", baselineErr)
		}
		if err := ensureVenzoFreeSources(v.controller); err != nil {
			debuglog.WarnLog("Venzo bootstrap: %v", err)
		}
		fyne.Do(func() { v.status.SetText("در حال ساخت تنظیمات امن…") })
		core.RunParserProcess()
		if !waitForFile(v.controller.FileService.ConfigPath, 25*time.Second) {
			v.failConnection("ساخت تنظیمات ناموفق بود؛ دوباره تلاش کنید")
			return
		}
		fyne.Do(func() { v.status.SetText("در حال راه‌اندازی موتور VPN…") })
		core.StartSingBoxProcess()
		if !waitForCore(v.controller, 15*time.Second) {
			v.failConnection("موتور VPN شروع نشد؛ برنامه را با دسترسی Administrator اجرا کنید")
			return
		}
		<-time.After(3 * time.Second)
		v.controller.APIService.AutoLoadProxies(context.Background())
		if v.controller.UIService.AutoPingAfterConnectFunc != nil {
			v.controller.UIService.AutoPingAfterConnectFunc()
		}
		fyne.Do(func() { v.status.SetText("در حال تست سرورها…") })
		candidates := waitForCandidates(v.controller, 25*time.Second, 8)
		if len(candidates) == 0 {
			v.failConnection("هیچ سرور قابل آزمایشی پیدا نشد؛ فهرست سرورها را بروزرسانی کنید")
			return
		}
		group := v.controller.APIService.GetSelectedClashGroup()
		if group == "" {
			v.failConnection("گروه اتصال پیدا نشد؛ تنظیمات برنامه را بازنشانی کنید")
			return
		}
		for index, candidate := range candidates {
			proxy := candidate
			fyne.Do(func() {
				v.status.SetText(fmt.Sprintf("آزمایش سرور %d از %d…", index+1, len(candidates)))
				v.location.SetText(countryFromName(proxy.DisplayOrName()))
				v.locationDetail.SetText(cleanProxyName(proxy.DisplayOrName()))
				v.ping.SetText(fmt.Sprintf("%d ms", proxy.Delay))
			})
			if err := v.controller.APIService.SwitchProxy(group, proxy.Name); err != nil {
				debuglog.WarnLog("Venzo smart-connect: switch %q failed: %v", proxy.Name, err)
				continue
			}
			<-time.After(1800 * time.Millisecond)
			publicIP, err := fetchPublicIP(8 * time.Second)
			if err != nil {
				debuglog.WarnLog("Venzo smart-connect: %q has ping but no verified internet: %v", proxy.Name, err)
				continue
			}
			if baselineIP != "" && publicIP == baselineIP {
				debuglog.WarnLog("Venzo smart-connect: %q did not change public IP", proxy.Name)
				continue
			}
			v.setConnectionResult(true, proxy.Name, "")
			fyne.Do(func() {
				v.status.SetText("متصل و تأییدشده")
				v.protection.SetText("تغییر IP عمومی و عبور اینترنت تأیید شد")
			})
			return
		}
		v.failConnection("سرورها Ping داشتند، اما هیچ‌کدام عبور واقعی اینترنت را تأیید نکردند")
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
		fyne.Do(func() {
			v.serverSignature = ""
			v.status.SetText("منابع بروزرسانی شدند")
		})
	}()
}

func (v *venzoHome) setConnectionResult(verified bool, proxyName, failure string) {
	v.connectionMu.Lock()
	v.verified = verified
	v.verifiedProxy = proxyName
	v.lastFailure = failure
	v.connectionMu.Unlock()
}

func (v *venzoHome) failConnection(message string) {
	debuglog.WarnLog("Venzo smart-connect: %s", message)
	v.setConnectionResult(false, "", message)
	core.StopSingBoxProcess()
	fyne.Do(func() {
		v.status.SetText("اتصال ناموفق")
		v.protection.SetText(message)
	})
}

func waitForCore(controller *core.AppController, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if controller != nil && controller.RunningState != nil && controller.RunningState.IsRunning() {
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

func waitForCandidates(controller *core.AppController, timeout time.Duration, limit int) []api.ProxyInfo {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if controller != nil && controller.APIService != nil {
			if candidates := fastestProxies(controller.APIService.GetProxiesList(), limit); len(candidates) > 0 {
				return candidates
			}
		}
		time.Sleep(750 * time.Millisecond)
	}
	return nil
}

// fetchPublicIP uses a fresh transport so cached pre-VPN connections cannot
// make a disconnected route look healthy. Multiple providers avoid treating
// a single blocked diagnostic host as a VPN failure.
func fetchPublicIP(timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy:             http.ProxyFromEnvironment,
			DisableKeepAlives: true,
			DialContext:       (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		},
	}
	providers := []string{
		"https://api.ipify.org",
		"https://checkip.amazonaws.com",
		"https://icanhazip.com",
	}
	var lastErr error
	for _, endpoint := range providers {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "Venzo-VPN/2.6.0 connectivity-check")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 128))
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("%s returned HTTP %d", endpoint, resp.StatusCode)
			continue
		}
		ip := strings.TrimSpace(string(body))
		if net.ParseIP(ip) == nil {
			lastErr = fmt.Errorf("%s returned an invalid IP", endpoint)
			continue
		}
		return ip, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("public IP verification failed")
	}
	return "", lastErr
}

func ensureVenzoFreeSources(controller *core.AppController) error {
	if controller == nil || controller.FileService == nil {
		return fmt.Errorf("file service unavailable")
	}
	statePath := platform.GetWizardStatePath(controller.FileService.ExecDir)
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		return err
	}
	var s *state.State
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		s = state.New()
	} else if err != nil {
		return err
	} else {
		s, err = state.Load(statePath)
		if err != nil {
			return fmt.Errorf("load existing Venzo state: %w", err)
		}
	}
	if s == nil {
		s = state.New()
	}
	known := make(map[string]bool)
	for _, source := range s.Connections.Sources {
		known[source.URL] = true
	}
	freeSources := []struct{ label, url string }{
		{"Venzo Free", venzoFreeCatalogURL},
		{"Venzo Radikal", venzoFallbackURL},
		{"Venzo Verified", venzoFilteredURL},
		{"Venzo Universal", venzoUniversalURL},
		{"Venzo Reality", venzoIgareckURL},
	}
	for _, source := range freeSources {
		if known[source.url] {
			continue
		}
		s.Connections.Sources = append(s.Connections.Sources, state.Source{ID: state.MakeULID(), Type: state.SourceTypeSubscription, Enabled: true, Label: source.label, URL: source.url})
	}
	if len(s.Connections.Outbounds) == 0 {
		s.Connections.Outbounds = []configtypes.OutboundConfig{{Tag: "auto-proxy-out", Ref: configtypes.RefTemplate}, {Tag: "proxy-out", Ref: configtypes.RefTemplate}}
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

func fastestProxies(proxies []api.ProxyInfo, limit int) []api.ProxyInfo {
	result := make([]api.ProxyInfo, 0, len(proxies))
	for _, proxy := range proxies {
		kind := strings.ToLower(strings.TrimSpace(proxy.ClashType))
		if kind == "selector" || kind == "urltest" || kind == "direct" || proxy.Delay <= 0 {
			continue
		}
		result = append(result, proxy)
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].Delay < result[j].Delay })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result
}

func bestProxy(proxies []api.ProxyInfo) api.ProxyInfo {
	fastest := fastestProxies(proxies, 1)
	if len(fastest) > 0 {
		return fastest[0]
	}
	for _, proxy := range proxies {
		kind := strings.ToLower(strings.TrimSpace(proxy.ClashType))
		if kind != "selector" && kind != "urltest" && kind != "direct" {
			return proxy
		}
	}
	return api.ProxyInfo{}
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
	return "سرور بین‌المللی"
}

func cleanProxyName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "سرور منتخب"
	}
	runes := []rune(trimmed)
	if len(runes) > 32 {
		return string(runes[:29]) + "…"
	}
	return trimmed
}

func formatConnectionDuration(duration time.Duration) string {
	if duration < 0 {
		duration = 0
	}
	total := int(duration.Seconds())
	return fmt.Sprintf("%02d:%02d:%02d", total/3600, (total%3600)/60, total%60)
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
