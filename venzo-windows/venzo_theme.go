package uiservice

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// venzoTheme keeps native Fyne typography and icons while applying Venzo's
// red Cyber Pulse accent, cyan diagnostics, and graphite surfaces.
type venzoTheme struct {
	base fyne.Theme
}

func newVenzoTheme(base fyne.Theme) fyne.Theme {
	return &venzoTheme{base: base}
}

// ApplyVenzoTheme switches the complete application between day and night
// while keeping Venzo's Cyber Pulse controls.
func ApplyVenzoTheme(application fyne.App, dark bool) {
	if application == nil {
		return
	}
	base := theme.LightTheme()
	if dark {
		base = theme.DarkTheme()
	}
	application.Settings().SetTheme(newVenzoTheme(base))
}

func (t *venzoTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNamePrimary:
		return color.NRGBA{R: 239, G: 35, B: 60, A: 255}
	case theme.ColorNameFocus:
		return color.NRGBA{R: 255, G: 64, B: 87, A: 255}
	case theme.ColorNameSelection:
		return color.NRGBA{R: 239, G: 35, B: 60, A: 112}
	case theme.ColorNameBackground:
		if variant == theme.VariantDark {
			return color.NRGBA{R: 7, G: 10, B: 16, A: 255}
		}
	case theme.ColorNameMenuBackground, theme.ColorNameInputBackground:
		if variant == theme.VariantDark {
			return color.NRGBA{R: 12, G: 17, B: 26, A: 255}
		}
	case theme.ColorNameSeparator:
		if variant == theme.VariantDark {
			return color.NRGBA{R: 43, G: 49, B: 61, A: 255}
		}
	case theme.ColorNameSuccess:
		return color.NRGBA{R: 0, G: 230, B: 118, A: 255}
	case theme.ColorNameWarning:
		return color.NRGBA{R: 255, G: 179, B: 0, A: 255}
	case theme.ColorNameError:
		return color.NRGBA{R: 255, G: 71, B: 87, A: 255}
	default:
	}
	return t.base.Color(name, variant)
}

func (t *venzoTheme) Font(style fyne.TextStyle) fyne.Resource {
	return t.base.Font(style)
}

func (t *venzoTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return t.base.Icon(name)
}

func (t *venzoTheme) Size(name fyne.ThemeSizeName) float32 {
	return t.base.Size(name)
}
