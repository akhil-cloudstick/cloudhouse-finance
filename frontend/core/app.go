package main

import (
	"context"

	"cloudhouse/desktop/update"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx     context.Context
	version string
	updater *update.Updater
}

func NewApp(version, updateURL string) *App {
	a := &App{version: version}
	a.updater = update.New(version, updateURL, func(event string, data any) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "update:"+event, data)
		}
	})
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) Version() string {
	return a.version
}

func (a *App) Frameless() bool {
	return framelessWindow
}

func (a *App) CheckUpdate() error {
	return a.updater.Check(a.ctx)
}

func (a *App) DownloadUpdate() error {
	return a.updater.Download(a.ctx)
}

func (a *App) InstallUpdate() error {
	if err := a.updater.Install(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}
