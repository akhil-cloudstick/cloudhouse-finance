package main

import (
	"cloudhouse/backend/common/routers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/scheduler"
	"github.com/labstack/echo/v4"
	"os"
)

func main() {
	config.InitDB()
	scheduler.StartCronJobs()
	e := echo.New()
	routers.InitRoutes(e)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	e.Logger.Fatal(e.Start(":" + port))
}
