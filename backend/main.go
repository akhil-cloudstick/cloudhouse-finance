package main

import (
	"os"

	"github.com/labstack/echo/v4"

	"cloudhouse/backend/common/routers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/scheduler"
)

func main() {
	config.InitDB()
	scheduler.StartCronJobs()
	e := echo.New()
	routers.InitRoutes(e)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	e.Logger.Fatal(e.Start(":" + port))
}
