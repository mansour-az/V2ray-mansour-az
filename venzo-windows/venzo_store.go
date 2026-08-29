package ui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"singbox-launcher/core"
	"singbox-launcher/core/state"
	"singbox-launcher/internal/platform"
)

const venzoStoreAPI = "https://venzo-store-api.mascot-gt.workers.dev"

type venzoPlan struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Price    int64  `json:"price"`
	Currency string `json:"currency"`
	Days     int    `json:"days"`
	DataGB   *int   `json:"data_gb"`
}

type venzoOrder struct {
	ID              string         `json:"id"`
	Status          string         `json:"status"`
	PaymentMethod   string         `json:"payment_method"`
	Payment         map[string]any `json:"payment"`
	SubscriptionURL string         `json:"subscription_url"`
}

type venzoCheckout struct {
	Order        venzoOrder `json:"order"`
	ClientSecret string     `json:"client_secret"`
}

type venzoAccountCredentials struct {
	ID       string `json:"id"`
	Token    string `json:"token"`
	Customer string `json:"customer"`
}

type venzoAccount struct {
	ID           string `json:"id"`
	Customer     string `json:"customer"`
	BalanceIRR   int64  `json:"balance_irr"`
	Subscription *struct {
		SubscriptionURL string `json:"subscription_url"`
	} `json:"subscription"`
}

type venzoStorePanel struct {
	controller  *core.AppController
	onActivated func()
	client      *http.Client

	root           *fyne.Container
	plansBox       *fyne.Container
	methodBox      *fyne.Container
	resultBox      *fyne.Container
	accountBox     *fyne.Container
	status         *widget.Label
	customer       *widget.Entry
	buy            *widget.Button
	selectedPlan   *venzoPlan
	selectedMethod string
	plans          []venzoPlan
	account        venzoAccountCredentials

	mu         sync.Mutex
	pollCancel context.CancelFunc
}

// NewVenzoStorePanel builds the native Windows checkout. Provider credentials
// never enter the desktop app; invoice creation and verification stay in the
// Venzo Cloudflare Worker.
func NewVenzoStorePanel(controller *core.AppController, onActivated func()) fyne.CanvasObject {
	v := &venzoStorePanel{
		controller:  controller,
		onActivated: onActivated,
		client:      &http.Client{Timeout: 20 * time.Second},
	}
	v.customer = widget.NewEntry()
	v.customer.SetPlaceHolder("شماره موبایل یا نام کاربری تلگرام")
	v.customer.OnChanged = func(string) { v.updateBuyState() }
	v.accountBox = container.NewVBox()
	v.status = widget.NewLabelWithStyle("در حال دریافت پلن‌ها…", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true})
	v.plansBox = container.NewVBox()
	v.methodBox = container.NewVBox()
	v.resultBox = container.NewVBox()
	v.buy = widget.NewButtonWithIcon("ساخت فاکتور و ورود به درگاه", theme.ConfirmIcon(), v.createCheckout)
	v.buy.Importance = widget.HighImportance
	v.buy.Disable()

	heading := widget.NewLabelWithStyle("فروشگاه Venzo", fyne.TextAlignTrailing, fyne.TextStyle{Bold: true})
	subtitle := trailingLabel("خرید امن اشتراک برای Windows، Android و سایر دستگاه‌ها", false)
	privacy := widget.NewCard("پرداخت امن", "", container.NewVBox(
		trailingLabel("کلیدهای درگاه فقط روی سرور Venzo نگهداری می‌شوند.", false),
		trailingLabel("پس از پرداخت، اشتراک به‌صورت خودکار به برنامه اضافه می‌شود.", false),
	))
	v.root = container.NewVBox(
		container.NewHBox(layout.NewSpacer(), container.NewVBox(heading, subtitle), widget.NewIcon(theme.AccountIcon())),
		separator(),
		widget.NewCard("۱. حساب کاربری", "اطلاعات فقط برای ساخت و بازیابی اشتراک استفاده می‌شود.", v.accountBox),
		widget.NewCard("۲. انتخاب اشتراک", "", v.plansBox),
		widget.NewCard("۳. روش پرداخت", "", v.methodBox),
		privacy,
		v.buy,
		v.status,
		v.resultBox,
	)
	v.loadLocalAccount()
	v.renderAccountPanel(nil)
	go v.loadCatalog()
	if v.account.ID != "" {
		go v.refreshAccount()
	}
	return container.NewPadded(v.root)
}

func (v *venzoStorePanel) renderAccountPanel(snapshot *venzoAccount) {
	if v.account.ID == "" {
		register := widget.NewButtonWithIcon("ثبت اطلاعات و ورود", theme.AccountIcon(), v.registerAccount)
		register.Importance = widget.HighImportance
		v.accountBox.Objects = []fyne.CanvasObject{
			v.customer,
			trailingLabel("برای خرید، ابتدا شماره موبایل یا آیدی تلگرام خود را ثبت کنید.", false),
			register,
		}
		v.accountBox.Refresh()
		return
	}
	name := v.account.Customer
	balance := int64(0)
	if snapshot != nil {
		if snapshot.Customer != "" {
			name = snapshot.Customer
		}
		balance = snapshot.BalanceIRR
	}
	refresh := widget.NewButtonWithIcon("بروزرسانی حساب", theme.ViewRefreshIcon(), func() { go v.refreshAccount() })
	v.accountBox.Objects = []fyne.CanvasObject{
		trailingLabel("وارد شده با: "+name, true),
		trailingLabel("موجودی: "+formatAmount(balance)+" ریال", false),
		refresh,
	}
	v.accountBox.Refresh()
}

func (v *venzoStorePanel) registerAccount() {
	customer := strings.TrimSpace(v.customer.Text)
	if len(customer) < 3 {
		v.status.SetText("شماره موبایل یا آیدی تلگرام معتبر وارد کنید.")
		return
	}
	v.status.SetText("در حال ساخت حساب امن…")
	go func() {
		payload, _ := json.Marshal(map[string]string{"customer": customer})
		req, err := http.NewRequest(http.MethodPost, venzoStoreAPI+"/v1/account/register", bytes.NewReader(payload))
		if err != nil {
			fyne.Do(func() { v.status.SetText("ساخت حساب ناموفق بود.") })
			return
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/json")
		var envelope struct {
			Account      venzoAccount `json:"account"`
			AccountToken string       `json:"account_token"`
		}
		if err := v.doJSON(req, &envelope); err != nil || envelope.Account.ID == "" || len(envelope.AccountToken) < 40 {
			fyne.Do(func() { v.status.SetText("ساخت حساب ناموفق بود؛ دوباره تلاش کنید.") })
			return
		}
		credentials := venzoAccountCredentials{ID: envelope.Account.ID, Token: envelope.AccountToken, Customer: envelope.Account.Customer}
		if err := saveVenzoAccount(credentials); err != nil {
			fyne.Do(func() {
				v.status.SetText("حساب ساخته شد، اما ذخیره محلی آن ناموفق بود.")
			})
			return
		}
		v.account = credentials
		fyne.Do(func() {
			v.customer.SetText(credentials.Customer)
			v.customer.Disable()
			v.renderAccountPanel(&envelope.Account)
			v.status.SetText("ورود با موفقیت انجام شد.")
			v.updateBuyState()
		})
	}()
}

func (v *venzoStorePanel) refreshAccount() {
	if v.account.ID == "" || v.account.Token == "" {
		return
	}
	req, err := http.NewRequest(http.MethodGet, venzoStoreAPI+"/v1/account", nil)
	if err != nil {
		return
	}
	v.addAccountHeaders(req)
	var envelope struct {
		Account venzoAccount `json:"account"`
	}
	if err := v.doJSON(req, &envelope); err != nil {
		fyne.Do(func() {
			v.status.SetText("بروزرسانی حساب انجام نشد؛ اتصال اینترنت را بررسی کنید.")
		})
		return
	}
	if envelope.Account.Subscription != nil && strings.TrimSpace(envelope.Account.Subscription.SubscriptionURL) != "" {
		if installVenzoSubscription(v.controller, envelope.Account.Subscription.SubscriptionURL) == nil {
			core.RunParserProcess()
		}
	}
	fyne.Do(func() {
		v.renderAccountPanel(&envelope.Account)
		v.status.SetText("اطلاعات حساب بروزرسانی شد.")
	})
}

func (v *venzoStorePanel) loadLocalAccount() {
	account, err := loadVenzoAccount()
	if err != nil || account.ID == "" || account.Token == "" {
		return
	}
	v.account = account
	v.customer.SetText(account.Customer)
	v.customer.Disable()
}

func (v *venzoStorePanel) addAccountHeaders(req *http.Request) {
	if v.account.ID == "" || v.account.Token == "" {
		return
	}
	req.Header.Set("Authorization", "Bearer "+v.account.Token)
	req.Header.Set("X-Venzo-Account", v.account.ID)
}

func (v *venzoStorePanel) loadCatalog() {
	plans, err := v.fetchPlans()
	if err != nil {
		fyne.Do(func() {
			v.status.SetText("دریافت پلن‌ها ناموفق بود؛ اتصال اینترنت را بررسی کنید.")
		})
		return
	}
	methods, _ := v.fetchPaymentMethods()
	available := map[string]bool{}
	for _, method := range methods {
		available[method] = true
	}
	// Aban is the only public checkout method. The API remains the final
	// authority and can temporarily hide it without requiring a new app build.
	methodRows := []struct{ key, title, caption string }{
		{"aban", "آبان", "پرداخت ریالی امن و فعال‌سازی خودکار اشتراک"},
	}
	fyne.Do(func() {
		v.plans = plans
		v.plansBox.Objects = nil
		for i := range plans {
			plan := &v.plans[i]
			button := widget.NewButtonWithIcon(planLabel(*plan), theme.StorageIcon(), func() {
				v.selectedPlan = plan
				v.status.SetText("پلن «" + plan.Title + "» انتخاب شد.")
				v.updateBuyState()
			})
			v.plansBox.Add(button)
		}
		v.methodBox.Objects = nil
		for _, row := range methodRows {
			method := row
			title := method.title
			if !available[method.key] {
				v.methodBox.Add(trailingLabel("درگاه آبان موقتاً در دسترس نیست.", false))
				continue
			}
			button := widget.NewButtonWithIcon(title+" — "+method.caption, theme.AccountIcon(), func() {
				v.selectedMethod = method.key
				v.status.SetText("روش پرداخت «" + method.title + "» انتخاب شد.")
				v.updateBuyState()
			})
			v.methodBox.Add(button)
		}
		v.plansBox.Refresh()
		v.methodBox.Refresh()
		v.status.SetText("پلن و روش پرداخت را انتخاب کنید.")
	})
}

func (v *venzoStorePanel) updateBuyState() {
	if v.selectedPlan != nil && v.selectedMethod == "aban" && v.account.ID != "" {
		v.buy.Enable()
		return
	}
	v.buy.Disable()
}

func (v *venzoStorePanel) createCheckout() {
	v.updateBuyState()
	if v.buy.Disabled() {
		v.status.SetText("اطلاعات خریدار، پلن و روش پرداخت را کامل کنید.")
		return
	}
	v.buy.Disable()
	v.status.SetText("در حال ساخت فاکتور امن…")
	v.resultBox.Objects = nil
	v.resultBox.Refresh()
	planID := v.selectedPlan.ID
	method := v.selectedMethod
	customer := strings.TrimSpace(v.customer.Text)
	go func() {
		checkout, err := v.postCheckout(planID, customer, method)
		if err != nil {
			fyne.Do(func() {
				v.status.SetText(providerError(method, err))
				v.updateBuyState()
			})
			return
		}
		checkoutURL := stringValue(checkout.Order.Payment["checkout_url"])
		fyne.Do(func() {
			v.renderPending(checkout)
			if checkoutURL != "" {
				if err := platform.OpenURL(checkoutURL); err != nil {
					v.status.SetText("فاکتور ساخته شد، اما مرورگر باز نشد؛ لینک را کپی کنید.")
				}
			}
		})
		v.startPolling(checkout)
	}()
}

func (v *venzoStorePanel) renderPending(checkout venzoCheckout) {
	url := stringValue(checkout.Order.Payment["checkout_url"])
	orderID := widget.NewLabelWithStyle(checkout.Order.ID, fyne.TextAlignCenter, fyne.TextStyle{Monospace: true})
	copyOrder := widget.NewButtonWithIcon("کپی شماره سفارش", theme.ContentCopyIcon(), func() {
		v.controller.GetMainWindow().Clipboard().SetContent(checkout.Order.ID)
	})
	open := widget.NewButtonWithIcon("بازکردن صفحه پرداخت", theme.NavigateNextIcon(), func() {
		if url != "" {
			_ = platform.OpenURL(url)
		}
	})
	open.Importance = widget.HighImportance
	if url == "" {
		open.Disable()
	}
	v.resultBox.Objects = []fyne.CanvasObject{widget.NewCard("در انتظار پرداخت", "", container.NewVBox(
		trailingLabel("شماره سفارش", true), orderID,
		trailingLabel("وضعیت پرداخت هر ۱۵ ثانیه به‌صورت خودکار بررسی می‌شود.", false),
		container.NewGridWithColumns(2, copyOrder, open),
	))}
	v.resultBox.Refresh()
	v.status.SetText("فاکتور ساخته شد؛ پرداخت را در صفحه درگاه تکمیل کنید.")
}

func (v *venzoStorePanel) startPolling(checkout venzoCheckout) {
	v.mu.Lock()
	if v.pollCancel != nil {
		v.pollCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	v.pollCancel = cancel
	v.mu.Unlock()

	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			order, err := v.fetchOrder(ctx, checkout)
			if err == nil {
				switch order.Status {
				case "fulfilled":
					cancel()
					v.handleFulfilled(order)
					return
				case "expired", "payment_failed", "provisioning_failed":
					cancel()
					fyne.Do(func() { v.renderFailed(order.Status) })
					return
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (v *venzoStorePanel) handleFulfilled(order venzoOrder) {
	if strings.TrimSpace(order.SubscriptionURL) == "" {
		fyne.Do(func() { v.renderFailed("subscription_missing") })
		return
	}
	if err := installVenzoSubscription(v.controller, order.SubscriptionURL); err != nil {
		fyne.Do(func() { v.renderFailed("subscription_install") })
		return
	}
	core.RunParserProcess()
	fyne.Do(func() {
		copySubscription := widget.NewButtonWithIcon("کپی لینک اشتراک", theme.ContentCopyIcon(), func() {
			v.controller.GetMainWindow().Clipboard().SetContent(order.SubscriptionURL)
		})
		v.resultBox.Objects = []fyne.CanvasObject{widget.NewCard("پرداخت موفق", "", container.NewVBox(
			widget.NewIcon(theme.ConfirmIcon()),
			trailingLabel("اشتراک با موفقیت فعال و به Venzo اضافه شد.", true),
			copySubscription,
		))}
		v.resultBox.Refresh()
		v.status.SetText("خرید تکمیل شد؛ سرورهای اختصاصی در حال بروزرسانی هستند.")
		v.updateBuyState()
		if v.onActivated != nil {
			v.onActivated()
		}
	})
}

func (v *venzoStorePanel) renderFailed(status string) {
	v.resultBox.Objects = []fyne.CanvasObject{widget.NewCard("پرداخت ناموفق", "", container.NewVBox(
		widget.NewIcon(theme.ErrorIcon()),
		trailingLabel(paymentStatusText(status), true),
		trailingLabel("می‌توانید فاکتور جدیدی بسازید یا با پشتیبانی تماس بگیرید.", false),
	))}
	v.resultBox.Refresh()
	v.status.SetText("پرداخت تکمیل نشد.")
	v.updateBuyState()
}

func (v *venzoStorePanel) fetchPlans() ([]venzoPlan, error) {
	var envelope struct {
		Plans []venzoPlan `json:"plans"`
	}
	if err := v.getJSON(context.Background(), "/v1/plans", "", &envelope); err != nil {
		return nil, err
	}
	valid := make([]venzoPlan, 0, len(envelope.Plans))
	for _, plan := range envelope.Plans {
		if plan.ID != "" && plan.Price > 0 {
			valid = append(valid, plan)
		}
	}
	if len(valid) == 0 {
		return nil, fmt.Errorf("no plans returned")
	}
	return valid, nil
}

func (v *venzoStorePanel) fetchPaymentMethods() ([]string, error) {
	var envelope struct {
		Methods []json.RawMessage `json:"methods"`
	}
	if err := v.getJSON(context.Background(), "/v1/payment-methods", "", &envelope); err != nil {
		return nil, err
	}
	result := make([]string, 0, len(envelope.Methods))
	for _, raw := range envelope.Methods {
		var value string
		if json.Unmarshal(raw, &value) == nil {
			result = append(result, value)
			continue
		}
		var object map[string]any
		if json.Unmarshal(raw, &object) == nil {
			value = stringValue(object["id"])
			if value == "" {
				value = stringValue(object["key"])
			}
			if value != "" {
				result = append(result, value)
			}
		}
	}
	return result, nil
}

func (v *venzoStorePanel) postCheckout(planID, customer, method string) (venzoCheckout, error) {
	payload, _ := json.Marshal(map[string]string{
		"plan_id": planID, "customer": customer, "payment_method": method, "client": "venzo-windows",
	})
	req, err := http.NewRequest(http.MethodPost, venzoStoreAPI+"/v1/orders", bytes.NewReader(payload))
	if err != nil {
		return venzoCheckout{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	v.addAccountHeaders(req)
	var checkout venzoCheckout
	if err := v.doJSON(req, &checkout); err != nil {
		return venzoCheckout{}, err
	}
	if checkout.Order.ID == "" || len(checkout.ClientSecret) < 16 {
		return venzoCheckout{}, fmt.Errorf("invalid checkout response")
	}
	return checkout, nil
}

func (v *venzoStorePanel) fetchOrder(ctx context.Context, checkout venzoCheckout) (venzoOrder, error) {
	var envelope struct {
		Order venzoOrder `json:"order"`
	}
	err := v.getJSON(ctx, "/v1/orders/"+checkout.Order.ID, checkout.ClientSecret, &envelope)
	return envelope.Order, err
}

func (v *venzoStorePanel) getJSON(ctx context.Context, path, bearer string, output any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, venzoStoreAPI+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	return v.doJSON(req, output)
}

func (v *venzoStorePanel) doJSON(req *http.Request, output any) error {
	response, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	if err := json.Unmarshal(body, output); err != nil {
		return fmt.Errorf("invalid server response: %w", err)
	}
	return nil
}

func installVenzoSubscription(controller *core.AppController, subscriptionURL string) error {
	if controller == nil || controller.FileService == nil {
		return fmt.Errorf("file service unavailable")
	}
	statePath := platform.GetWizardStatePath(controller.FileService.ExecDir)
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		return err
	}
	var current *state.State
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		current = state.New()
	} else if err != nil {
		return err
	} else {
		current, err = state.Load(statePath)
		if err != nil {
			return err
		}
	}
	for _, source := range current.Connections.Sources {
		if source.URL == subscriptionURL {
			return nil
		}
	}
	current.Connections.Sources = append(current.Connections.Sources, state.Source{
		ID: state.MakeULID(), Type: state.SourceTypeSubscription, Enabled: true, Label: "Venzo Premium", URL: subscriptionURL,
	})
	return current.Save(statePath)
}

func planLabel(plan venzoPlan) string {
	traffic := "نامحدود"
	if plan.DataGB != nil && *plan.DataGB > 0 {
		traffic = fmt.Sprintf("%d گیگ", *plan.DataGB)
	}
	return fmt.Sprintf("%s · %s · %d روز · %s %s", plan.Title, traffic, plan.Days, formatAmount(plan.Price), plan.Currency)
}

func formatAmount(value int64) string {
	digits := strconv.FormatInt(value, 10)
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	return digits
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func providerError(method string, err error) string {
	name := "درگاه پرداخت"
	if method == "aban" {
		name = "آبان"
	}
	if strings.Contains(err.Error(), "503") {
		return name + " در حال حاضر فاکتور صادر نکرد؛ دسترسی Merchant API را بررسی کنید."
	}
	return "اتصال به " + name + " ناموفق بود؛ دوباره تلاش کنید."
}

func venzoAccountPath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "Venzo VPN", "account.json"), nil
}

func loadVenzoAccount() (venzoAccountCredentials, error) {
	path, err := venzoAccountPath()
	if err != nil {
		return venzoAccountCredentials{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return venzoAccountCredentials{}, err
	}
	var account venzoAccountCredentials
	if err := json.Unmarshal(data, &account); err != nil {
		return venzoAccountCredentials{}, err
	}
	return account, nil
}

func saveVenzoAccount(account venzoAccountCredentials) error {
	path, err := venzoAccountPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(account)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func paymentStatusText(status string) string {
	switch status {
	case "expired":
		return "زمان فاکتور به پایان رسید."
	case "payment_failed":
		return "پرداخت توسط درگاه تأیید نشد."
	case "provisioning_failed":
		return "پرداخت تأیید شد، اما ساخت اشتراک نیازمند بررسی پشتیبانی است."
	case "subscription_missing":
		return "پرداخت تأیید شد، اما لینک اشتراک هنوز آماده نیست."
	case "subscription_install":
		return "اشتراک ساخته شد، اما افزودن آن به برنامه ناموفق بود."
	default:
		return "پرداخت تکمیل نشد."
	}
}
